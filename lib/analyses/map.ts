import { createSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import type { RepoFile } from "@/lib/map/detail";
import type { FileEdge } from "@/lib/map/view";
import { fanInOut } from "@/lib/parser/graph";
import { readEvery } from "./stored";

export type StoredRoute = { method: string; path: string; file: string; line: number };
export type StoredWithheldRoute = { file: string; line: number; reason: string };

export type StoredMap = {
  repoOwner: string;
  repoName: string;
  commitSha: string;
  adapter: string;
  status: string;
  coverage: { parsed: number; skipped: number };
  files: RepoFile[];
  edges: FileEdge[];
  routes: StoredRoute[];
  withheldRoutes: StoredWithheldRoute[];
};

/**
 * The stored graph of one analysis, read as the signed-in user. Null when the
 * policy doesn't return the analysis or nothing has been stored for it yet.
 * The last stored graph stays readable while a re-run is going, because the
 * store replaces it in one transaction at the very end.
 */
export async function getStoredMap(analysisId: string): Promise<StoredMap | null> {
  const supabase = await createSupabaseClient();

  const analysis = await supabase
    .from("analyses")
    .select("status, commit_sha, adapter, coverage, withheld_routes, project:projects!inner(repo_owner, repo_name)")
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
      .select("source_file_id, target_file_id", { count: "exact" })
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
    return { from, to };
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
    coverage: fileCoverage(data.coverage),
    files,
    edges,
    routes,
    withheldRoutes: withheld(data.withheld_routes),
  };
}

/**
 * Coverage is stored as the parser's JSON. Only the file counts are read here,
 * and they're checked rather than assumed.
 */
function fileCoverage(coverage: Json | null): { parsed: number; skipped: number } {
  const files = field(coverage, "files");
  const parsed = field(files, "parsed");
  const skipped = field(files, "skipped");
  if (typeof parsed !== "number" || typeof skipped !== "number") {
    throw new Error("The stored coverage has no file counts");
  }
  return { parsed, skipped };
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
