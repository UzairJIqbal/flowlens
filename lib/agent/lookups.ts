import type { StoredMap } from "../analyses/map.ts";
import { DEFAULT_DEPTH, reach, type Direction } from "../graph/reach.ts";
import { categoryCounts, kindsOf } from "../map/categories.ts";
import { importedByNothing, mostDependedOn, neighbours, type RepoFile } from "../map/detail.ts";

// What each of the agent's six lookups answers, from the stored map and the
// same functions that draw the canvas: the rail's categories, the detail
// pane's neighbours and lists, the blast-radius walk. Nothing here decides a
// relationship; every file named next to another is there because a stored
// edge put it there. Pure, so the answer is the canvas's answer.
//
// Roles are convention's alone, as on the map. A model's label is a guess
// about a file convention left unidentified, and the agent is told to treat an
// unidentified file as unidentified, so it never sees one.

/** A lookup the model got wrong (a path or role the analysis doesn't have), with why. */
export class LookupMiss extends Error {}

/** Long lists are cut, and say so: a cut list must never read as the whole. */
const LIST = 100;
const TOP = 10;

type Listed<T> = { total: number; listed: number; files: T[] };

function list<T>(items: readonly T[], limit: number): Listed<T> {
  return { total: items.length, listed: Math.min(items.length, limit), files: items.slice(0, limit) };
}

function entry(f: RepoFile) {
  return { path: f.path, role: f.role, imports: f.fanOut, importedBy: f.fanIn };
}

function fileAt(map: StoredMap, path: string): RepoFile {
  const file = map.files.find((f) => f.path === path);
  if (!file) throw new LookupMiss(`No file at ${path} in this analysis. Paths must match exactly; find_files can locate one.`);
  return file;
}

export function analysisSummary(map: StoredMap) {
  const kinds = kindsOf(map.adapter);
  const counts = categoryCounts(map.files, map.adapter);
  return {
    repository: `${map.repoOwner}/${map.repoName}`,
    commit: map.commitSha,
    framework: kinds.framework,
    files: { parsed: map.coverage.parsed, skipped: map.coverage.skipped },
    imports: map.edges.length,
    roles: counts.filter((c) => c.role !== null).map((c) => ({ role: c.role, name: kinds.label(c.role), files: c.count })),
    unidentified: counts.find((c) => c.role === null)?.count ?? 0,
    routes: { found: map.routes.length, withheld: map.withheldRoutes.length },
    mostImported: list(mostDependedOn(map.files).map(entry), TOP),
    importedByNothing: list(importedByNothing(map.files).map(entry), TOP),
  };
}

export function findFiles(map: StoredMap, match: string) {
  const needle = match.toLowerCase();
  return { match, ...list(map.files.filter((f) => f.path.toLowerCase().includes(needle)).map(entry), LIST) };
}

export function filesByRole(map: StoredMap, role: string) {
  const kinds = kindsOf(map.adapter);
  const present = categoryCounts(map.files, map.adapter).flatMap((c) => (c.role === null ? [] : [c.role]));
  if (!present.includes(role)) {
    throw new LookupMiss(`No files have the role ${role}. The roles in this analysis are: ${present.join(", ") || "none"}.`);
  }
  return { role, name: kinds.label(role), ...list(map.files.filter((f) => f.role === role).map(entry), LIST) };
}

export function fileNeighbours(map: StoredMap, path: string) {
  const file = fileAt(map, path);
  const byPath = new Map(map.files.map((f) => [f.path, f]));
  const around = neighbours(
    map.files.map((f) => f.path),
    map.edges,
  ).get(path)!;
  const described = (p: string) => ({ path: p, role: byPath.get(p)!.role });
  return { path, role: file.role, imports: around.imports.map(described), importedBy: around.importedBy.map(described) };
}

export function walkGraph(map: StoredMap, path: string, direction: Direction) {
  fileAt(map, path);
  const byPath = new Map(map.files.map((f) => [f.path, f]));
  // The whole walk, never cut: a blast radius with files missing would
  // understate what may break.
  const files = reach(map.edges, path, direction, DEFAULT_DEPTH).map((r) => ({ ...r, role: byPath.get(r.path)!.role }));
  return { start: path, direction, depth: DEFAULT_DEPTH, total: files.length, files };
}

export function routeTable(map: StoredMap) {
  const kinds = kindsOf(map.adapter);
  return {
    framework: kinds.framework,
    // Without a route convention there are no routes to read, which is not
    // the same as a repository with none.
    routeConvention: kinds.routed,
    routes: map.routes,
    withheld: map.withheldRoutes,
  };
}
