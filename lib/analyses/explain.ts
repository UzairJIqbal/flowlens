"use server";

import { createHash } from "node:crypto";
import { sessionCache } from "@/lib/ai/cache";
import { MODEL } from "@/lib/ai/client";
import { explainFile as explainFileFrom, explainFolder as explainFolderFrom, type Described } from "@/lib/ai/explain";
import { neighbours } from "@/lib/map/detail";
import { fold } from "@/lib/map/fold";
import { fetchFile, resolveHead, type RepositoryRef } from "@/lib/pipeline/github";
import { createSupabaseClient } from "@/lib/supabase/server";
import { frameworkOf } from "@/lib/taxonomy";
import { readEvery } from "./map";

export type Explained = { ok: true; text: string; cached: boolean; model: string } | { ok: false; error: string };

/**
 * Explains one file from its stored neighbours. Everything the model is handed
 * is read here, as the user, from what the parser stored; nothing comes from
 * the browser but which file.
 */
export async function explainFile(analysisId: string, path: string): Promise<Explained> {
  return answer(async () => {
    const stored = await readStored(analysisId);
    const file = stored.files.find((f) => f.path === path);
    if (!file) throw new Error(`${path} isn't in this analysis`);
    const around = neighbours(
      stored.files.map((f) => f.path),
      stored.edges,
    ).get(path)!;
    const described = new Map(stored.files.map((f) => [f.path, stored.describe(f)]));
    const facts = {
      repository: stored.name,
      commit: stored.commit,
      framework: stored.framework,
      file: { ...described.get(path)!, lines: file.lines, hash: file.hash },
      imports: around.imports.map((p) => described.get(p)!),
      importedBy: around.importedBy.map((p) => described.get(p)!),
    };
    return explainFileFrom(facts, stored.cache, async () => {
      // The source the parser read, at the analysed commit, and checked to be it.
      const bytes = await fetchFile(stored.repo, stored.commit, path);
      if (bytes === null) throw new Error(`GitHub no longer serves ${path} at ${stored.commit.slice(0, 7)}`);
      if (sha256(bytes) !== file.hash) {
        throw new Error(`GitHub's copy of ${path} at ${stored.commit.slice(0, 7)} isn't what was parsed`);
      }
      return bytes.toString("utf8");
    });
  });
}

/** Explains a folded folder: what it holds, and why so much points at it. */
export async function explainFolder(analysisId: string, folder: string): Promise<Explained> {
  return answer(async () => {
    const stored = await readStored(analysisId);
    // The same pure fold the map ran over the same files, so this is the node on screen.
    const node = fold(stored.files).nodes.find((n) => n.id === folder);
    if (!node) throw new Error(`${folder} isn't a folder on this map`);
    const inside = new Set(node.files);
    const byPath = new Map(stored.files.map((f) => [f.path, f]));
    const facts = {
      repository: stored.name,
      commit: stored.commit,
      framework: stored.framework,
      folder,
      files: node.files.map((p) => ({ ...stored.describe(byPath.get(p)!), lines: byPath.get(p)!.lines })),
      incoming: stored.edges.filter((e) => !inside.has(e.from) && inside.has(e.to)),
      outgoing: stored.edges.filter((e) => inside.has(e.from) && !inside.has(e.to)),
      internal: stored.edges.filter((e) => inside.has(e.from) && inside.has(e.to)).length,
    };
    return explainFolderFrom(facts, stored.cache);
  });
}

export type Freshness =
  | { state: "current"; commit: string }
  /** `file` is null for a folder, which is checked only against the commit. */
  | { state: "moved"; commit: string; head: string; file: "changed" | "removed" | "unchanged" | null }
  | { state: "unknown"; reason: string };

/**
 * Whether the repository has moved past the analysed commit, and for a file,
 * whether its content did. Compares the stored hash with the file at the
 * current head.
 */
export async function checkFreshness(analysisId: string, path: string | null): Promise<Freshness> {
  try {
    const supabase = await createSupabaseClient();
    const analysis = await readAnalysis(supabase, analysisId);
    const head = await resolveHead(analysis.repo);
    if (head === analysis.commit) return { state: "current", commit: analysis.commit };
    if (path === null) return { state: "moved", commit: analysis.commit, head, file: null };

    const stored = await supabase
      .from("files")
      .select("hash")
      .eq("analysis_id", analysisId)
      .eq("path", path)
      .maybeSingle();
    if (stored.error) throw new Error(`Could not read the file: ${stored.error.message}`);
    if (!stored.data) throw new Error(`${path} isn't in this analysis`);
    const now = await fetchFile(analysis.repo, head, path);
    const file = now === null ? "removed" : sha256(now) === stored.data.hash ? "unchanged" : "changed";
    return { state: "moved", commit: analysis.commit, head, file };
  } catch (error) {
    return { state: "unknown", reason: reason(error) };
  }
}

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

async function readAnalysis(supabase: Supabase, analysisId: string) {
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

type StoredFile = { path: string; folder: string; lines: number; hash: string; role: string | null; by: Described["by"] };

/** The stored graph, read as the user, with everything an explanation needs around it. */
async function readStored(analysisId: string) {
  const supabase = await createSupabaseClient();
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
    repo: analysis.repo,
    name: `${analysis.repo.owner}/${analysis.repo.name}`,
    commit: analysis.commit,
    framework: framework.label,
    files,
    edges,
    cache: sessionCache(supabase, analysis.organizationId),
    describe: (f: StoredFile): Described => ({
      path: f.path,
      // Convention's roles are named the way the framework's docs name them.
      kind: f.role === null ? null : f.by === "convention" ? (framework.roles.find((r) => r.role === f.role)?.one ?? f.role) : f.role,
      by: f.by,
    }),
  };
}

async function answer(explain: () => Promise<{ output: string; cached: boolean }>): Promise<Explained> {
  try {
    const { output, cached } = await explain();
    return { ok: true, text: output, cached, model: MODEL };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
