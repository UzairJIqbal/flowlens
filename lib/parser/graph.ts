import type { Edge, EdgeKind, ImportRecord } from "./types.ts";

// Pure functions over imports and edges. No I/O, nothing to mock.

/** Merges every resolved import between the same two files into one edge. */
export function buildEdges(imports: readonly ImportRecord[]): Edge[] {
  const byPair = new Map<string, { from: string; to: string; kinds: Set<EdgeKind>; typeOnly: boolean }>();
  for (const record of imports) {
    if (record.outcome.status !== "internal") continue;
    const key = `${record.from}\0${record.outcome.to}`;
    const existing = byPair.get(key);
    if (existing) {
      existing.kinds.add(record.kind);
      existing.typeOnly = existing.typeOnly && record.typeOnly;
    } else {
      byPair.set(key, {
        from: record.from,
        to: record.outcome.to,
        kinds: new Set([record.kind]),
        typeOnly: record.typeOnly,
      });
    }
  }
  const order: EdgeKind[] = ["import", "reexport", "dynamic"];
  return [...byPair.values()].map((e) => ({
    from: e.from,
    to: e.to,
    kinds: order.filter((k) => e.kinds.has(k)),
    typeOnly: e.typeOnly,
  }));
}

/** Fan-in: distinct files importing this one. Fan-out: distinct files it imports. */
export function fanInOut(
  paths: readonly string[],
  edges: readonly Edge[],
): Map<string, { fanIn: number; fanOut: number }> {
  const result = new Map(paths.map((p) => [p, { fanIn: 0, fanOut: 0 }]));
  for (const edge of edges) {
    const from = result.get(edge.from);
    const to = result.get(edge.to);
    if (!from || !to) throw new Error(`Edge ${edge.from} -> ${edge.to} references a file that is not a node`);
    from.fanOut += 1;
    to.fanIn += 1;
  }
  return result;
}
