import type { FileNode } from "../parser/types.ts";
import type { FileEdge } from "./view.ts";

// What the detail pane says, derived from the parser's files and edges. Pure,
// so selecting something is a lookup in data the browser already holds.

/** A parser file as the browser holds it; the hash is never shown. */
export type RepoFile = Omit<FileNode, "hash">;

export interface Neighbours {
  /** Files this one imports. */
  imports: string[];
  /** Files that import this one. */
  importedBy: string[];
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every file's direct neighbours in both directions, sorted by path. The
 * parser already merged duplicate imports between a pair, so a list's length
 * is the file's fan-out or fan-in.
 */
export function neighbours(paths: readonly string[], edges: readonly FileEdge[]): Map<string, Neighbours> {
  const result = new Map(paths.map((p): [string, Neighbours] => [p, { imports: [], importedBy: [] }]));
  for (const e of edges) {
    result.get(e.from)!.imports.push(e.to);
    result.get(e.to)!.importedBy.push(e.from);
  }
  for (const n of result.values()) {
    n.imports.sort(byPath);
    n.importedBy.sort(byPath);
  }
  return result;
}

/** What the rest of the repository leans on: imported at least once, most importers first. */
export function mostDependedOn(files: readonly RepoFile[]): RepoFile[] {
  return files.filter((f) => f.fanIn > 0).sort((a, b) => b.fanIn - a.fanIn || byPath(a.path, b.path));
}

/**
 * Files nothing imports, which is where reading starts. The ones that pull in
 * the most come first, since they open onto the most of the repository.
 */
export function importedByNothing(files: readonly RepoFile[]): RepoFile[] {
  return files.filter((f) => f.fanIn === 0).sort((a, b) => b.fanOut - a.fanOut || byPath(a.path, b.path));
}

/**
 * How many files of each kind, most common first. null is a file no
 * convention identified; it is counted, never given a guessed kind.
 */
export function kindCounts(files: readonly Pick<RepoFile, "role">[]): { kind: string | null; count: number }[] {
  const counts = new Map<string | null, number>();
  for (const f of files) counts.set(f.role, (counts.get(f.role) ?? 0) + 1);
  return [...counts]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || byPath(a.kind ?? "", b.kind ?? ""));
}
