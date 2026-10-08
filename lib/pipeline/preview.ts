import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectAdapter } from "../adapters/index.ts";
import { parseRepository } from "../parser/index.ts";
import { readChanged, sideFromParse, type PreviewSide } from "../previews/side.ts";
import { createAdminClient } from "../supabase/admin.ts";
import type { Enums } from "../supabase/database.types.ts";
import {
  downloadArchive,
  extractArchive,
  parsePullRequestUrl,
  readPullRequest,
  type ChangedFile,
  type RepositoryRef,
} from "./github.ts";
import { recordProject, type Admin } from "./run.ts";
import { STALE_AFTER_MINUTES } from "./stale.ts";

type Stage = Enums<"preview_stage">;

/**
 * Reads the pull request from GitHub, then finds or creates the preview of
 * exactly its two commits. The limits on size and changed files are checked
 * in that read, so a pull request too large to preview is refused here, before
 * a row exists.
 *
 * `organizationId` must come from the verified session, never from input.
 */
export async function submitPreview(
  organizationId: string,
  url: string,
): Promise<{ previewId: string; status: Enums<"analysis_status"> }> {
  const ref = parsePullRequestUrl(url);
  const pr = await readPullRequest(ref);
  const db = createAdminClient();
  const projectId = await recordProject(db, organizationId, ref);

  // The same two commits are parsed once per organization. Ignoring the
  // duplicate and reading back means a second paste lands on the first preview.
  const inserted = await db
    .from("pr_previews")
    .upsert(
      {
        organization_id: organizationId,
        project_id: projectId,
        pr_number: ref.number,
        pr_title: pr.title,
        base_sha: pr.baseSha,
        head_sha: pr.headSha,
        changed: pr.changed,
      },
      { onConflict: "project_id,base_sha,head_sha", ignoreDuplicates: true },
    )
    .select("id, status");
  if (inserted.error) throw new Error(`Could not create the preview: ${inserted.error.message}`);
  if (inserted.data.length > 0) return { previewId: inserted.data[0].id, status: inserted.data[0].status };

  const existing = await db
    .from("pr_previews")
    .select("id, status")
    .eq("project_id", projectId)
    .eq("base_sha", pr.baseSha)
    .eq("head_sha", pr.headSha)
    .single();
  if (existing.error) throw new Error(`Could not read the existing preview: ${existing.error.message}`);
  return { previewId: existing.data.id, status: existing.data.status };
}

export type ClaimedPreview = {
  previewId: string;
  repo: RepositoryRef;
  baseSha: string;
  headSha: string;
  changed: ChangedFile[];
};

/**
 * Moves a queued or failed preview into a run, or returns null. A complete
 * preview is never run again: its two commits can't change. A run unfinished
 * past the stale age is assumed dead and may be replaced.
 */
export async function claimPreview(previewId: string): Promise<ClaimedPreview | null> {
  const db = createAdminClient();
  const now = Date.now();
  const staleBefore = new Date(now - STALE_AFTER_MINUTES * 60_000).toISOString();
  const { data, error } = await db
    .from("pr_previews")
    .update({
      status: "parsing",
      stage: "fetch",
      stage_message: "Starting",
      started_at: new Date(now).toISOString(),
      error: null,
      finished_at: null,
    })
    .eq("id", previewId)
    .neq("status", "complete")
    .or(`status.neq.parsing,started_at.lt.${staleBefore}`)
    .select("base_sha, head_sha, changed, project:projects!inner(repo_owner, repo_name)");
  if (error) throw new Error(`Could not start the preview: ${error.message}`);
  if (data.length === 0) return null;
  const row = data[0];
  return {
    previewId,
    repo: { owner: row.project.repo_owner, name: row.project.repo_name },
    baseSha: row.base_sha,
    headSha: row.head_sha,
    changed: readChanged(row.changed),
  };
}

/**
 * Downloads both commits, then parses each with the same parser and adapter
 * detection an analysis uses, and stores both sides in one update. Nothing is
 * labelled by a model: a preview shows what the adapter recognised and no more.
 *
 * Both archives come from the base repository by commit: GitHub serves a fork's
 * pull request head there too, so a fork needs no special case.
 */
export async function executePreview({ previewId, repo, baseSha, headSha, changed }: ClaimedPreview): Promise<void> {
  const db = createAdminClient();
  let workspace: string | undefined;
  try {
    workspace = await mkdtemp(path.join(tmpdir(), "flowlens-preview-"));
    const label = `${repo.owner}/${repo.name}`;
    const checkouts = { base: path.join(workspace, "base"), head: path.join(workspace, "head") };

    for (const [side, sha] of [["base", baseSha], ["head", headSha]] as const) {
      await enter(db, previewId, "fetch", `Downloading ${label} at ${sha.slice(0, 7)} (${side})`);
      const archive = path.join(workspace, `${side}.tar.gz`);
      await downloadArchive(repo, sha, archive);
      await mkdir(checkouts[side]);
      await extractArchive(archive, checkouts[side]);
      await rm(archive);
    }

    const sides: Partial<Record<"base" | "head", PreviewSide>> = {};
    for (const side of ["base", "head"] as const) {
      await enter(db, previewId, "parse", `Parsing the ${side} side`);
      sides[side] = sideFromParse(parseRepository(checkouts[side], detectAdapter(checkouts[side])), changed);
      // Both checkouts are on disk until the base side is parsed: fetching each
      // side just before parsing it would step the shown stages back from
      // parse to fetch, which the progress view reads as a new run. Removing
      // each once parsed only frees its space for what comes after.
      await rm(checkouts[side], { recursive: true, force: true });
    }
    const { base, head } = sides;
    if (!base || !head) throw new Error("A side was not parsed");

    await enter(db, previewId, "store", `Storing ${base.files.length} files before and ${head.files.length} after`);
    const stored = await db
      .from("pr_previews")
      .update({
        status: "complete",
        stage_message: `Stored ${base.files.length} files before and ${head.files.length} after`,
        base,
        head,
        finished_at: new Date().toISOString(),
      })
      .eq("id", previewId)
      .eq("status", "parsing")
      .select("id");
    if (stored.error) throw new Error(`Could not store the preview: ${stored.error.message}`);
    if (stored.data.length === 0) throw new Error("The preview stopped running before it could be stored");
  } catch (error) {
    await fail(db, previewId, error);
  } finally {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  }
}

async function enter(db: Admin, previewId: string, stage: Stage, message: string): Promise<void> {
  const { error } = await db.from("pr_previews").update({ stage, stage_message: message }).eq("id", previewId);
  if (error) throw new Error(`Could not record the ${stage} stage: ${error.message}`);
}

async function fail(db: Admin, previewId: string, cause: unknown): Promise<void> {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const { error } = await db
    .from("pr_previews")
    .update({ status: "failed", error: reason || "Failed without a message", finished_at: new Date().toISOString() })
    .eq("id", previewId)
    // A run replaced as stale can fail after its replacement stored the
    // preview; a stored preview stays stored.
    .neq("status", "complete");
  if (error) throw new Error(`Preview failed (${reason}) and the failure could not be recorded: ${error.message}`);
}
