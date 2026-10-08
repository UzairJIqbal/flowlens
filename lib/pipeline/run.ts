import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectAdapter } from "../adapters/index.ts";
import { EDGE_KINDS, parseRepository, type Coverage } from "../parser/index.ts";
import { createAdminClient } from "../supabase/admin.ts";
import type { Enums, Json } from "../supabase/database.types.ts";
import { frameworkOf } from "../taxonomy.ts";
import { downloadArchive, extractArchive, parseRepositoryUrl, resolveHead, type RepositoryRef } from "./github.ts";
import { labelUnidentified } from "./label.ts";
import { STALE_AFTER_MINUTES } from "./stale.ts";

type Stage = Enums<"analysis_stage">;
export type Admin = ReturnType<typeof createAdminClient>;

/**
 * Finds or creates the one analysis for a repository in an organization.
 * `created` is false when the repository was already there, and then nothing
 * should run: re-running is a deliberate act on the existing analysis.
 *
 * `organizationId` must come from the verified session, never from input.
 */
export async function submitRepository(
  organizationId: string,
  url: string,
): Promise<{ analysisId: string; created: boolean }> {
  const repo = parseRepositoryUrl(url);
  const db = createAdminClient();
  const projectId = await recordProject(db, organizationId, repo);

  const inserted = await db
    .from("analyses")
    .upsert(
      { organization_id: organizationId, project_id: projectId },
      { onConflict: "project_id", ignoreDuplicates: true },
    )
    .select("id");
  if (inserted.error) throw new Error(`Could not create the analysis: ${inserted.error.message}`);
  if (inserted.data.length > 0) return { analysisId: inserted.data[0].id, created: true };

  const existing = await db.from("analyses").select("id").eq("project_id", projectId).single();
  if (existing.error) throw new Error(`Could not read the existing analysis: ${existing.error.message}`);
  return { analysisId: existing.data.id, created: false };
}

/**
 * The organization's row and its project for a repository, created if absent,
 * returning the project's id. Insert-if-absent then read, so two submissions
 * racing each other still end on one project.
 *
 * `organizationId` must come from the verified session, never from input.
 */
export async function recordProject(db: Admin, organizationId: string, repo: RepositoryRef): Promise<string> {
  // Clerk owns organizations; the row exists only so everything else can point at it.
  const org = await db.from("organizations").upsert({ id: organizationId }, { ignoreDuplicates: true });
  if (org.error) throw new Error(`Could not record the organization: ${org.error.message}`);

  const projectInsert = await db
    .from("projects")
    .upsert(
      { organization_id: organizationId, repo_owner: repo.owner, repo_name: repo.name },
      { onConflict: "organization_id,repo_owner,repo_name", ignoreDuplicates: true },
    );
  if (projectInsert.error) throw new Error(`Could not record the repository: ${projectInsert.error.message}`);

  const project = await db
    .from("projects")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("repo_owner", repo.owner)
    .eq("repo_name", repo.name)
    .single();
  if (project.error) throw new Error(`Could not read the repository back: ${project.error.message}`);
  return project.data.id;
}

/** A run that has been claimed and is the only one allowed to write this row. */
export type ClaimedRun = { analysisId: string; organizationId: string; repo: RepositoryRef };

/**
 * Moves the analysis into a run, or returns null if one is already going. A
 * run that has been unfinished past the stale age is assumed dead and may be
 * replaced.
 *
 * Separate from the run itself so the app can refuse before it responds, then
 * do the slow part after the response has gone.
 */
export async function claimRun(analysisId: string): Promise<ClaimedRun | null> {
  const db = createAdminClient();
  const now = Date.now();
  const staleBefore = new Date(now - STALE_AFTER_MINUTES * 60_000).toISOString();
  const { data, error } = await db
    .from("analyses")
    .update({
      status: "parsing",
      stage: "fetch",
      stage_message: "Starting",
      started_at: new Date(now).toISOString(),
      error: null,
      finished_at: null,
    })
    .eq("id", analysisId)
    .or(`status.neq.parsing,started_at.lt.${staleBefore}`)
    .select("organization_id, project:projects!inner(repo_owner, repo_name)");
  if (error) throw new Error(`Could not start the run: ${error.message}`);
  if (data.length === 0) return null;
  return {
    analysisId,
    organizationId: data[0].organization_id,
    repo: { owner: data[0].project.repo_owner, name: data[0].project.repo_name },
  };
}

/**
 * Fetch, select, parse, store. Every stage change is a row update, and a
 * trigger publishes it. Whatever goes wrong, the row ends failed with the
 * reason and the stage it happened in — never left mid-run.
 *
 * Runs with the secret key: the caller must already know the user may act on
 * this analysis.
 */
export async function executeRun({ analysisId, organizationId, repo }: ClaimedRun): Promise<void> {
  const db = createAdminClient();
  // Inside the try, so even failing to make a temp directory ends the row failed.
  let workspace: string | undefined;
  try {
    workspace = await mkdtemp(path.join(tmpdir(), "flowlens-"));
    const label = `${repo.owner}/${repo.name}`;

    await enter(db, analysisId, "fetch", `Resolving the latest commit of ${label}`);
    const sha = await resolveHead(repo);
    await enter(db, analysisId, "fetch", `Downloading ${label} at ${sha.slice(0, 7)}`);
    const archive = path.join(workspace, "archive.tar.gz");
    await downloadArchive(repo, sha, archive);
    const checkout = path.join(workspace, "repository");
    await mkdir(checkout);
    await extractArchive(archive, checkout);
    await rm(archive);

    await enter(db, analysisId, "select", "Looking for a framework");
    const adapter = detectAdapter(checkout);
    const named = frameworkOf(adapter.name).label;
    const framework = named === null ? "No framework detected" : `Framework: ${named}`;

    await enter(db, analysisId, "parse", `${framework}. Parsing imports`);
    const result = parseRepository(checkout, adapter);

    const unidentified = result.files.filter((f) => f.role === null).length;
    await enter(db, analysisId, "label", `Labelling ${unidentified} files no convention identified`);
    const labelled = await labelUnidentified(organizationId, named, result);
    // A failed batch leaves its files unlabelled, never guessed; it's recorded
    // where every other run problem is.
    const labelWarnings = labelled.failures.map(
      (f) => `Could not label ${f.files} unidentified files: ${f.reason}`,
    );

    await enter(
      db,
      analysisId,
      "store",
      `Labelled ${labelled.roles.size} of ${labelled.asked} unidentified files. Storing ${result.files.length} files, ${result.edges.length} edges and ${result.routes.length} routes`,
    );
    const stored = await db.rpc("store_analysis", {
      p_analysis: analysisId,
      p_commit: sha,
      p_adapter: result.adapter,
      p_files: result.files.map(({ path, folder, lines, hash, role }) => {
        // Convention first; a model only ever fills a file convention left empty.
        const label = role === null ? (labelled.roles.get(path) ?? null) : null;
        return {
          path,
          folder,
          lines,
          hash,
          role: role ?? label,
          roleSource: role !== null ? "convention" : label !== null ? "model" : null,
        };
      }),
      p_edges: result.edges.map(({ from, to, kinds, typeOnly }) => ({ from, to, kinds, typeOnly })),
      p_routes: result.routes.map(({ file, line, method, path }) => ({ file, line, method, path })),
      p_withheld_routes: result.withheldRoutes.map(({ file, line, reason }) => ({ file, line, reason })),
      p_coverage: toJson(result.coverage),
      p_warnings: [...result.warnings, ...labelWarnings],
    });
    if (stored.error) throw new Error(`Could not store the result: ${stored.error.message}`);
  } catch (error) {
    await fail(db, analysisId, error);
  } finally {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  }
}

/** Claims and executes an analysis, throwing if it is missing or already running. */
export async function runAnalysis(analysisId: string): Promise<void> {
  const run = await claimRun(analysisId);
  if (!run) throw new Error(`Analysis ${analysisId} doesn't exist or is already running`);
  await executeRun(run);
}

/** Records a stage and message for the progress trigger, throwing if the update fails. */
async function enter(db: Admin, analysisId: string, stage: Stage, message: string): Promise<void> {
  const { error } = await db.from("analyses").update({ stage, stage_message: message }).eq("id", analysisId);
  if (error) throw new Error(`Could not record the ${stage} stage: ${error.message}`);
}

/** Records a failure and finish time, preserving the stage where the run stopped. */
async function fail(db: Admin, analysisId: string, cause: unknown): Promise<void> {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const { error } = await db
    .from("analyses")
    .update({ status: "failed", error: reason || "Failed without a message", finished_at: new Date().toISOString() })
    .eq("id", analysisId);
  // Nowhere left to record it. The stale marker is what catches this row.
  if (error) throw new Error(`Run failed (${reason}) and the failure could not be recorded: ${error.message}`);
}

/**
 * The parser's coverage is interfaces, which the generated Json type won't
 * accept without a cast; rebuilt here as plain objects instead.
 */
function toJson(coverage: Coverage): Json {
  return {
    files: { ...coverage.files },
    imports: { ...coverage.imports },
    byKind: Object.fromEntries(EDGE_KINDS.map((kind) => [kind, { ...coverage.byKind[kind] }])),
    unresolvedByReason: { ...coverage.unresolvedByReason },
    excludedByReason: { ...coverage.excludedByReason },
  };
}
