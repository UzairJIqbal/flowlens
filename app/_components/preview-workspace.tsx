"use client";

import { useCallback, useMemo, useState } from "react";
import type { Tracing } from "@/lib/ai/client";
import { categoryCounts, inCategory, kindsOf } from "@/lib/map/categories";
import { fold as foldFiles } from "@/lib/map/fold";
import type { Target } from "@/lib/map/prose";
import { folderFan, type ChangeSide } from "@/lib/map/view";
import { fanInOut } from "@/lib/parser/graph";
import type { ChangedFile } from "@/lib/pipeline/github";
import { changeLetter, changedBoxes, combine, oldName } from "@/lib/previews/combine";
import type { PreviewSide } from "@/lib/previews/side";
import { CategoryRail } from "./category-rail";
import { ChangeList } from "./change-list";
import { DependencyMap, type ChangeLayer, type Matched } from "./dependency-map";
import { MapShell } from "./map-shell";
import { useMapState } from "./map-state";

/**
 * A pull request's two parses as one map. Laid out over both sides together,
 * so switching between before, after and both only changes what is drawn,
 * never where anything is.
 */
export function PreviewWorkspace({
  previewId,
  tracing,
  base,
  head,
  changed,
}: {
  previewId: string;
  tracing: Tracing;
  base: PreviewSide;
  head: PreviewSide;
  changed: ChangedFile[];
}) {
  const [side, setSide] = useState<ChangeSide>("both");
  const change = useMemo(() => combine(base, head, changed), [base, head, changed]);
  const { files, edges } = change;

  const fold = useMemo(() => foldFiles(files), [files]);
  const fan = useMemo(() => folderFan(fold, edges), [fold, edges]);
  const facts = useMemo(() => {
    const counts = fanInOut(
      files.map((f) => f.path),
      edges,
    );
    return new Map(files.map((f) => [f.path, { path: f.path, ...counts.get(f.path)! }]));
  }, [files, edges]);
  // Categories are the after side's framework: that is the codebase the change leaves.
  const kinds = useMemo(() => kindsOf(head.adapter), [head.adapter]);
  const categories = useMemo(() => categoryCounts(files, head.adapter), [files, head.adapter]);
  const startOpen = useMemo(() => changedBoxes(fold, change.changedPaths), [fold, change]);
  const [state, actions] = useMapState(fold, facts, startOpen);

  const { category } = state;
  const matched = useMemo<Matched>(
    () =>
      category === null
        ? null
        : { label: kinds.label(category.role), color: kinds.color(category.role), files: inCategory(files, category.role) },
    [files, category, kinds],
  );

  const marks = useMemo(() => {
    const out = new Map<string, { letter: string; title: string }>();
    for (const c of changed) {
      out.set(c.path, { letter: changeLetter(c.status), title: c.previousPath === null ? c.status : `${c.status} from ${c.previousPath}` });
      const old = oldName(c);
      if (old !== null) out.set(old, { letter: changeLetter(c.status), title: `renamed to ${c.path}` });
    }
    return out;
  }, [changed]);

  const greyed = useMemo(
    () => new Set(files.filter((f) => (side === "before" ? !f.onBase : !f.onHead)).map((f) => f.path)),
    [files, side],
  );

  const focus = useMemo(() => {
    const onMap = new Set(files.map((f) => f.path));
    const changedOnMap = new Set(change.changedPaths.filter((p) => onMap.has(p)));
    return { changed: changedOnMap, lit: new Set([...changedOnMap, ...change.affected.map((a) => a.path)]) };
  }, [files, change]);

  const layer = useMemo<ChangeLayer>(() => ({ side, marks, greyed, focus }), [side, marks, greyed, focus]);

  const resolve = useCallback(
    (path: string): Target | null =>
      facts.has(path)
        ? { kind: "file", path }
        : path !== "." && fold.nodes.some((n) => n.id === path)
          ? { kind: "folder", id: path }
          : null,
    [facts, fold],
  );

  return (
    <MapShell
      title="Categories"
      rail={<CategoryRail categories={categories} kinds={kinds} category={category} onToggle={actions.toggleCategory} />}
      map={
        <div className="flex h-full flex-col">
          <SideTabs side={side} onChange={setSide} />
          <div className="relative min-h-0 flex-1">
            <DependencyMap
              fold={fold}
              fan={fan}
              facts={facts}
              edges={edges}
              matched={matched}
              state={state}
              actions={actions}
              change={layer}
            />
          </div>
        </div>
      }
      detailHeader={
        <div className="flex h-7 shrink-0 items-center border-b border-border px-3 text-xs font-semibold">Change</div>
      }
      detail={
        <div className="absolute inset-0 overflow-y-auto">
          <ChangeList
            previewId={previewId}
            tracing={tracing}
            base={base}
            head={head}
            changed={changed}
            change={change}
            onMap={facts}
            resolve={resolve}
            state={state}
            actions={actions}
          />
        </div>
      }
    />
  );
}

const SIDES: { side: ChangeSide; label: string; title: string }[] = [
  { side: "before", label: "Before", title: "The merge base: added files greyed, added imports hidden" },
  { side: "after", label: "After", title: "The pull request's head: removed files greyed, removed imports hidden" },
  { side: "both", label: "Both", title: "Every import on either side; removed files greyed" },
];

function SideTabs({ side, onChange }: { side: ChangeSide; onChange: (s: ChangeSide) => void }) {
  return (
    <div role="tablist" className="flex h-7 shrink-0 items-stretch gap-3 border-b border-border px-3 text-xs">
      {SIDES.map((s) => (
        <button
          key={s.side}
          type="button"
          role="tab"
          aria-selected={side === s.side}
          title={s.title}
          onClick={() => onChange(s.side)}
          className={`-mb-px flex items-center border-b ${
            side === s.side ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
