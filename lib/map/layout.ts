import { Graph, layout as dagreLayout } from "@dagrejs/dagre";
import { isLoop, type MapView } from "./view.ts";

export interface Placed {
  x: number;
  y: number;
}

/**
 * Top-left position for every box. Deterministic: boxes and edges arrive
 * sorted and dagre has no randomness, so the same data gives the same picture.
 * Edges are laid out box to box; which row they attach to doesn't move boxes.
 */
export function layoutView(view: MapView): Map<string, Placed> {
  const g = new Graph({ multigraph: false });
  g.setGraph({ rankdir: "LR", nodesep: 14, ranksep: 70, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const box of view.boxes) g.setNode(box.id, { width: box.width, height: box.height });
  // A loop joins a box to itself and says nothing about where boxes go, so
  // the layout only ever sees edges between boxes, preview or not.
  for (const e of view.edges) if (!isLoop(e)) g.setEdge(e.source, e.target);

  dagreLayout(g);

  return new Map(
    view.boxes.map((box) => {
      const { x, y } = g.node(box.id);
      if (x === undefined || y === undefined) throw new Error(`layout left ${box.id} unplaced`);
      // dagre places centres; React Flow positions top-left corners.
      return [box.id, { x: x - box.width / 2, y: y - box.height / 2 }];
    }),
  );
}
