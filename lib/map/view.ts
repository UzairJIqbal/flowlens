import type { Fold } from "./fold.ts";
import { shortestUnique } from "./labels.ts";

// What is on the canvas for a given set of open folders: boxes, their sizes and
// the edges between them. Pure; derived from the parser's files and edges,
// which are never reshaped.

export interface FileFacts {
  path: string;
  fanIn: number;
  fanOut: number;
}

export interface FileEdge {
  from: string;
  to: string;
}

export interface FolderView {
  kind: "folder";
  id: string;
  label: string;
  files: string[];
  fanIn: number;
  fanOut: number;
  width: number;
  height: number;
}

export interface PanelRow {
  path: string;
  label: string;
  fanIn: number;
  fanOut: number;
}

export interface PanelView extends Omit<FolderView, "kind"> {
  kind: "panel";
  /** Index of the first shown row in the folder's ordered files. */
  start: number;
  rows: PanelRow[];
  /** True when the folder has more files than rows, so it scrolls. */
  scrolls: boolean;
  /** Files scrolled out of view; their edges attach to the "above" and "below" rows. */
  above: string[];
  below: string[];
}

export type BoxView = FolderView | PanelView;

export interface EdgeView {
  id: string;
  source: string;
  sourceHandle: string | null;
  target: string;
  targetHandle: string | null;
  /** The file-to-file edges this line stands for. */
  files: FileEdge[];
}

export interface MapView {
  boxes: BoxView[];
  edges: EdgeView[];
}

/** Rows a panel shows at once; past this it scrolls rather than growing. */
export const ROW_LIMIT = 12;

/** Where an edge attaches inside a panel: a file's row, or one of the two rows standing for what's scrolled away. */
export type RowAnchor = { file: string } | "above" | "below";
// Prefixed so no file path can collide with "above" or "below".
const anchorKey = (a: RowAnchor) => (typeof a === "string" ? a : `file:${a.file}`);
export const handleIn = (a: RowAnchor) => `in:${anchorKey(a)}`;
export const handleOut = (a: RowAnchor) => `out:${anchorKey(a)}`;

// Sizes are computed here rather than measured in the browser, so the layout
// is a function of the data alone. Geist Mono at 11px is 0.6em per glyph.
const CHAR = 6.6;
const PAD_X = 10;
const FOLDER_MIN_H = 30;
const FOLDER_MAX_H = 120;
export const HEADER_H = 28;
export const ROW_H = 20;
const PANEL_MIN_W = 200;

/**
 * Height carries fan-in. Square root, so the one file everything imports
 * doesn't flatten every other node to the minimum.
 */
const folderHeight = (fanIn: number) => Math.min(FOLDER_MAX_H, FOLDER_MIN_H + 6 * Math.sqrt(fanIn));

/** Distinct files outside a folder that import into it, and that it imports. */
export function folderFan(fold: Fold, edges: readonly FileEdge[]): Map<string, { fanIn: number; fanOut: number }> {
  const into = new Map<string, Set<string>>();
  const outOf = new Map<string, Set<string>>();
  for (const e of edges) {
    const from = fold.nodeOf.get(e.from)!;
    const to = fold.nodeOf.get(e.to)!;
    if (from === to) continue;
    into.set(to, (into.get(to) ?? new Set()).add(e.from));
    outOf.set(from, (outOf.get(from) ?? new Set()).add(e.to));
  }
  return new Map(
    fold.nodes.map((n) => [n.id, { fanIn: into.get(n.id)?.size ?? 0, fanOut: outOf.get(n.id)?.size ?? 0 }]),
  );
}

export function buildView(
  fold: Fold,
  fan: Map<string, { fanIn: number; fanOut: number }>,
  facts: Map<string, FileFacts>,
  edges: readonly FileEdge[],
  open: ReadonlySet<string>,
  /** How far each open panel is scrolled, in rows. Missing means the top. */
  scroll: ReadonlyMap<string, number> = new Map(),
): MapView {
  const labels = shortestUnique(fold.nodes.map((n) => n.id));
  const display = (id: string) => (id === "." ? "./" : labels.get(id)!);

  // Where each file's edges attach: its own row, the panel's "more" row, or
  // the folded node as a whole.
  const anchor = new Map<string, { box: string; handle: RowAnchor | null }>();

  const boxes: BoxView[] = fold.nodes.map((node) => {
    const { fanIn, fanOut } = fan.get(node.id)!;
    const label = display(node.id);

    if (!open.has(node.id)) {
      for (const f of node.files) anchor.set(f, { box: node.id, handle: null });
      return {
        kind: "folder",
        id: node.id,
        label,
        files: node.files,
        fanIn,
        fanOut,
        width: Math.ceil(label.length * CHAR + 2 * PAD_X + countWidth(node.files.length)),
        height: Math.round(folderHeight(fanIn)),
      };
    }

    const ordered = panelOrder(node.files, facts);
    const start = Math.min(Math.max(scroll.get(node.id) ?? 0, 0), Math.max(ordered.length - ROW_LIMIT, 0));
    const shown = ordered.slice(start, start + ROW_LIMIT);
    const above = ordered.slice(0, start);
    const below = ordered.slice(start + ROW_LIMIT);
    const scrolls = ordered.length > ROW_LIMIT;
    const rowLabels = shortestUnique(node.files);
    const rows = shown.map((path) => ({
      path,
      label: rowLabels.get(path)!,
      fanIn: facts.get(path)!.fanIn,
      fanOut: facts.get(path)!.fanOut,
    }));
    for (const f of shown) anchor.set(f, { box: node.id, handle: { file: f } });
    for (const f of above) anchor.set(f, { box: node.id, handle: "above" });
    for (const f of below) anchor.set(f, { box: node.id, handle: "below" });

    // Size comes from every file, not the rows in view, so scrolling never
    // resizes the panel and never moves anything else on the map.
    const headerText = `${label} ${node.files.length} files in ${fanIn} out ${fanOut}`;
    const widest = Math.max(headerText.length, ...node.files.map((f) => rowLabels.get(f)!.length + 10));
    return {
      kind: "panel",
      id: node.id,
      label,
      files: node.files,
      fanIn,
      fanOut,
      start,
      rows,
      scrolls,
      above,
      below,
      width: Math.max(PANEL_MIN_W, Math.ceil(widest * CHAR + 2 * PAD_X)),
      height: HEADER_H + (rows.length + (scrolls ? 2 : 0)) * ROW_H + 4,
    };
  });

  const merged = new Map<string, EdgeView>();
  for (const e of edges) {
    const from = anchor.get(e.from)!;
    const to = anchor.get(e.to)!;
    // Imports inside one box aren't drawn; selection still follows them.
    if (from.box === to.box) continue;
    const sourceHandle = from.handle === null ? null : handleOut(from.handle);
    const targetHandle = to.handle === null ? null : handleIn(to.handle);
    const id = `${from.box}|${sourceHandle ?? ""}>${to.box}|${targetHandle ?? ""}`;
    const existing = merged.get(id);
    if (existing) existing.files.push(e);
    else merged.set(id, { id, source: from.box, sourceHandle, target: to.box, targetHandle, files: [e] });
  }

  return { boxes, edges: [...merged.values()].sort((a, b) => (a.id < b.id ? -1 : 1)) };
}

/** Row order inside an open panel. Most depended-on first: those are the rows edges arrive at. */
export function panelOrder(files: readonly string[], facts: Map<string, FileFacts>): string[] {
  return [...files].sort((a, b) => facts.get(b)!.fanIn - facts.get(a)!.fanIn || (a < b ? -1 : 1));
}

/** The scroll start that brings `path` into a panel's rows, moving as little as possible. */
export function startShowing(ordered: readonly string[], path: string, start: number): number {
  const i = ordered.indexOf(path);
  if (i < start) return i;
  if (i >= start + ROW_LIMIT) return i - ROW_LIMIT + 1;
  return start;
}

const countWidth = (n: number) => (String(n).length + 1) * CHAR;

/**
 * What stays at full strength: the selected files, every edge touching them,
 * and the files at the other end. Computed over file edges, so it is the same
 * whether the neighbour is a row, a row scrolled out of view or a folded node.
 */
export function litFiles(selected: ReadonlySet<string>, edges: readonly FileEdge[]): Set<string> {
  const lit = new Set(selected);
  for (const e of edges) {
    if (selected.has(e.from)) lit.add(e.to);
    if (selected.has(e.to)) lit.add(e.from);
  }
  return lit;
}
