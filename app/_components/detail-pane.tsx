"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { Tracing } from "@/lib/ai/client";
import { INSIGHT_ORDER, INSIGHT_SENTENCES, type Cycle, type InsightKind, type Insights } from "@/lib/graph/insights";
import { DEFAULT_DEPTH, reach, type Direction, type Link as EdgeLink } from "@/lib/graph/reach";
import { categoryCounts, type Kinds } from "@/lib/map/categories";
import {
  importedByNothing,
  mostDependedOn,
  type Neighbours,
  type RepoFile,
} from "@/lib/map/detail";
import type { Fold } from "@/lib/map/fold";
import type { Target } from "@/lib/map/prose";
import type { folderFan } from "@/lib/map/view";
import { Explanation, type Entries } from "./explanation";
import type { MapActions, MapState } from "./map-state";

export interface RepoInfo {
  name: string;
  /** The framework adapter the parser ran with; "none" is the fallback that identifies nothing. */
  adapter: string;
  coverage: { parsed: number; skipped: number };
  /** Routes read exactly, and route declarations that couldn't be. */
  routes: { found: number; withheld: number };
}

type Tab = "structure" | "explanation";

/** Ranked lists in the summary show this many before asking to show the rest. */
const LIST_LIMIT = 10;

// Same colours as the map's edges, so a list's heading says which direction it is.
const IMPORTS_COLOR = "var(--edge-uses)";
const IMPORTED_BY_COLOR = "var(--edge-used-by)";

export function DetailPane({
  analysisId,
  tracing,
  repo,
  kinds,
  files,
  facts,
  fold,
  fan,
  neighbours,
  edges,
  insights,
  state,
  actions,
}: {
  analysisId: string;
  tracing: Tracing;
  repo: RepoInfo;
  kinds: Kinds;
  files: RepoFile[];
  facts: Map<string, RepoFile>;
  fold: Fold;
  fan: ReturnType<typeof folderFan>;
  neighbours: Map<string, Neighbours>;
  edges: EdgeLink[];
  insights: Insights;
  state: MapState;
  actions: MapActions;
}) {
  // These live here rather than with the selection, so they survive changing
  // what's selected: comparing three files' blast radius shouldn't take three
  // clicks on the button.
  const [tab, setTab] = useState<Tab>("structure");
  const [walk, setWalk] = useState<Direction | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  // An explanation already fetched stays when the selection moves away and
  // comes back: a cache nobody can feel is not a cache.
  const [entries, setEntries] = useState<Entries>(() => new Map());
  const { selection, hovered } = state;
  const link = { actions, hovered };
  const resolve = useCallback(
    (path: string): Target | null =>
      facts.has(path)
        ? { kind: "file", path }
        : path !== "." && fold.nodes.some((n) => n.id === path)
          ? { kind: "folder", id: path }
          : null,
    [facts, fold],
  );

  // The resting state, not a placeholder: deselecting always lands here.
  if (selection === null)
    return (
      <RepoSummary
        repo={repo}
        kinds={kinds}
        files={files}
        insights={insights}
        insightsOpen={insightsOpen}
        onToggleInsights={() => setInsightsOpen((o) => !o)}
        link={link}
      />
    );

  return (
    <div className="text-xs">
      <Tabs tab={tab} onChange={setTab} />
      {tab === "explanation" ? (
        <Explanation
          analysisId={analysisId}
          selection={selection}
          entries={entries}
          setEntries={setEntries}
          resolve={resolve}
          actions={actions}
          hovered={hovered}
          tracing={tracing}
        />
      ) : selection.kind === "file" ? (
        <FileStructure
          file={facts.get(selection.path)!}
          kinds={kinds}
          neighbours={neighbours.get(selection.path)!}
          edges={edges}
          walk={walk}
          onWalk={(d) => setWalk((w) => (w === d ? null : d))}
          link={link}
        />
      ) : (
        <FolderStructure
          id={selection.id}
          adapter={repo.adapter}
          kinds={kinds}
          files={fold.nodes.find((n) => n.id === selection.id)!.files.map((p) => facts.get(p)!)}
          fan={fan.get(selection.id)!}
        />
      )}
    </div>
  );
}

/** What every clickable path needs: how to select and point, and what's pointed at. */
type Link = { actions: MapActions; hovered: ReadonlySet<string> };

function RepoSummary({
  repo,
  kinds,
  files,
  insights,
  insightsOpen,
  onToggleInsights,
  link,
}: {
  repo: RepoInfo;
  kinds: Kinds;
  files: RepoFile[];
  insights: Insights;
  insightsOpen: boolean;
  onToggleInsights: () => void;
  link: Link;
}) {
  const unidentified = files.filter((f) => f.role === null).length;
  const leanedOn = mostDependedOn(files);
  const starts = importedByNothing(files);
  const imports = files.reduce((n, f) => n + f.fanOut, 0);

  return (
    <div className="text-xs">
      <h2 className="truncate px-3 pt-2.5 font-mono font-semibold" title={repo.name}>
        {repo.name}
      </h2>
      <Facts>
        <Fact label="framework">
          {kinds.framework ?? (
            <span className="text-muted" title="No framework adapter matched this repository">
              none detected
            </span>
          )}
        </Fact>
        <Fact label="files">
          {repo.coverage.parsed}
          {repo.coverage.skipped > 0 && <span className="text-muted"> · {repo.coverage.skipped} skipped</span>}
        </Fact>
        <Fact label="imports">{imports}</Fact>
        <Fact label="routes">
          {kinds.framework === null ? (
            // Absent, not zero: with no framework, nothing knows what a route looks like.
            <span className="text-muted" title="Routes come from a framework adapter; none matched">
              —
            </span>
          ) : (
            <>
              {repo.routes.found}
              {repo.routes.withheld > 0 && (
                <span className="text-muted"> · {repo.routes.withheld} not read exactly</span>
              )}
            </>
          )}
        </Fact>
        <Fact label="unidentified">
          {unidentified}
          <span className="text-muted"> of {files.length} · no convention identified them</span>
        </Fact>
      </Facts>

      <RankedList
        title="Most depended on"
        note="imported by"
        files={leanedOn}
        count={(f) => f.fanIn}
        link={link}
      />
      <RankedList
        title="Imported by nothing"
        note="imports"
        hint="Where reading starts."
        files={starts}
        count={(f) => f.fanOut}
        link={link}
      />
      <InsightsPanel insights={insights} open={insightsOpen} onToggle={onToggleInsights} link={link} />
    </div>
  );
}

function RankedList({
  title,
  note,
  hint,
  files,
  count,
  link,
}: {
  title: string;
  /** What the number on each row counts. */
  note: string;
  hint?: string;
  files: RepoFile[];
  count: (f: RepoFile) => number;
  link: Link;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? files : files.slice(0, LIST_LIMIT);
  return (
    <section className="mt-3">
      <h3 className="flex h-6 items-center gap-1.5 border-y border-border bg-surface px-3 font-semibold">
        {title}
        <span className="font-normal tabular-nums text-muted">{files.length}</span>
        <span className="ml-auto font-normal text-muted">{note}</span>
      </h3>
      {hint && <p className="px-3 pt-1 text-muted">{hint}</p>}
      <ul className="py-1">
        {shown.map((f) => (
          <PathRow key={f.path} path={f.path} count={count(f)} link={link} />
        ))}
      </ul>
      {files.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="px-3 pb-1 text-accent hover:underline"
        >
          Show all {files.length}
        </button>
      )}
    </section>
  );
}

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div role="tablist" className="flex h-7 items-stretch gap-3 border-b border-border px-3">
      {(["structure", "explanation"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={tab === t}
          onClick={() => onChange(t)}
          className={`-mb-px border-b capitalize ${
            tab === t ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function FileStructure({
  file,
  kinds,
  neighbours,
  edges,
  walk,
  onWalk,
  link,
}: {
  file: RepoFile;
  kinds: Kinds;
  neighbours: Neighbours;
  edges: EdgeLink[];
  walk: Direction | null;
  onWalk: (d: Direction) => void;
  link: Link;
}) {
  // Counts are the lengths of the lists below them, so they can't disagree.
  const { imports, importedBy } = neighbours;
  // Arithmetic over edges already here: no spinner, no request.
  const reached = useMemo(() => (walk === null ? null : reach(edges, file.path, walk)), [edges, file.path, walk]);
  return (
    <div>
      <ul className="pt-1.5">
        <PathRow path={file.path} link={link} full />
      </ul>
      <Facts>
        <Fact label="kind">
          {file.role === null ? (
            file.label === null ? (
              <span className="text-muted" title="No convention identified this file">
                unidentified
              </span>
            ) : (
              <>
                {file.label}
                <span className="text-muted" title="No convention identified this file; a model labelled it">
                  {" "}
                  · labelled by a model
                </span>
              </>
            )
          ) : (
            kinds.one(file.role)
          )}
        </Fact>
        <Fact label="lines">{file.lines}</Fact>
        <Fact label="imports">{imports.length}</Fact>
        <Fact label="imported by">{importedBy.length}</Fact>
      </Facts>
      <div className="flex gap-1.5 px-3 pt-2.5">
        {WALKS.map((w) => (
          <button
            key={w.direction}
            type="button"
            aria-pressed={walk === w.direction}
            onClick={() => onWalk(w.direction)}
            title={w.explain}
            className={`flex h-6 items-center gap-1.5 rounded-sm border px-2 ${
              walk === w.direction ? "border-accent bg-surface font-semibold" : "border-border hover:border-muted"
            }`}
          >
            <span className="inline-block h-0.5 w-3" style={{ background: w.color }} aria-hidden />
            {w.title}
          </button>
        ))}
      </div>
      {walk !== null && reached !== null && (
        <WalkList walk={WALKS.find((w) => w.direction === walk)!} reached={reached} link={link} />
      )}
      <NeighbourList title="Imports" color={IMPORTS_COLOR} paths={imports} empty="Imports no file in this repository." link={link} />
      <NeighbourList
        title="Imported by"
        color={IMPORTED_BY_COLOR}
        paths={importedBy}
        empty="No file in this repository imports it."
        link={link}
      />
    </div>
  );
}

interface Walk {
  direction: Direction;
  title: string;
  explain: string;
  /** The edge colour for the direction this walks: dependents arrive, dependencies leave. */
  color: string;
  empty: string;
}

const WALKS: Walk[] = [
  {
    direction: "dependents",
    title: "Blast radius",
    explain: `Everything that breaks if this file changes, up to ${DEFAULT_DEPTH} imports away`,
    color: IMPORTED_BY_COLOR,
    empty: "No file in this repository imports it, so nothing here depends on it.",
  },
  {
    direction: "dependencies",
    title: "Dependency chain",
    explain: `Everything this file needs, up to ${DEFAULT_DEPTH} imports away`,
    color: IMPORTS_COLOR,
    empty: "Imports no file in this repository.",
  },
];

function WalkList({ walk, reached, link }: { walk: Walk; reached: { path: string; depth: number }[]; link: Link }) {
  return (
    <section className="mt-3">
      <h3 className="flex h-6 items-center gap-1.5 border-y border-border bg-surface px-3 font-semibold">
        <span className="inline-block h-0.5 w-3" style={{ background: walk.color }} aria-hidden />
        {walk.title}
        <span className="font-normal tabular-nums text-muted">{reached.length}</span>
        <span className="ml-auto font-normal text-muted">imports away</span>
      </h3>
      {reached.length === 0 ? (
        <p className="px-3 py-1 text-muted">{walk.empty}</p>
      ) : (
        <ul className="py-1">
          {reached.map((r) => (
            <PathRow key={r.path} path={r.path} count={r.depth} link={link} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NeighbourList({
  title,
  color,
  paths,
  empty,
  link,
}: {
  title: string;
  color: string;
  paths: string[];
  empty: string;
  link: Link;
}) {
  return (
    <section className="mt-3">
      <h3 className="flex h-6 items-center gap-1.5 border-y border-border bg-surface px-3 font-semibold">
        <span className="inline-block h-0.5 w-3" style={{ background: color }} aria-hidden />
        {title}
        <span className="font-normal tabular-nums text-muted">{paths.length}</span>
      </h3>
      {paths.length === 0 ? (
        <p className="px-3 py-1 text-muted">{empty}</p>
      ) : (
        <ul className="py-1">
          {paths.map((p) => (
            <PathRow key={p} path={p} link={link} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Facts about the edge list, behind a header that starts closed. It sits at
 * the bottom of the summary and is never the first thing on screen: this
 * explains a codebase, it doesn't grade one. No total on the closed header for
 * the same reason; a count there reads as a score.
 */
function InsightsPanel({
  insights,
  open,
  onToggle,
  link,
}: {
  insights: Insights;
  open: boolean;
  onToggle: () => void;
  link: Link;
}) {
  return (
    <section className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-6 w-full items-center gap-1.5 border-y border-border bg-surface px-3 text-left font-semibold"
      >
        <span className="w-2.5 text-muted" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        Insights
      </button>
      {open &&
        INSIGHT_ORDER.map((kind) => <InsightGroup key={kind} kind={kind} insights={insights} link={link} />)}
    </section>
  );
}

/** The per-file kinds, and what the number on each row counts. */
const FILE_INSIGHTS = {
  unimported: { rows: (i: Insights) => i.unimported, note: "" },
  "heavily-imported": { rows: (i: Insights) => i.heavilyImported, note: "imported by" },
  oversized: { rows: (i: Insights) => i.oversized, note: "lines" },
} satisfies Record<Exclude<InsightKind, "cycle">, unknown>;

function InsightGroup({ kind, insights, link }: { kind: InsightKind; insights: Insights; link: Link }) {
  const [all, setAll] = useState(false);
  const count = kind === "cycle" ? insights.cycles.length : FILE_INSIGHTS[kind].rows(insights).length;

  return (
    <div className="border-b border-border pb-1 last:border-b-0">
      <p className="flex gap-1.5 px-3 pt-2">
        <span className="min-w-0">{INSIGHT_SENTENCES[kind]}</span>
        <span className="ml-auto shrink-0 tabular-nums text-muted">{count}</span>
      </p>
      {count === 0 ? (
        <p className="px-3 pt-0.5 text-muted">None.</p>
      ) : kind === "cycle" ? (
        insights.cycles.map((c) => <CycleRows key={c.tangle[0]} cycle={c} link={link} />)
      ) : (
        <FileRows rows={FILE_INSIGHTS[kind].rows(insights)} note={FILE_INSIGHTS[kind].note} all={all} onAll={() => setAll(true)} link={link} />
      )}
    </div>
  );
}

function FileRows({
  rows,
  note,
  all,
  onAll,
  link,
}: {
  rows: { path: string; count?: number }[];
  /** What the number on each row counts, if there is one. */
  note: string;
  all: boolean;
  onAll: () => void;
  link: Link;
}) {
  const shown = all ? rows : rows.slice(0, LIST_LIMIT);
  return (
    <>
      {note && <p className="px-3 text-right text-muted">{note}</p>}
      <ul className="pt-0.5">
        {shown.map((r) => (
          <PathRow key={r.path} path={r.path} count={r.count} link={link} />
        ))}
      </ul>
      {rows.length > shown.length && (
        <button type="button" onClick={onAll} className="px-3 text-accent hover:underline">
          Show all {rows.length}
        </button>
      )}
    </>
  );
}

/**
 * One loop, in import order, so it can be walked by hand: each row imports
 * the next, and the last imports the first again.
 */
function CycleRows({ cycle, link }: { cycle: Cycle; link: Link }) {
  const [tangle, setTangle] = useState(false);
  const first = cycle.loop[0];
  return (
    <div className="pt-1">
      <ol>
        {cycle.loop.map((p) => (
          <PathRow key={p} path={p} link={link} />
        ))}
      </ol>
      <p className="px-3 font-mono text-[11px] text-muted">
        ↩ {first.slice(first.lastIndexOf("/") + 1)}
      </p>
      {cycle.tangle.length > cycle.loop.length && (
        <>
          <button type="button" onClick={() => setTangle((t) => !t)} className="px-3 text-left text-accent hover:underline">
            {tangle ? "Hide" : "Show"} all {cycle.tangle.length} files in loops with these
          </button>
          {tangle && (
            <ul className="pt-0.5">
              {cycle.tangle.map((p) => (
                <PathRow key={p} path={p} link={link} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function FolderStructure({
  id,
  adapter,
  kinds,
  files,
  fan,
}: {
  id: string;
  adapter: string;
  kinds: Kinds;
  files: RepoFile[];
  fan: { fanIn: number; fanOut: number };
}) {
  return (
    <div>
      <h2 className="break-all px-3 pt-2.5 font-mono font-semibold">{id === "." ? "./" : `${id}/`}</h2>
      <Facts>
        <Fact label="files">{files.length}</Fact>
        <Fact label="imported by">
          {fan.fanIn}
          <span className="text-muted"> files outside it</span>
        </Fact>
        <Fact label="imports">
          {fan.fanOut}
          <span className="text-muted"> files outside it</span>
        </Fact>
      </Facts>
      <section className="mt-3">
        <h3 className="flex h-6 items-center border-y border-border bg-surface px-3 font-semibold">Kinds of file</h3>
        <ul className="py-1">
          {categoryCounts(files, adapter).map(({ role, count }) => (
            <li key={role ?? ""} className="flex h-5 items-center px-3">
              {role === null ? (
                <span className="text-muted" title="No convention identified these files">
                  Unidentified
                </span>
              ) : (
                kinds.label(role)
              )}
              <span className="ml-auto tabular-nums">{count}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * Every file path in the pane. Clicking selects it on the map; pointing at it
 * lights it on the map, and it lights up here when it's pointed at there.
 */
function PathRow({ path, count, full, link }: { path: string; count?: number; full?: boolean; link: Link }) {
  const { actions, hovered } = link;
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const dir = path.slice(0, slash + 1);
  return (
    <li>
      <button
        type="button"
        title={path}
        onClick={() => actions.revealFile(path)}
        onMouseEnter={() => actions.hover({ kind: "file", path })}
        onMouseLeave={() => actions.hover(null)}
        className={`flex w-full items-center gap-2 px-3 text-left font-mono text-[11px] hover:bg-surface ${
          full ? "py-0.5 font-semibold" : "h-5"
        } ${hovered.has(path) ? "bg-surface ring-1 ring-inset ring-accent" : ""}`}
      >
        {full ? (
          // The selected file's own path is shown whole; it is the thing being described.
          <span className="min-w-0 break-all">{path}</span>
        ) : (
          <span className="flex min-w-0 flex-1">
            <span className="max-w-[75%] shrink-0 truncate">{name}</span>
            <span className="ml-2 min-w-0 truncate text-muted">{dir}</span>
          </span>
        )}
        {count !== undefined && <span className="ml-auto shrink-0 tabular-nums text-muted">{count}</span>}
      </button>
    </li>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-y-0.5 px-3 pt-2">{children}</dl>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </>
  );
}
