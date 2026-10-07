"use client";

import { useMemo, type ReactNode } from "react";
import { insights as findInsights } from "@/lib/graph/insights";
import { categoryCounts, inCategory } from "@/lib/map/categories";
import { neighbours as neighboursOf, type RepoFile } from "@/lib/map/detail";
import { fold as foldFiles } from "@/lib/map/fold";
import { folderFan, type FileEdge } from "@/lib/map/view";
import { CategoryRail } from "./category-rail";
import { DependencyMap } from "./dependency-map";
import { DetailPane, type RepoInfo } from "./detail-pane";
import { MapShell } from "./map-shell";
import { useMapState } from "./map-state";

/**
 * The map and its detail pane over one parse result. Everything both of them
 * show is derived here, once, from data already in the browser, so selecting
 * or hovering is a lookup and never a request.
 */
export function MapWorkspace({
  title,
  repo,
  files,
  edges,
}: {
  title: ReactNode;
  repo: RepoInfo;
  files: RepoFile[];
  edges: FileEdge[];
}) {
  const fold = useMemo(() => foldFiles(files), [files]);
  const fan = useMemo(() => folderFan(fold, edges), [fold, edges]);
  const facts = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const neighbours = useMemo(() => neighboursOf(files.map((f) => f.path), edges), [files, edges]);
  const categories = useMemo(() => categoryCounts(files), [files]);
  const insights = useMemo(() => findInsights(files, edges), [files, edges]);
  const [state, actions] = useMapState(fold, facts);
  const { category } = state;
  const matched = useMemo(() => (category === null ? null : inCategory(files, category.role)), [files, category]);

  return (
    <MapShell
      title={title}
      rail={<CategoryRail categories={categories} category={category} onToggle={actions.toggleCategory} />}
      map={
        <DependencyMap
          fold={fold}
          fan={fan}
          facts={facts}
          edges={edges}
          matched={matched}
          state={state}
          actions={actions}
        />
      }
      detail={
        <DetailPane
          repo={repo}
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
