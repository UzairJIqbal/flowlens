"use client";

import { useMemo, useState } from "react";
import type { Fold } from "@/lib/map/fold";
import { filesOf, type Hover, type Selection } from "@/lib/map/selection";
import { panelOrder, startShowing, type FileFacts } from "@/lib/map/view";

// One owner for what the map and the detail pane share, so a click or hover in
// either is seen by both without either reaching into the other.

export interface MapState {
  selection: Selection | null;
  open: ReadonlySet<string>;
  /** How far each open panel is scrolled, in rows. Missing means the top. */
  scroll: ReadonlyMap<string, number>;
  hover: Hover | null;
  /** The files `hover` stands for. */
  hovered: ReadonlySet<string>;
}

export interface MapActions {
  /** Opens a folded node into a panel and selects it. */
  openFolder: (id: string) => void;
  close: (id: string) => void;
  /** Selects a file whose row is already on screen. */
  selectFile: (path: string) => void;
  /** Selects a file from anywhere, opening and scrolling its panel so its row is on screen. */
  revealFile: (path: string) => void;
  clear: () => void;
  scrollTo: (id: string, start: number) => void;
  hover: (target: Hover | null) => void;
}

export function useMapState(fold: Fold, facts: Map<string, FileFacts>): [MapState, MapActions] {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [scroll, setScroll] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [hover, setHover] = useState<Hover | null>(null);

  const hovered = useMemo<ReadonlySet<string>>(() => new Set(hover ? filesOf(hover, fold) : []), [hover, fold]);

  const actions = useMemo<MapActions>(() => {
    const ensureOpen = (id: string) => setOpen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    return {
      // Opening, closing and revealing replace the element under the pointer,
      // which then never fires its mouseleave, so they drop the hover themselves.
      openFolder: (id) => {
        ensureOpen(id);
        setSelection({ kind: "folder", id });
        setHover(null);
      },
      close: (id) => {
        setOpen((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        // Reopening starts from the top again.
        setScroll((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        setHover(null);
      },
      selectFile: (path) => setSelection({ kind: "file", path }),
      revealFile: (path) => {
        const id = fold.nodeOf.get(path)!;
        const ordered = panelOrder(fold.nodes.find((n) => n.id === id)!.files, facts);
        ensureOpen(id);
        setScroll((prev) => {
          const current = prev.get(id) ?? 0;
          const start = startShowing(ordered, path, current);
          return start === current ? prev : new Map(prev).set(id, start);
        });
        setSelection({ kind: "file", path });
        setHover(null);
      },
      clear: () => setSelection(null),
      scrollTo: (id, start) => setScroll((prev) => new Map(prev).set(id, start)),
      hover: setHover,
    };
  }, [fold, facts]);

  return [{ selection, open, scroll, hover, hovered }, actions];
}
