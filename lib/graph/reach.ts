// Blast radius and dependency chain: one transitive walk over the edge list,
// pointed in either direction. Pure; the browser already holds the edges, so
// the answer is arithmetic and never a request.

export interface Link {
  from: string;
  to: string;
}

/**
 * "dependents" walks against the edges: everything that imports this file,
 * then everything importing those — what breaks if it changes. "dependencies"
 * walks with them: everything this file needs to work.
 */
export type Direction = "dependents" | "dependencies";

/** Past two levels the walk returns most of a repository and stops being an answer. */
export const DEFAULT_DEPTH = 2;

export interface Reached {
  path: string;
  /** How many edges from the start: 1 is a direct neighbour. */
  depth: number;
}

/**
 * Every file within `depth` edges of `start`, nearest first and by path within
 * a level. Each file appears once, at the shortest distance it's reached by;
 * the start never appears, even when a cycle leads back to it.
 */
export function reach(
  edges: readonly Link[],
  start: string,
  direction: Direction,
  depth: number = DEFAULT_DEPTH,
): Reached[] {
  const next = new Map<string, string[]>();
  for (const e of edges) {
    const [a, b] = direction === "dependencies" ? [e.from, e.to] : [e.to, e.from];
    const list = next.get(a);
    if (list) list.push(b);
    else next.set(a, [b]);
  }

  const seen = new Set([start]);
  const reached: Reached[] = [];
  let level = [start];
  for (let d = 1; d <= depth && level.length > 0; d++) {
    const found: string[] = [];
    for (const file of level) {
      for (const n of next.get(file) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        found.push(n);
      }
    }
    found.sort();
    for (const path of found) reached.push({ path, depth: d });
    level = found;
  }
  return reached;
}
