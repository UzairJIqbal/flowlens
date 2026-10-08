import type { FileNode } from "../parser/types.ts";
import type { FileEdge } from "./view.ts";

// What the detail pane says, derived from the parser's files and edges. Pure,
// so selecting something is a lookup in data the browser already holds.

/**
 * A parser file as the browser holds it; the hash is never shown, and export
 * names aren't stored. `role` is only ever convention's. `label` is a model's
 * role for a file convention left unidentified, kept apart so the map's
 * categories and routes stay convention's alone.
 */
export type RepoFile = Omit<FileNode, "hash" | "exports"> & { label: string | null };

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
