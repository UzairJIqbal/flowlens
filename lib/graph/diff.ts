import type { EdgeKind } from "../parser/types.ts";
import { DEFAULT_DEPTH, reach, type Link, type Reached } from "./reach.ts";

// What a change did to the structure: set arithmetic over two parses of the
// same repository. Pure; both sides come from the parser, unchanged, and
// nothing here decides that an edge exists.

/** One side of a change, as the parser left it. */
export interface Side {
  files: readonly string[];
  edges: readonly { from: string; to: string; kinds: readonly EdgeKind[] }[];
}

/**
 * The unit the diff compares. An edge is the same edge on both sides when its
 * source file, target file and kind all match. The parser merges every import
 * between two files into one edge carrying several kinds; here that edge is
 * one triple per kind, so a pair whose import became a re-export shows as one
 * removed and one added. Type-only-ness is not part of the identity.
 */
export interface KindedEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface GraphDiff {
  addedFiles: string[];
  removedFiles: string[];
  addedEdges: KindedEdge[];
  removedEdges: KindedEdge[];
}

const key = (e: KindedEdge) => `${e.from}\0${e.to}\0${e.kind}`;

/** Every kinded edge on a side, keyed by identity. */
function triples(side: Side): Map<string, KindedEdge> {
  const out = new Map<string, KindedEdge>();
  for (const e of side.edges) {
    for (const kind of e.kinds) {
      const t = { from: e.from, to: e.to, kind };
      out.set(key(t), t);
    }
  }
  return out;
}

const byEdge = (a: KindedEdge, b: KindedEdge) =>
  a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;

/**
 * Added and removed files and edges, head against base. Renames aren't matched:
 * a renamed file is one removed and one added, because pairing them would be a
 * guess. Every list is sorted, so the same two sides always give the same diff.
 */
export function diffGraphs(base: Side, head: Side): GraphDiff {
  const baseFiles = new Set(base.files);
  const headFiles = new Set(head.files);
  const baseEdges = triples(base);
  const headEdges = triples(head);
  return {
    addedFiles: [...headFiles].filter((f) => !baseFiles.has(f)).sort(),
    removedFiles: [...baseFiles].filter((f) => !headFiles.has(f)).sort(),
    addedEdges: [...headEdges].filter(([k]) => !baseEdges.has(k)).map(([, e]) => e).sort(byEdge),
    removedEdges: [...baseEdges].filter(([k]) => !headEdges.has(k)).map(([, e]) => e).sort(byEdge),
  };
}

/**
 * The files that could break because of a change: everything importing a
 * changed file, two levels out, on the head side. The walk is the blast radius
 * the canvas already uses, run from each changed file; a file reached from
 * several is kept at its nearest. Changed files themselves aren't listed:
 * they are already the change. A changed file that no longer exists on the
 * head side has nothing to walk from there.
 */
export function affected(changed: readonly string[], headEdges: readonly Link[], depth = DEFAULT_DEPTH): Reached[] {
  const starts = new Set(changed);
  const nearest = new Map<string, number>();
  for (const start of starts) {
    for (const { path, depth: d } of reach(headEdges, start, "dependents", depth)) {
      if (starts.has(path)) continue;
      const known = nearest.get(path);
      if (known === undefined || d < known) nearest.set(path, d);
    }
  }
  return [...nearest]
    .map(([path, d]) => ({ path, depth: d }))
    .sort((a, b) => a.depth - b.depth || (a.path < b.path ? -1 : 1));
}

/**
 * What the coverage comparison reads from one side. `unparsed` counts the files
 * the parser refused to read (too large, symbolic links); declaration files and
 * files that aren't JS or TS are left out, so a pull request that only adds
 * documentation doesn't move the share.
 */
export interface SideCoverage {
  files: { parsed: number; unparsed: number };
  imports: { internal: number; unresolved: number };
}

/** Two shares as fractions, null when there was nothing to count. */
export interface Shares {
  /** Parsed files out of those the parser could have parsed. */
  files: number | null;
  /** Imports resolved to a repository file, out of those that were either resolved or unresolved. */
  imports: number | null;
}

export function shares(coverage: SideCoverage): Shares {
  const { parsed, unparsed } = coverage.files;
  const { internal, unresolved } = coverage.imports;
  return {
    files: parsed + unparsed === 0 ? null : parsed / (parsed + unparsed),
    imports: internal + unresolved === 0 ? null : internal / (internal + unresolved),
  };
}

/**
 * Past this, a difference in coverage between the two sides is large enough to
 * show up in the diff as imports that appeared or vanished only because one
 * parse resolved more than the other. Two percentage points.
 */
export const COVERAGE_GAP = 0.02;

export interface CoverageGap {
  base: Shares;
  head: Shares;
  /** Which shares differ by more than COVERAGE_GAP. Empty when the sides are comparable. */
  differs: ("files" | "imports")[];
}

/** Compares the two sides' coverage before anyone reads the diff built on top of them. */
export function coverageGap(base: SideCoverage, head: SideCoverage): CoverageGap {
  const b = shares(base);
  const h = shares(head);
  const differs = (["files", "imports"] as const).filter((k) => {
    const x = b[k];
    const y = h[k];
    // One side had nothing to count and the other did: not comparable either.
    if (x === null || y === null) return x !== y;
    return Math.abs(x - y) > COVERAGE_GAP;
  });
  return { base: b, head: h, differs };
}

/**
 * The file pairs whose line appears or disappears on the map. A pair present
 * on both sides is drawn unchanged even if its kinds changed; the kind change
 * is still in the diff's edge lists.
 */
export function pairChanges(base: readonly Link[], head: readonly Link[]): { added: Link[]; removed: Link[] } {
  const pair = (e: Link) => `${e.from}\0${e.to}`;
  const inBase = new Set(base.map(pair));
  const inHead = new Set(head.map(pair));
  return {
    added: head.filter((e) => !inBase.has(pair(e))),
    removed: base.filter((e) => !inHead.has(pair(e))),
  };
}
