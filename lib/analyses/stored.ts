import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Described, FileFacts } from "../ai/explain.ts";
import { neighbours } from "../map/detail.ts";
import { fetchFile, type RepositoryRef } from "../pipeline/github.ts";
import type { Database } from "../supabase/database.types.ts";
import { frameworkOf } from "../taxonomy.ts";

// The stored graph and what an explanation is built from, over any client: the
// app reads as the signed-in user, the evals with the secret key. Relative
// imports, so a plain script can run it. One copy, so an eval's facts are the
// app's facts.

// Supabase caps rows per request, so a large repository is read in pages.
const PAGE = 1000;

type Page<T> = { data: T[] | null; error: { message: string } | null; count: number | null };

/**
 * Reads until the count is reached. Coming up short throws: a map missing
 * files must never render as though it were the whole repository.
 */
export async function readEvery<T>(what: string, page: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  let total: number | null = null;
  for (;;) {
    const { data, error, count } = await page(rows.length, rows.length + PAGE - 1);
    if (error) throw new Error(`Could not read the stored ${what}: ${error.message}`);
    total ??= count;
    if (total === null) throw new Error(`No count came back for the stored ${what}`);
    if (!data || data.length === 0 || rows.length + data.length > total) break;
    rows.push(...data);
    if (rows.length === total) break;
  }
  if (rows.length !== total) throw new Error(`Read ${rows.length} of ${total} stored ${what}`);
  return rows;
}

type Reader = SupabaseClient<Database>;

export async function readAnalysis(supabase: Reader, analysisId: string) {
  const { data, error } = await supabase
    .from("analyses")
    .select("organization_id, commit_sha, adapter, project:projects!inner(repo_owner, repo_name)")
    .eq("id", analysisId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the analysis: ${error.message}`);
  // The policy returns nothing for another organization's analysis.
  if (!data) throw new Error("This analysis isn't in your organization");
  if (data.commit_sha === null) throw new Error("Nothing has been stored for this analysis yet");
  const repo: RepositoryRef = { owner: data.project.repo_owner, name: data.project.repo_name };
  return { organizationId: data.organization_id, commit: data.commit_sha, adapter: data.adapter ?? "none", repo };
}

export type StoredFile = {
  path: string;
  folder: string;
  lines: number;
  hash: string;
  role: string | null;
  by: Described["by"];
};

export type Stored = Awaited<ReturnType<typeof readStored>>;

/** The stored graph, with everything an explanation needs around it. */
export async function readStored(supabase: Reader, analysisId: string) {
  const analysis = await readAnalysis(supabase, analysisId);

  const fileRows = await readEvery("files", (from, to) =>
    supabase
      .from("files")
      .select("id, path, folder, lines, hash, file_roles(role, source)", { count: "exact" })
      .eq("analysis_id", analysisId)
      .order("path")
      .range(from, to),
  );
  const edgeRows = await readEvery("edges", (from, to) =>
    supabase
      .from("edges")
      .select("source_file_id, target_file_id", { count: "exact" })
      .eq("analysis_id", analysisId)
      .order("id")
      .range(from, to),
  );

  const pathOf = new Map(fileRows.map((f) => [f.id, f.path]));
  const edges = edgeRows.map((e) => {
    const from = pathOf.get(e.source_file_id);
    const to = pathOf.get(e.target_file_id);
    // A re-run stored between the two reads; the next attempt reads one graph.
    if (from === undefined || to === undefined) throw new Error("The analysis changed while it was being read. Try again.");
    return { from, to };
  });

  const files: StoredFile[] = fileRows.map((f) => {
    // At most one role per file: convention's, or failing that a model's.
    const role = f.file_roles[0];
    return { path: f.path, folder: f.folder, lines: f.lines, hash: f.hash, role: role?.role ?? null, by: role?.source ?? null };
  });

  const framework = frameworkOf(analysis.adapter);
  return {
    organizationId: analysis.organizationId,
    repo: analysis.repo,
    name: `${analysis.repo.owner}/${analysis.repo.name}`,
    commit: analysis.commit,
    framework: framework.label,
    files,
    edges,
    describe: (f: StoredFile): Described => ({
      path: f.path,
      // Convention's roles are named the way the framework's docs name them.
      kind: f.role === null ? null : f.by === "convention" ? (framework.roles.find((r) => r.role === f.role)?.one ?? f.role) : f.role,
      by: f.by,
    }),
  };
}

/** What the model is told about one file: itself and every stored neighbour. */
export function fileFacts(stored: Stored, path: string): FileFacts {
  const file = stored.files.find((f) => f.path === path);
  if (!file) throw new Error(`${path} isn't in this analysis`);
  const around = neighbours(
    stored.files.map((f) => f.path),
    stored.edges,
  ).get(path)!;
  const described = new Map(stored.files.map((f) => [f.path, stored.describe(f)]));
  return {
    repository: stored.name,
    commit: stored.commit,
    framework: stored.framework,
    file: { ...described.get(path)!, lines: file.lines, hash: file.hash },
    imports: around.imports.map((p) => described.get(p)!),
    importedBy: around.importedBy.map((p) => described.get(p)!),
  };
}

/** The source the parser read, at the analysed commit, and checked to be it. */
export async function parsedSource(repo: RepositoryRef, commit: string, path: string, hash: string): Promise<string> {
  const bytes = await fetchFile(repo, commit, path);
  if (bytes === null) throw new Error(`GitHub no longer serves ${path} at ${commit.slice(0, 7)}`);
  if (sha256(bytes) !== hash) throw new Error(`GitHub's copy of ${path} at ${commit.slice(0, 7)} isn't what was parsed`);
  return bytes.toString("utf8");
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
