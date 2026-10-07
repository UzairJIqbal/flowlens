"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Tracing } from "@/lib/ai/client";
import type { StoredRoute, StoredWithheldRoute } from "@/lib/analyses/map";
import { insights as findInsights } from "@/lib/graph/insights";
import { categoryCounts, inCategory, kindsOf } from "@/lib/map/categories";
import { neighbours as neighboursOf, type RepoFile } from "@/lib/map/detail";
import { fold as foldFiles } from "@/lib/map/fold";
import { folderFan, type FileEdge } from "@/lib/map/view";
import { CategoryRail } from "./category-rail";
import { DependencyMap, type Matched } from "./dependency-map";
import { DetailPane, type RepoInfo } from "./detail-pane";
import { MapShell } from "./map-shell";
import { useMapState } from "./map-state";
import { RouteTable } from "./route-table";

/**
 * The map and its detail pane over one parse result. Everything both of them
 * show is derived here, once, from data already in the browser, so selecting
 * or hovering is a lookup and never a request.
 */
export function MapWorkspace({
  analysisId,
  tracing,
  title,
  repo,
  files,
  edges,
  routes,
  withheldRoutes,
}: {
  analysisId: string;
  tracing: Tracing;
  title: ReactNode;
  repo: RepoInfo;
  files: RepoFile[];
  edges: FileEdge[];
  routes: StoredRoute[];
  withheldRoutes: StoredWithheldRoute[];
}) {
  const [centre, setCentre] = useState<Centre>("map");
  const fold = useMemo(() => foldFiles(files), [files]);
  const fan = useMemo(() => folderFan(fold, edges), [fold, edges]);
  const facts = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const neighbours = useMemo(() => neighboursOf(files.map((f) => f.path), edges), [files, edges]);
  const kinds = useMemo(() => kindsOf(repo.adapter), [repo.adapter]);
  const categories = useMemo(() => categoryCounts(files, repo.adapter), [files, repo.adapter]);
  const insights = useMemo(() => findInsights(files, edges, kinds.importedToBeReached), [files, edges, kinds]);
  const [state, actions] = useMapState(fold, facts);
  const { category } = state;
  const matched = useMemo<Matched>(
    () =>
      category === null
        ? null
        : { label: kinds.label(category.role), color: kinds.color(category.role), files: inCategory(files, category.role) },
    [files, category, kinds],
  );

  return (
    <MapShell
      title={title}
      rail={<CategoryRail categories={categories} kinds={kinds} category={category} onToggle={actions.toggleCategory} />}
      map={
        <div className="flex h-full flex-col">
          <CentreTabs centre={centre} routes={routes.length} onChange={setCentre} />
          <div className="relative min-h-0 flex-1">
            <DependencyMap
              fold={fold}
              fan={fan}
              facts={facts}
              edges={edges}
              matched={matched}
              state={state}
              actions={actions}
            />
            {/* Laid over the map rather than replacing it, so going back finds the map where it was left. */}
            {centre === "routes" && (
              <div className="absolute inset-0 z-10 bg-background">
                <RouteTable
                  kinds={kinds}
                  routes={routes}
                  withheld={withheldRoutes}
                  selected={state.selection?.kind === "file" ? state.selection.path : null}
                  actions={actions}
                />
              </div>
            )}
          </div>
        </div>
      }
      detail={
        <DetailPane
          analysisId={analysisId}
          tracing={tracing}
          repo={repo}
          kinds={kinds}
          files={files}
          facts={facts}
          fold={fold}
          fan={fan}
          neighbours={neighbours}
          edges={edges}
          insights={insights}
          state={state}
          actions={actions}
        />
      }
    />
  );
}

type Centre = "map" | "routes";

function CentreTabs({ centre, routes, onChange }: { centre: Centre; routes: number; onChange: (c: Centre) => void }) {
  return (
    <div role="tablist" className="flex h-7 shrink-0 items-stretch gap-3 border-b border-border px-3 text-xs">
      {(["map", "routes"] as const).map((c) => (
        <button
          key={c}
          type="button"
          role="tab"
          aria-selected={centre === c}
          onClick={() => onChange(c)}
          className={`-mb-px flex items-center gap-1 border-b capitalize ${
            centre === c ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {c}
          {c === "routes" && <span className="font-normal tabular-nums text-muted">{routes}</span>}
        </button>
      ))}
    </div>
  );
}
