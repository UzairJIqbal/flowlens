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
  type FileEdge,
  type FileFacts,
  type FolderView,
  type PanelView,
} from "@/lib/map/view";
import type { MapActions, MapState } from "./map-state";

/**
 * null when nothing is selected, so nothing is dimmed. `selected` is the files
 * the selection stands for; `lit` adds every file one edge away from them.
 */
type Lit = { selection: Selection; selected: ReadonlySet<string>; lit: ReadonlySet<string> } | null;

type FolderNode = Node<{ box: FolderView; lit: Lit }, "folder">;
type PanelNode = Node<{ box: PanelView; lit: Lit }, "panel">;

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
  state: MapState;
  actions: MapActions;
}

export function DependencyMap(props: MapProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ fold, fan, facts, edges, state, actions }: MapProps) {
  const { selection, open, scroll, hover, hovered } = state;

  const view = useMemo(
    () => buildView(fold, fan, facts, edges, open, scroll),
    [fold, fan, facts, edges, open, scroll],
  );
  const placed = useMemo(() => layoutView(view), [view]);

  const lit = useMemo<Lit>(() => {
    if (selection === null) return null;
    const selected = new Set(filesOf(selection, fold));
    return { selection, selected, lit: litFiles(selected, edges) };
  }, [selection, fold, edges]);

  const nodes = useMemo(
    () =>
      view.boxes.map((box): FolderNode | PanelNode => {
        // Boxes sit above every edge, so a line never runs across a box's rows.
        const common = { id: box.id, position: placed.get(box.id)!, width: box.width, height: box.height, zIndex: 1 };
        return box.kind === "folder"
          ? { ...common, type: "folder", data: { box, lit } }
          : { ...common, type: "panel", data: { box, lit } };
      }),
    [view, placed, lit],
  );

  const rfEdges = useMemo(() => {
    const drawn = view.edges.map((e): Edge => {
      const state = edgeState(lit, e.files);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        className: state ?? undefined,
        markerEnd: { type: MarkerType.ArrowClosed, width: 11, height: 11, color: EDGE_COLOR[state ?? "plain"] },
      };
    });
    // SVG paints in document order, so the selection's edges go last and are
    // never crossed out by a dimmed one. Stable sort keeps the layout order.
    const onTop = (e: Edge) => Number(e.className === "uses" || e.className === "used-by");
    return drawn.sort((a, b) => onTop(a) - onTop(b));
  }, [view, lit]);

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
          {lit !== null && <EdgeKey />}
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
 * in at most one of them, so it can't be both.
 */
type EdgeState = "uses" | "used-by" | "dim" | null;

function edgeState(lit: Lit, files: readonly FileEdge[]): EdgeState {
  if (lit === null) return null;
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

const dimmed = (lit: Lit, files: readonly string[]) => lit !== null && !files.some((f) => lit.lit.has(f));
const isSelectedFolder = (lit: Lit, id: string) => lit?.selection.kind === "folder" && lit.selection.id === id;

function FolderBox({ data: { box, lit } }: NodeProps<FolderNode>) {
  const actions = use(Actions)!;
  const { hovered } = use(Pointed);
  const selected = isSelectedFolder(lit, box.id);
  return (
    <Backing pointed={box.files.some((f) => hovered.has(f))}>
      <div
        onMouseEnter={() => actions.hover({ kind: "folder", id: box.id })}
        onMouseLeave={() => actions.hover(null)}
        title={`${box.id} — ${box.files.length} files, ${box.fanIn} depend on it`}
        className={`flex h-full w-full cursor-pointer items-center justify-between gap-1.5 rounded-sm border bg-surface px-2.5 font-mono text-[11px] ${
          selected ? "border-foreground" : "border-border hover:border-muted"
        } ${dimmed(lit, box.files) ? DIM : ""}`}
      >
        <Handle type="target" position={Position.Left} isConnectable={false} />
        <span className="truncate">{box.label}</span>
        <span className="tabular-nums text-muted">{box.files.length}</span>
        <Handle type="source" position={Position.Right} isConnectable={false} />
      </div>
    </Backing>
  );
}

function PanelBox({ id, data: { box, lit } }: NodeProps<PanelNode>) {
  const actions = use(Actions)!;
  const { hover } = use(Pointed);
  const pointedFile = hover?.kind === "file" ? hover.path : null;
  const updateNodeInternals = useUpdateNodeInternals();
  // The node changed from a folder into a panel under the same id; its
  // handles are new and React Flow has to measure them before edges attach.
  useEffect(() => updateNodeInternals(id), [id, box.rows, updateNodeInternals]);

  // A dimmed panel already dims its rows; dimming them again would hide them.
  const panelDim = dimmed(lit, box.files);
  const rowDim = (files: readonly string[]) => !panelDim && dimmed(lit, files);

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
        } ${panelDim ? DIM : ""}`}
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
          {box.rows.map((row) => (
            <div
              key={row.path}
              onClick={() => actions.selectFile(row.path)}
              onMouseEnter={() => actions.hover({ kind: "file", path: row.path })}
              onMouseLeave={() => actions.hover(null)}
              title={row.path}
              className={`relative flex h-5 cursor-pointer items-center gap-2 px-2.5 ${
                lit?.selection.kind === "file" && lit.selection.path === row.path
                  ? "bg-surface font-semibold"
                  : "hover:bg-surface"
              } ${pointedFile === row.path ? POINTED_ROW : ""} ${rowDim([row.path]) ? DIM : ""}`}
            >
              <Handle id={handleIn({ file: row.path })} type="target" position={Position.Left} isConnectable={false} />
              <span className="truncate">{row.label}</span>
              <span className="ml-auto tabular-nums text-muted">{row.fanIn}</span>
              <Handle id={handleOut({ file: row.path })} type="source" position={Position.Right} isConnectable={false} />
            </div>
          ))}
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

/** Says what the two edge colours mean; only shown while they're on screen. */
function EdgeKey() {
  const swatch = (color: string) => (
    <span className="inline-block h-0.5 w-3 align-middle" style={{ background: color }} aria-hidden />
  );
  return (
    <Panel position="bottom-left" className="flex gap-3 rounded-sm border border-border bg-background px-2 py-1 text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        {swatch(EDGE_COLOR.uses)} imports
      </span>
      <span className="flex items-center gap-1.5">
        {swatch(EDGE_COLOR["used-by"])} imported by
      </span>
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
