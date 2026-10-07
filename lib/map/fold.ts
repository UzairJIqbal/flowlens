// Folding: which directories get a node of their own. Pure, no React, no I/O.
//
// Every directory starts as a node holding its own files. From the deepest
// level upward, a directory holding fewer than `threshold` files merges into
// its parent. The threshold starts at "a couple" and rises only until the map
// is readable, so the repository's shape decides the depth, not a constant.

/** Roughly how many nodes someone can read at once. */
export const MAX_NODES = 24;
const FIRST_THRESHOLD = 2;

export interface FoldedNode {
  /** The directory this node stands for. "." is the repository root. */
  id: string;
  /** Every file it holds, its own and any merged up from below, sorted. */
  files: string[];
}

export interface Fold {
  threshold: number;
  nodes: FoldedNode[];
  /** File path → id of the node holding it. */
  nodeOf: Map<string, string>;
}

export function parentOf(dir: string): string | null {
  if (dir === ".") return null;
  const slash = dir.lastIndexOf("/");
  return slash === -1 ? "." : dir.slice(0, slash);
}

const depthOf = (dir: string): number => (dir === "." ? 0 : dir.split("/").length);

export function fold(files: readonly { path: string; folder: string }[]): Fold {
  for (let threshold = FIRST_THRESHOLD; ; threshold++) {
    const nodes = foldAt(files, threshold);
    // Terminates: once the threshold exceeds the file count, everything ends
    // up in the root and there is one node.
    if (nodes.length <= MAX_NODES || threshold > files.length) {
      const nodeOf = new Map<string, string>();
      for (const node of nodes) for (const f of node.files) nodeOf.set(f, node.id);
      return { threshold, nodes, nodeOf };
    }
  }
}

function foldAt(files: readonly { path: string; folder: string }[], threshold: number): FoldedNode[] {
  // Intermediate directories with no files of their own still exist, so a
  // merge always has a parent to land in.
  const holdings = new Map<string, string[]>();
  const ensure = (dir: string): string[] => {
    let held = holdings.get(dir);
    if (!held) {
      held = [];
      holdings.set(dir, held);
      const parent = parentOf(dir);
      if (parent !== null) ensure(parent);
    }
    return held;
  };
  for (const f of files) ensure(f.folder).push(f.path);

  const byDepth = new Map<number, string[]>();
  for (const dir of holdings.keys()) {
    const d = depthOf(dir);
    byDepth.set(d, [...(byDepth.get(d) ?? []), dir]);
  }

  for (let depth = Math.max(...byDepth.keys()); depth > 0; depth--) {
    // Decide every merge at this depth before applying any of them, so no
    // merge here changes what a sibling sees.
    const merging = (byDepth.get(depth) ?? []).filter((dir) => holdings.get(dir)!.length < threshold);
    for (const dir of merging) {
      holdings.get(parentOf(dir)!)!.push(...holdings.get(dir)!);
      holdings.delete(dir);
    }
  }

  return [...holdings]
    .filter(([, held]) => held.length > 0)
    .map(([id, held]) => ({ id, files: [...held].sort() }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
