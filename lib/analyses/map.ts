import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { RepoFile } from "@/lib/map/detail";
import type { FileEdge } from "@/lib/map/view";
import { fanInOut } from "@/lib/parser/graph";
import type { EdgeKind, OutcomeCounts } from "@/lib/parser/types";
import { readEvery } from "./stored";

export type StoredRoute = { method: string; path: string; file: string; line: number };
export type StoredWithheldRoute = { file: string; line: number; reason: string };
/** An edge with every kind of import behind it, as the parser merged them. */
export type StoredEdge = FileEdge & { kinds: EdgeKind[] };

/**
 * The parser's coverage as stored, minus the per-kind breakdown: analyses
 * stored before `require` was parsed have no entry for it, and a breakdown
 * with a kind missing would read as none of that kind.
 */
export type StoredCoverage = {
  files: { found: number; parsed: number; skipped: number };
  imports: OutcomeCounts;
  unresolvedByReason: Record<string, number>;
  excludedByReason: Record<string, number>;
};

export type StoredMap = {
  repoOwner: string;
  repoName: string;
  commitSha: string;
  adapter: string;
  status: string;
  /** When the stored graph was made; null while a re-run is going. */
  finishedAt: string | null;
  coverage: StoredCoverage;
  files: RepoFile[];
  edges: StoredEdge[];
  routes: StoredRoute[];
  withheldRoutes: StoredWithheldRoute[];
};

/** The stored graph of one analysis, read as the signed-in user. */
export async function getStoredMap(analysisId: string): Promise<StoredMap | null> {
  return readStoredMap(await createSupabaseClient(), analysisId);
}

/**
 * The stored graph of one analysis, as whoever the client reads as: the
 * signed-in user for the map, the agent's credential for its lookups. Null
 * when the policy doesn't return the analysis or nothing has been stored for
 * it yet. The last stored graph stays readable while a re-run is going,
 * because the store replaces it in one transaction at the very end.
 */
export async function readStoredMap(supabase: SupabaseClient<Database>, analysisId: string): Promise<StoredMap | null> {
  const analysis = await supabase
    .from("analyses")
    .select("status, commit_sha, finished_at, adapter, coverage, withheld_routes, project:projects!inner(repo_owner, repo_name)")
    .eq("id", analysisId)
    .maybeSingle();
  if (analysis.error) throw new Error(`Could not load the analysis: ${analysis.error.message}`);
  const { data } = analysis;
  if (!data || data.commit_sha === null) return null;

  const fileRows = await readEvery("files", (from, to) =>
    supabase
      .from("files")
      .select("id, path, folder, lines, file_roles(role, source)", { count: "exact" })
      .eq("analysis_id", analysisId)
      .order("path")
      .range(from, to),
  );
  const edgeRows = await readEvery("edges", (from, to) =>
    supabase
      .from("edges")
      .select("source_file_id, target_file_id, kinds", { count: "exact" })
      .eq("analysis_id", analysisId)
      .order("id")
      .range(from, to),
  );

  const routeRows = await readEvery("routes", (from, to) =>
    supabase
      .from("routes")
      .select("file_id, line, method, path", { count: "exact" })
      .eq("analysis_id", analysisId)
      .order("id")
      .range(from, to),
  );

  const pathOf = new Map(fileRows.map((f) => [f.id, f.path]));
  const edges = edgeRows.map((e) => {
    const from = pathOf.get(e.source_file_id);
    const to = pathOf.get(e.target_file_id);
    // The store guarantees this can't happen; if it does, the map is wrong.
    if (from === undefined || to === undefined) throw new Error("A stored edge points at a file that wasn't read");
    return { from, to, kinds: e.kinds };
  });

  const routes = routeRows.map((r) => {
    const file = pathOf.get(r.file_id);
    if (file === undefined) throw new Error("A stored route points at a file that wasn't read");
    return { method: r.method, path: r.path, file, line: r.line };
  });

  const fan = fanInOut(
    fileRows.map((f) => f.path),
    edges,
  );
  const files = fileRows.map((f) => ({
    path: f.path,
    folder: f.folder,
    lines: f.lines,
    // The map shows what the adapter recognised by convention; a model's
    // label sits beside it and is shown only in the detail pane.
    role: f.file_roles.find((r) => r.source === "convention")?.role ?? null,
    label: f.file_roles.find((r) => r.source === "model")?.role ?? null,
    fanIn: fan.get(f.path)?.fanIn ?? 0,
    fanOut: fan.get(f.path)?.fanOut ?? 0,
  }));

  return {
    repoOwner: data.project.repo_owner,
    repoName: data.project.repo_name,
    commitSha: data.commit_sha,
    adapter: data.adapter ?? "none",
    status: data.status,
    finishedAt: data.finished_at,
    coverage: storedCoverage(data.coverage),
    files,
    edges,
    routes,
    withheldRoutes: withheld(data.withheld_routes),
  };
}

/**
 * Coverage is stored as the parser's JSON, and checked rather than assumed: a
 * count that isn't there is an error, never a zero.
 */
export function storedCoverage(coverage: Json | null): StoredCoverage {
  const files = field(coverage, "files");
  const imports = field(coverage, "imports");
  return {
    files: { found: count(files, "found"), parsed: count(files, "parsed"), skipped: count(files, "skipped") },
    imports: {
      seen: count(imports, "seen"),
      internal: count(imports, "internal"),
      external: count(imports, "external"),
      excluded: count(imports, "excluded"),
      unresolved: count(imports, "unresolved"),
    },
    unresolvedByReason: counts(field(coverage, "unresolvedByReason")),
    excludedByReason: counts(field(coverage, "excludedByReason")),
  };
}

function count(value: Json | undefined, key: string): number {
  const n = field(value, key);
  if (typeof n !== "number") throw new Error(`The stored coverage has no ${key} count`);
  return n;
}

function counts(value: Json | undefined): Record<string, number> {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The stored coverage is missing its reasons");
  }
  return Object.fromEntries(
    Object.entries(value).map(([reason, n]) => {
      if (typeof n !== "number") throw new Error(`The stored coverage has a non-number count for ${reason}`);
      return [reason, n];
    }),
  );
}

// Stored as the parser's JSON; each entry is checked rather than assumed. An
// analysis stored before routes existed has none, which reads as none withheld.
function withheld(value: Json | null): StoredWithheldRoute[] {
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error("The stored withheld routes aren't a list");
  return value.map((entry) => {
    const file = field(entry, "file");
    const line = field(entry, "line");
    const reason = field(entry, "reason");
    if (typeof file !== "string" || typeof line !== "number" || typeof reason !== "string") {
      throw new Error("A stored withheld route is missing its file, line or reason");
    }
    return { file, line, reason };
  });
}

/** Reads a property only from a JSON object, returning undefined for other values. */
function field(value: Json | undefined | null, key: string): Json | undefined {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value[key];
}
