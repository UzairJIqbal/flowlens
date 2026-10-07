"use client";

import { useState, type ReactNode } from "react";
import {
  importedByNothing,
  kindCounts,
  mostDependedOn,
  type Neighbours,
  type RepoFile,
} from "@/lib/map/detail";
import type { Fold } from "@/lib/map/fold";
import type { folderFan } from "@/lib/map/view";
import type { MapActions, MapState } from "./map-state";

export interface RepoInfo {
  name: string;
  /** The framework adapter the parser ran with; "none" is the fallback that identifies nothing. */
  adapter: string;
  coverage: { parsed: number; skipped: number };
}

type Tab = "structure" | "explanation";

/** Ranked lists in the summary show this many before asking to show the rest. */
const LIST_LIMIT = 10;

// Same colours as the map's edges, so a list's heading says which direction it is.
const IMPORTS_COLOR = "var(--edge-uses)";
const IMPORTED_BY_COLOR = "var(--edge-used-by)";

export function DetailPane({
  repo,
  files,
  facts,
  fold,
  fan,
  neighbours,
  state,
  actions,
}: {
  repo: RepoInfo;
  files: RepoFile[];
  facts: Map<string, RepoFile>;
  fold: Fold;
  fan: ReturnType<typeof folderFan>;
  neighbours: Map<string, Neighbours>;
  state: MapState;
  actions: MapActions;
}) {
  // Lives here rather than with the selection, so it survives changing what's selected.
  const [tab, setTab] = useState<Tab>("structure");
  const { selection, hovered } = state;
  const link = { actions, hovered };

  // The resting state, not a placeholder: deselecting always lands here.
  if (selection === null) return <RepoSummary repo={repo} files={files} link={link} />;

  return (
    <div className="text-xs">
      <Tabs tab={tab} onChange={setTab} />
      {tab === "explanation" ? (
        <p className="px-3 py-3 text-muted">No explanation yet. Nothing generates one in this version.</p>
      ) : selection.kind === "file" ? (
        <FileStructure file={facts.get(selection.path)!} neighbours={neighbours.get(selection.path)!} link={link} />
      ) : (
        <FolderStructure
          id={selection.id}
          files={fold.nodes.find((n) => n.id === selection.id)!.files.map((p) => facts.get(p)!)}
          fan={fan.get(selection.id)!}
        />
      )}
    </div>
  );
}

/** What every clickable path needs: how to select and point, and what's pointed at. */
type Link = { actions: MapActions; hovered: ReadonlySet<string> };

function RepoSummary({ repo, files, link }: { repo: RepoInfo; files: RepoFile[]; link: Link }) {
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
          {repo.adapter === "none" ? (
            <span className="text-muted" title="The parser ran without a framework adapter">
              none detected
            </span>
          ) : (
            repo.adapter
          )}
        </Fact>
        <Fact label="files">
          {repo.coverage.parsed}
          {repo.coverage.skipped > 0 && <span className="text-muted"> · {repo.coverage.skipped} skipped</span>}
        </Fact>
        <Fact label="imports">{imports}</Fact>
        <Fact label="routes">
          {/* The parser's output carries no routes yet. Absent, not zero: zero would be a claim. */}
          <span className="text-muted" title="Routes come from a framework adapter; none recovered any">
            —
          </span>
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

function FileStructure({ file, neighbours, link }: { file: RepoFile; neighbours: Neighbours; link: Link }) {
  // Counts are the lengths of the lists below them, so they can't disagree.
  const { imports, importedBy } = neighbours;
  return (
    <div>
      <ul className="pt-1.5">
        <PathRow path={file.path} link={link} full />
      </ul>
      <Facts>
        <Fact label="kind">
          {file.role ?? (
            <span className="text-muted" title="No convention identified this file">
              unidentified
            </span>
          )}
        </Fact>
        <Fact label="lines">{file.lines}</Fact>
        <Fact label="imports">{imports.length}</Fact>
        <Fact label="imported by">{importedBy.length}</Fact>
      </Facts>
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

function FolderStructure({
  id,
  files,
  fan,
}: {
  id: string;
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
          {kindCounts(files).map(({ kind, count }) => (
            <li key={kind ?? ""} className="flex h-5 items-center px-3">
              {kind ?? (
                <span className="text-muted" title="No convention identified these files">
                  unidentified
                </span>
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
