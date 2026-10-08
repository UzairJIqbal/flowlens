"use client";

import {
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getViewportForBounds,
  useReactFlow,
  useStoreApi,
  useUpdateNodeInternals,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { createContext, use, useCallback, useEffect, useMemo, useRef } from "react";
import type { Fold } from "@/lib/map/fold";
import { layoutView } from "@/lib/map/layout";
import { filesOf, type Hover, type Selection } from "@/lib/map/selection";
import {
  ROW_H,
  ROW_LIMIT,
  buildView,
  folderFan,
  handleIn,
  handleOut,
  litFiles,
  onSide,
  recount,
  type ChangeSide,
  type EdgeChange,
  type FileEdge,
  type FileFacts,
  type FolderView,
  type PanelView,
} from "@/lib/map/view";
import { fanInOut } from "@/lib/parser/graph";
import { Swatch } from "./category-rail";
import type { MapActions, MapState } from "./map-state";

/**
 * null when nothing is selected, so nothing is dimmed. `selected` is the files
 * the selection stands for; `lit` adds every file one edge away from them.
 * On a preview with nothing selected, `selection` is null and the change
 * itself is lit: the changed files, and their blast radius.
 */
type Lit = { selection: Selection | null; selected: ReadonlySet<string>; lit: ReadonlySet<string> } | null;

/** What a pull request preview lays over the map. Absent on an analysis's map. */
export type ChangeLayer = {
  side: ChangeSide;
  /** Each changed file's status letter, and what it stands for. */
  marks: ReadonlyMap<string, { letter: string; title: string }>;
  /** Files not on the side shown. They keep their place, greyed. */
  greyed: ReadonlySet<string>;
  /** Lit when nothing is selected: the changed files, and those plus everything within their blast radius. */
  focus: { changed: ReadonlySet<string>; lit: ReadonlySet<string> };
};

/** The rail's picked category and its files; null when none is picked, so nothing is dimmed by it. */
export type Matched = { label: string; color: string | null; files: ReadonlySet<string> } | null;

type NodeData = { lit: Lit; matched: Matched; change: ChangeLayer | null };
type FolderNode = Node<{ box: FolderView } & NodeData, "folder">;
type PanelNode = Node<{ box: PanelView } & NodeData, "panel">;

const Actions = createContext<MapActions | null>(null);

/** Kept apart from the node data so a hover re-renders the boxes, not the layout. */
const Pointed = createContext<{ hover: Hover | null; hovered: ReadonlySet<string> }>({
  hover: null,
  hovered: new Set(),
});

const FIT_PADDING = 0.06;
const MIN_ZOOM = 0.1;

interface MapProps {
  fold: Fold;
  fan: ReturnType<typeof folderFan>;
  facts: Map<string, FileFacts>;
  edges: FileEdge[];
  matched: Matched;
  state: MapState;
  actions: MapActions;
  /**
   * On a preview, `edges` is both sides together, so the layout is the same
   * whichever side is shown and switching moves nothing.
   */
  change?: ChangeLayer;
}

export function DependencyMap(props: MapProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ fold, fan, facts, edges, matched, state, actions, change: layer }: MapProps) {
  const { selection, open, scroll, hover, hovered } = state;
  const change = layer ?? null;

  const view = useMemo(
    () => buildView(fold, fan, facts, edges, open, scroll),
    [fold, fan, facts, edges, open, scroll],
  );
  const placed = useMemo(() => layoutView(view), [view]);

  // The edges that exist on the side shown; all of them outside a preview.
  const side = change?.side ?? "both";
  const shown = useMemo(() => edges.filter((e) => onSide(e.change, side)), [edges, side]);
  // Counts are of the side shown, so a number on a box always counts lines on screen.
  const counted = useMemo(
    () =>
      change === null
        ? view
        : recount(view, folderFan(fold, shown), fanInOut(fold.nodes.flatMap((n) => n.files), shown)),
    [change, view, fold, shown],
  );

  const focus = change?.focus ?? null;
  const lit = useMemo<Lit>(() => {
    if (selection === null) return focus === null ? null : { selection: null, selected: focus.changed, lit: focus.lit };
    const selected = new Set(filesOf(selection, fold));
    return { selection, selected, lit: litFiles(selected, shown) };
  }, [selection, fold, shown, focus]);

  const nodes = useMemo(
    () =>
      counted.boxes.map((box): FolderNode | PanelNode => {
        // Boxes sit above every edge, so a line never runs across a box's rows.
        const common = { id: box.id, position: placed.get(box.id)!, width: box.width, height: box.height, zIndex: 1 };
        return box.kind === "folder"
          ? { ...common, type: "folder", data: { box, lit, matched, change } }
          : { ...common, type: "panel", data: { box, lit, matched, change } };
      }),
    [counted, placed, lit, matched, change],
  );

  const rfEdges = useMemo(() => {
    // SVG paints in document order, so the selection's edges go last and are
    // never crossed out by a dimmed one. Stable sort keeps the layout order.
    const drawn = view.edges
      .map((e) => ({ e, state: edgeState(lit, matched, e.files, e.change) }))
      .sort((a, b) => Number(a.state === "uses" || a.state === "used-by") - Number(b.state === "uses" || b.state === "used-by"));
    return drawn.map(
      ({ e, state }): Edge => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        // Hidden rather than left out, so the layout never sees a side switch.
        hidden: !onSide(e.change ?? undefined, side),
        className: [state, e.change].filter((c) => c !== null).join(" ") || undefined,
        markerEnd: { type: MarkerType.ArrowClosed, width: 11, height: 11, color: EDGE_COLOR[state ?? "plain"] },
      }),
    );
  }, [view, lit, matched, side]);

  // Refit after an open, from the map or the pane, against the layout that
  // open produced. The effect depends on `placed`, so it can only ever see
  // the state after the change.
  const { getZoom, setViewport } = useReactFlow();
  const store = useStoreApi();
  const fittedFor = useRef(open);
  useEffect(() => {
    const opened = [...open].some((id) => !fittedFor.current.has(id));
    fittedFor.current = open;
    if (!opened) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const box of view.boxes) {
      const p = placed.get(box.id)!;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + box.width);
      y1 = Math.max(y1, p.y + box.height);
    }
    const { width, height } = store.getState();
    // Capping the fit at the current zoom is what makes it zoom out only.
    const viewport = getViewportForBounds(
      { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      width,
      height,
      MIN_ZOOM,
      getZoom(),
      FIT_PADDING,
    );
    void setViewport(viewport);
  }, [open, view, placed, store, getZoom, setViewport]);

  const onNodeClick = useCallback<NodeMouseHandler<FolderNode | PanelNode>>(
    (_, node) => {
      if (node.type === "folder") actions.openFolder(node.id);
    },
    [actions],
  );

  const pointed = useMemo(() => ({ hover, hovered }), [hover, hovered]);

  return (
    <Actions value={actions}>
      <Pointed value={pointed}>
        <ReactFlow
          className="dependency-map"
          nodes={nodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onPaneClick={actions.clear}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          minZoom={MIN_ZOOM}
          fitView
          fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1.5 }}
        >
          {(lit !== null || change !== null) && <EdgeKey direction={lit !== null} change={change !== null} />}
        </ReactFlow>
      </Pointed>
    </Actions>
  );
}

/**
 * Colour on an edge means its direction relative to the selection: "uses" when
 * a selected file imports across it, "used-by" when it imports a selected
 * file. Edges not touching the selection dim; with no selection, all are grey.
 * A drawn edge only ever runs one way between two boxes and the selection sits
 * in at most one of them, so it can't be both. With a rail category picked,
 * an edge with no end in it dims too, whatever the selection says.
 *
 * On a preview with nothing selected, the blast radius is lit: an edge between
 * two lit files is one the radius was walked along, toward the change, so it
 * is "used-by". An added or removed edge is the change itself and never dims.
 */
type EdgeState = "uses" | "used-by" | "dim" | null;

function edgeState(lit: Lit, matched: Matched, files: readonly FileEdge[], change: EdgeChange | null): EdgeState {
  if (matched !== null && !files.some((f) => matched.files.has(f.from) || matched.files.has(f.to))) return "dim";
  if (lit === null) return null;
  if (lit.selection === null) {
    if (files.some((f) => lit.lit.has(f.from) && lit.lit.has(f.to))) return "used-by";
    return change === null ? "dim" : null;
  }
  if (files.some((f) => lit.selected.has(f.from))) return "uses";
  if (files.some((f) => lit.selected.has(f.to))) return "used-by";
  return "dim";
}

const EDGE_COLOR: Record<Exclude<EdgeState, null> | "plain", string> = {
  plain: "var(--edge)",
  dim: "var(--edge)",
  uses: "var(--edge-uses)",
  "used-by": "var(--edge-used-by)",
};

// One strength for everything that falls outside the selection.
const DIM = "opacity-25";

// Whatever is being pointed at, here or in the detail pane. The accent, as for
// anything interactive; the same ring marks it in the pane.
const POINTED_BOX = "ring-2 ring-accent";
const POINTED_ROW = "ring-1 ring-inset ring-accent";

// Dimmed when outside the selection's reach or outside the picked category.
// Either one is enough: both are ways of saying "not this".
const dimmed = (lit: Lit, matched: Matched, files: readonly string[]) =>
  (lit !== null && !files.some((f) => lit.lit.has(f))) || (matched !== null && !files.some((f) => matched.files.has(f)));
const isSelectedFolder = (lit: Lit, id: string) => lit?.selection?.kind === "folder" && lit.selection.id === id;

// A box holding a changed file carries a bar on its left edge, so a change
// folded out of sight can still be found. No colour: colour means direction.
const CHANGED_BOX = "border-l-[3px] border-l-foreground";
const holdsChange = (change: ChangeLayer | null, files: readonly string[]) =>
  change !== null && files.some((f) => change.marks.has(f));

// Not on the side shown: there is no file, so nothing to read, but its place is kept.
const GREYED = "text-muted";

function FolderBox({ data: { box, lit, matched, change } }: NodeProps<FolderNode>) {
  const actions = use(Actions)!;
  const { hovered } = use(Pointed);
  const selected = isSelectedFolder(lit, box.id);
  const gone = change !== null && box.files.every((f) => change.greyed.has(f));
  return (
    <Backing pointed={box.files.some((f) => hovered.has(f))}>
      <div
        onMouseEnter={() => actions.hover({ kind: "folder", id: box.id })}
        onMouseLeave={() => actions.hover(null)}
        title={`${box.id} — ${box.files.length} files, ${box.fanIn} depend on it`}
        className={`flex h-full w-full cursor-pointer items-center justify-between gap-1.5 rounded-sm border bg-surface px-2.5 font-mono text-[11px] ${
          selected ? "border-foreground" : "border-border hover:border-muted"
        } ${holdsChange(change, box.files) ? CHANGED_BOX : ""} ${gone ? "border-dashed" : ""} ${
          dimmed(lit, matched, box.files) ? DIM : ""
        }`}
      >
        <Handle type="target" position={Position.Left} isConnectable={false} />
        <span className={`truncate ${gone ? GREYED : ""}`}>{box.label}</span>
        {matched === null ? (
          <span className="tabular-nums text-muted">{box.files.length}</span>
        ) : (
          <MatchCount matched={matched} files={box.files} />
        )}
        <Handle type="source" position={Position.Right} isConnectable={false} />
      </div>
    </Backing>
  );
}

function PanelBox({ id, data: { box, lit, matched, change } }: NodeProps<PanelNode>) {
  const actions = use(Actions)!;
  const { hover } = use(Pointed);
  const pointedFile = hover?.kind === "file" ? hover.path : null;
  const updateNodeInternals = useUpdateNodeInternals();
  // The node changed from a folder into a panel under the same id; its
  // handles are new and React Flow has to measure them before edges attach.
  useEffect(() => updateNodeInternals(id), [id, box.rows, updateNodeInternals]);

  // A dimmed panel already dims its rows; dimming them again would hide them.
  const panelDim = dimmed(lit, matched, box.files);
  const rowDim = (files: readonly string[]) => !panelDim && dimmed(lit, matched, files);

  // Wheel moves the window a whole row at a time. Trackpads send many small
  // deltas, so they're summed until they add up to a row.
  const wheel = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    wheel.current += e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * ROW_H : e.deltaY;
    const steps = Math.trunc(wheel.current / ROW_H);
    if (steps === 0) return;
    wheel.current -= steps * ROW_H;
    const start = Math.min(Math.max(box.start + steps, 0), box.files.length - ROW_LIMIT);
    if (start !== box.start) actions.scrollTo(box.id, start);
  };

  return (
    <Backing pointed={hover?.kind === "folder" && hover.id === box.id}>
      <div
        className={`flex h-full w-full cursor-default flex-col rounded-sm border bg-background font-mono text-[11px] ${
          isSelectedFolder(lit, box.id) ? "border-foreground" : "border-foreground/40"
        } ${holdsChange(change, box.files) ? CHANGED_BOX : ""} ${panelDim ? DIM : ""}`}
      >
        <button
          type="button"
          onClick={() => actions.close(box.id)}
          onMouseEnter={() => actions.hover({ kind: "folder", id: box.id })}
          onMouseLeave={() => actions.hover(null)}
          title={`${box.id} — click to fold`}
          className="flex h-7 shrink-0 cursor-pointer items-center gap-2 border-b border-border bg-surface px-2.5 text-left"
        >
          <span className="truncate font-semibold">{box.label}</span>
          <span className="tabular-nums text-muted">{box.files.length} files</span>
          {matched !== null && <MatchCount matched={matched} files={box.files} />}
          <span className="ml-auto whitespace-nowrap tabular-nums text-muted">
            in <span className="text-foreground">{box.fanIn}</span> out{" "}
            <span className="text-foreground">{box.fanOut}</span>
          </span>
        </button>
        {/* nowheel: over a panel that scrolls, the wheel scrolls it instead of zooming the map. */}
        <div onWheel={box.scrolls ? onWheel : undefined} className={box.scrolls ? "nowheel" : undefined}>
          {box.scrolls && (
            <OutOfView slot="above" files={box.above} dim={rowDim(box.above)} pointed={pointedFile} />
          )}
          {box.rows.map((row) => {
            const mark = change?.marks.get(row.path);
            return (
            <div
              key={row.path}
              onClick={() => actions.selectFile(row.path)}
              onMouseEnter={() => actions.hover({ kind: "file", path: row.path })}
              onMouseLeave={() => actions.hover(null)}
              title={row.path}
              className={`relative flex h-5 cursor-pointer items-center gap-2 px-2.5 ${
                lit?.selection?.kind === "file" && lit.selection.path === row.path
                  ? "bg-surface font-semibold"
                  : "hover:bg-surface"
              } ${pointedFile === row.path ? POINTED_ROW : ""} ${rowDim([row.path]) ? DIM : ""}`}
            >
              <Handle id={handleIn({ file: row.path })} type="target" position={Position.Left} isConnectable={false} />
              {change !== null && (
                <span className="w-2 shrink-0 font-semibold" title={mark?.title}>
                  {mark?.letter}
                </span>
              )}
              <span className={`truncate ${change?.greyed.has(row.path) ? GREYED : ""}`}>{row.label}</span>
              <span className="ml-auto tabular-nums text-muted">{row.fanIn}</span>
              <Handle id={handleOut({ file: row.path })} type="source" position={Position.Right} isConnectable={false} />
            </div>
            );
          })}
          {box.scrolls && (
            <OutOfView slot="below" files={box.below} dim={rowDim(box.below)} pointed={pointedFile} />
          )}
        </div>
      </div>
    </Backing>
  );
}

/**
 * Stands in for the files scrolled past in one direction, so their edges still
 * land inside the panel. Always rendered on a panel that scrolls, empty or not,
 * so the panel's height never changes.
 */
function OutOfView({
  slot,
  files,
  dim,
  pointed,
}: {
  slot: "above" | "below";
  files: string[];
  dim: boolean;
  /** The file being pointed at elsewhere; lights this row when it's one of the files scrolled away. */
  pointed: string | null;
}) {
  return (
    <div
      className={`relative flex h-5 items-center px-2.5 text-muted ${slot === "above" ? "border-b" : "border-t"} border-border ${
        pointed !== null && files.includes(pointed) ? POINTED_ROW : ""
      } ${dim ? DIM : ""}`}
    >
      <Handle id={handleIn(slot)} type="target" position={Position.Left} isConnectable={false} />
      {files.length > 0 && `${slot === "above" ? "↑" : "↓"} ${files.length} ${slot}`}
      <Handle id={handleOut(slot)} type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

/**
 * How many of a box's files are in the picked category, beside that
 * category's swatch. Shown on every box, folded or open, so the counts across
 * the map add up to the rail's.
 */
function MatchCount({ matched, files }: { matched: Exclude<Matched, null>; files: readonly string[] }) {
  const n = files.filter((f) => matched.files.has(f)).length;
  return (
    <span
      className="flex shrink-0 items-center gap-1 tabular-nums"
      title={`${matched.label}: ${n} of ${files.length} files`}
    >
      <Swatch color={matched.color} />
      <span className={n === 0 ? "text-muted" : "text-foreground"}>{n}</span>
    </span>
  );
}

/** Says what the edge colours and line styles mean; each only while it's on screen. */
function EdgeKey({ direction, change }: { direction: boolean; change: boolean }) {
  const swatch = (color: string) => (
    <span className="inline-block h-0.5 w-3 align-middle" style={{ background: color }} aria-hidden />
  );
  const line = (style: string) => (
    <svg width="14" height="4" className="align-middle" aria-hidden>
      <line x1="0" y1="2" x2="14" y2="2" stroke="var(--foreground)" className={style} />
    </svg>
  );
  return (
    <Panel position="bottom-left" className="flex gap-3 rounded-sm border border-border bg-background px-2 py-1 text-[11px] text-muted">
      {direction && (
        <>
          <span className="flex items-center gap-1.5">
            {swatch(EDGE_COLOR.uses)} imports
          </span>
          <span className="flex items-center gap-1.5">
            {swatch(EDGE_COLOR["used-by"])} imported by
          </span>
        </>
      )}
      {change && (
        <>
          <span className="flex items-center gap-1.5">
            {line("edge-added")} added
          </span>
          <span className="flex items-center gap-1.5">
            {line("edge-removed")} removed
          </span>
        </>
      )}
    </Panel>
  );
}

/**
 * A solid layer under each box. Dimming fades the box with opacity, and
 * without this the edges behind a dimmed box would show through it. The
 * pointed-at ring sits on this layer too, so dimming never fades it.
 */
function Backing({ pointed, children }: { pointed: boolean; children: React.ReactNode }) {
  return <div className={`h-full w-full rounded-sm bg-background ${pointed ? POINTED_BOX : ""}`}>{children}</div>;
}

const nodeTypes = { folder: FolderBox, panel: PanelBox };
