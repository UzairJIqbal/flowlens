import { affected, coverageGap, diffGraphs, pairChanges, type CoverageGap, type GraphDiff } from "../graph/diff.ts";
import type { Reached } from "../graph/reach.ts";
import type { Fold } from "../map/fold.ts";
import type { FileEdge } from "../map/view.ts";
import type { ChangedFile } from "../pipeline/github.ts";
import { sideCoverage, type PreviewFile, type PreviewSide } from "./side.ts";

// Both sides of a preview as one picture. Pure, so the map in the browser and
// the explanation on the server compute the same change from the same rows.

/** A file on either side. Its folder and role come from the side after the change when it is there. */
export type CombinedFile = PreviewFile & { onBase: boolean; onHead: boolean };

export type Change = {
  /** Every file on either side, by path. The map lays out over all of them. */
  files: CombinedFile[];
  /** Every import pair on either side; a pair on one side alone carries which. */
  edges: FileEdge[];
  diff: GraphDiff;
  /** Every path GitHub listed as changed, the old name of a rename included. A copy's source is left as it was. */
  changedPaths: string[];
  /** Within two imports of a changed file, on the side after the change. */
  affected: Reached[];
  gap: CoverageGap;
};

export function combine(base: PreviewSide, head: PreviewSide, changed: readonly ChangedFile[]): Change {
  const byPath = new Map<string, CombinedFile>();
  for (const f of base.files) byPath.set(f.path, { ...f, onBase: true, onHead: false });
  for (const f of head.files) byPath.set(f.path, { ...f, onBase: byPath.has(f.path), onHead: true });
  const files = [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1));

  const { added, removed } = pairChanges(base.edges, head.edges);
  const edges: FileEdge[] = [
    ...head.edges.map(({ from, to }) => ({ from, to })),
    ...removed.map(({ from, to }) => ({ from, to, change: "removed" as const })),
  ];
  const addedPairs = new Set(added.map((e) => `${e.from}\0${e.to}`));
  for (const e of edges) if (addedPairs.has(`${e.from}\0${e.to}`)) e.change = "added";

  const changedPaths = [
    ...new Set(
      changed.flatMap((c) => {
        const old = oldName(c);
        return old === null ? [c.path] : [c.path, old];
      }),
    ),
  ].sort();
  const sides = (s: PreviewSide) => ({ files: s.files.map((f) => f.path), edges: s.edges });

  return {
    files,
    edges: edges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0)),
    diff: diffGraphs(sides(base), sides(head)),
    changedPaths,
    affected: affected(changedPaths, head.edges),
    gap: coverageGap(sideCoverage(base), sideCoverage(head)),
  };
}

/**
 * The path a rename moved away from, which no longer exists after the change.
 * A copy also reports where it came from, but its source is untouched, so it
 * isn't changed and stays in the blast radius like any other file.
 */
export function oldName(c: ChangedFile): string | null {
  return c.status === "renamed" ? c.previousPath : null;
}

/**
 * The boxes a preview starts with open: every one holding a changed file, so
 * the marks and the imports changed inside a box are on screen before any
 * click. Paths no side parsed have no box.
 */
export function changedBoxes(fold: Fold, changedPaths: readonly string[]): Set<string> {
  return new Set(changedPaths.flatMap((p) => {
    const box = fold.nodeOf.get(p);
    return box === undefined ? [] : [box];
  }));
}

/** GitHub's status as one letter, the way `git status --short` writes it. */
export function changeLetter(status: ChangedFile["status"]): string {
  switch (status) {
    case "added":
      return "A";
    case "removed":
      return "D";
    case "modified":
      return "M";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "changed":
      return "T";
    case "unchanged":
      return "U";
  }
}
