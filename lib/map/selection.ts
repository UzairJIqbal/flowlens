import type { Fold } from "./fold.ts";

/** What the map and the detail pane agree is selected: one file, or one folder node. */
export type Selection = { kind: "folder"; id: string } | { kind: "file"; path: string };

/**
 * What the pointer is over, in either the map or the pane. Shared rather than
 * kept by each side, so each can light up what the other is pointing at.
 */
export type Hover = Selection;

/** The files a selection or hover stands for. */
export function filesOf(target: Selection, fold: Fold): string[] {
  return target.kind === "file" ? [target.path] : fold.nodes.find((n) => n.id === target.id)!.files;
}
