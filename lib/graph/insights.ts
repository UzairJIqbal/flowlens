import type { Link } from "./reach.ts";

// Four kinds of fact about the edge list. Pure: files and edges in, findings
// out. Each kind has one fixed sentence; nothing here is written per file, and
// nothing grades a file. They describe where the structure is unusual.

export interface InsightFile {
  path: string;
  /** The framework adapter's role; null when no convention identified the file. */
  role: string | null;
  lines: number;
}

export type InsightKind = "unimported" | "heavily-imported" | "cycle" | "oversized";

/**
 * Display order. Files nothing imports leads, because it tells someone where
 * reading starts. Cycles and long files read closer to a verdict, so they sit
 * underneath.
 */
export const INSIGHT_ORDER: readonly InsightKind[] = ["unimported", "heavily-imported", "cycle", "oversized"];

/** Lines past which a file counts as long: ESLint's `max-lines` default, a convention rather than a number picked here. */
export const LONG_FILE_LINES = 300;

export const INSIGHT_SENTENCES: Record<InsightKind, string> = {
  unimported: "Nothing in this repository imports these files, and no framework convention reaches them.",
  "heavily-imported": "Far more files import these than import a typical file in this repository.",
  cycle: "These files import each other in a loop.",
  oversized: `These files are longer than ${LONG_FILE_LINES} lines.`,
};

export interface FileFinding {
  path: string;
  /** What the finding counts: importers for heavily-imported, lines for oversized. */
  count?: number;
}

export interface Cycle {
  /** One concrete loop, in order: each file imports the next, and the last imports the first. */
  loop: string[];
  /**
   * Every file tangled into loops with this one. A tangle can hold many
   * loops; `loop` is the shortest through its first file, so it can be walked
   * by hand.
   */
  tangle: string[];
}

export interface Insights {
  unimported: FileFinding[];
  heavilyImported: FileFinding[];
  cycles: Cycle[];
  oversized: FileFinding[];
  /** The fan-in a file has to exceed to count as heavily imported. */
  fanInFence: number;
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function insights(files: readonly InsightFile[], edges: readonly Link[]): Insights {
  const fanIn = new Map(files.map((f) => [f.path, 0]));
  for (const e of edges) fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1);

  // A role means a framework convention recognised the file, and every such
  // convention is a way the framework reaches it without an import. Reporting
  // those would be the parser describing the limits of its own view as a
  // finding about the code.
  const unimported = files
    .filter((f) => fanIn.get(f.path) === 0 && f.role === null)
    .map((f) => ({ path: f.path }))
    .sort((a, b) => byPath(a.path, b.path));

  const fanInFence = farOutFence([...fanIn.values()]);
  const heavilyImported = files
    .filter((f) => fanIn.get(f.path)! > fanInFence)
    .map((f) => ({ path: f.path, count: fanIn.get(f.path)! }))
    .sort((a, b) => b.count - a.count || byPath(a.path, b.path));

  const oversized = files
    .filter((f) => f.lines > LONG_FILE_LINES)
    .map((f) => ({ path: f.path, count: f.lines }))
    .sort((a, b) => b.count - a.count || byPath(a.path, b.path));

  return {
    unimported,
    heavilyImported,
    cycles: cycles(
      files.map((f) => f.path),
      edges,
    ),
    oversized,
    fanInFence,
  };
}

/**
 * Tukey's "far out" fence, Q3 + 3 × IQR: the standard line for a value that
 * is extreme for its own distribution. Derived from this repository, so a
 * large codebase isn't held to a small one's numbers.
 */
function farOutFence(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  return q3 + 3 * (q3 - q1);
}

/** Linear interpolation between closest ranks, over values already sorted. */
function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/**
 * Every import cycle: each strongly connected component with more than one
 * file, or a file importing itself. Tarjan's algorithm with an explicit stack;
 * a real repository's import chains are deep enough to overflow recursion.
 */
export function cycles(paths: readonly string[], edges: readonly Link[]): Cycle[] {
  const out = new Map<string, string[]>(paths.map((p) => [p, []]));
  for (const e of edges) out.get(e.from)!.push(e.to);
  for (const list of out.values()) list.sort(byPath);

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const root of [...paths].sort(byPath)) {
    if (index.has(root)) continue;
    // Each frame is a file and how many of its edges have been followed.
    const frames: { file: string; next: number }[] = [];
    const enter = (file: string) => {
      index.set(file, counter);
      low.set(file, counter);
      counter++;
      stack.push(file);
      onStack.add(file);
      frames.push({ file, next: 0 });
    };
    enter(root);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const targets = out.get(frame.file)!;
      if (frame.next < targets.length) {
        const to = targets[frame.next++];
        if (!index.has(to)) enter(to);
        else if (onStack.has(to)) low.set(frame.file, Math.min(low.get(frame.file)!, index.get(to)!));
        continue;
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) low.set(parent.file, Math.min(low.get(parent.file)!, low.get(frame.file)!));

      if (low.get(frame.file) === index.get(frame.file)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.file);
        const selfImport = component.length === 1 && targets.includes(frame.file);
        if (component.length > 1 || selfImport) components.push(component.sort(byPath));
      }
    }
  }

  return components
    .map((tangle) => ({ loop: shortestLoop(tangle, out), tangle }))
    .sort((a, b) => b.tangle.length - a.tangle.length || byPath(a.tangle[0], b.tangle[0]));
}

/**
 * The shortest loop from a tangle's first file back to itself, by breadth-first
 * search inside the tangle. One always exists: every file in a strongly
 * connected component reaches every other.
 */
function shortestLoop(tangle: readonly string[], out: ReadonlyMap<string, string[]>): string[] {
  const start = tangle[0];
  const inside = new Set(tangle);
  const cameFrom = new Map<string, string>();
  let level = [start];
  while (level.length > 0) {
    const nextLevel: string[] = [];
    for (const file of level) {
      for (const to of out.get(file)!) {
        if (!inside.has(to)) continue;
        if (to === start) {
          const loop = [file];
          for (let at = file; at !== start; ) {
            at = cameFrom.get(at)!;
            loop.push(at);
          }
          return loop.reverse();
        }
        if (cameFrom.has(to)) continue;
        cameFrom.set(to, file);
        nextLevel.push(to);
      }
    }
    level = nextLevel;
  }
  throw new Error(`no loop back to ${start} inside its own strongly connected component`);
}
