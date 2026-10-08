"use client";

import { useState, type ReactNode } from "react";
import type { Tracing } from "@/lib/ai/client";
import type { Explained } from "@/lib/analyses/explain";
import type { KindedEdge, Shares } from "@/lib/graph/diff";
import type { Target } from "@/lib/map/prose";
import type { ChangedFile } from "@/lib/pipeline/github";
import { changeLetter, type Change } from "@/lib/previews/combine";
import { explainChange } from "@/lib/previews/explain";
import type { PreviewSide, Unparsed } from "@/lib/previews/side";
import { Prose } from "./explanation";
import type { MapActions, MapState } from "./map-state";

/** Long lists show this many before asking to show the rest. */
const LIST_LIMIT = 20;

/**
 * The change in words: what the map draws, as lists. Counts and paths only;
 * nothing here weighs the change.
 */
export function ChangeList({
  previewId,
  tracing,
  base,
  head,
  changed,
  change,
  onMap,
  resolve,
  state,
  actions,
}: {
  previewId: string;
  tracing: Tracing;
  base: PreviewSide;
  head: PreviewSide;
  changed: ChangedFile[];
  change: Change;
  /** Files on the map; only these can be revealed. */
  onMap: ReadonlyMap<string, unknown>;
  resolve: (path: string) => Target | null;
  state: MapState;
  actions: MapActions;
}) {
  const { diff, affected, gap } = change;
  const selected = state.selection?.kind === "file" ? state.selection.path : null;
  const path = (p: string) => (
    <PathLink path={p} onMap={onMap.has(p)} selected={selected === p} hovered={state.hovered.has(p)} actions={actions} />
  );

  return (
    <div className="pb-4 text-xs">
      {gap.differs.length > 0 && <GapWarning gap={gap} />}

      <Section title="Coverage">
        <CoverageTable base={base} head={head} gap={gap} />
      </Section>

      <Section title="Explanation">
        <ExplainChange previewId={previewId} tracing={tracing} resolve={resolve} state={state} actions={actions} />
      </Section>

      <Section title="Changed files" count={changed.length}>
        <Limited
          items={changed}
          render={(c) => (
            <li key={c.path} className="px-3 py-0.5">
              <div className="flex items-baseline gap-2">
                <span className="w-2 shrink-0 font-mono font-semibold" title={c.status}>
                  {changeLetter(c.status)}
                </span>
                {path(c.path)}
              </div>
              {c.previousPath !== null && (
                <div className="flex items-baseline gap-1 pl-4 text-muted">
                  from {path(c.previousPath)}
                </div>
              )}
              <NotParsed path={c.path} base={base} head={head} />
            </li>
          )}
        />
      </Section>

      <Section title="Added imports" count={diff.addedEdges.length}>
        <Limited items={diff.addedEdges} render={(e) => <ImportRow key={key(e)} edge={e} path={path} />} />
      </Section>

      <Section title="Removed imports" count={diff.removedEdges.length}>
        <Limited items={diff.removedEdges} render={(e) => <ImportRow key={key(e)} edge={e} path={path} />} />
      </Section>

      <Section title="Affected" count={affected.length} note="Import a changed file, after the change: 1 directly, 2 through one other file.">
        <Limited
          items={affected}
          render={(a) => (
            <li key={a.path} className="flex items-baseline gap-2 px-3 py-0.5">
              {path(a.path)}
              <span className="ml-auto tabular-nums text-muted">{a.depth}</span>
            </li>
          )}
        />
      </Section>
    </div>
  );
}

const key = (e: KindedEdge) => `${e.from}\0${e.to}\0${e.kind}`;

function Section({ title, count, note, children }: { title: string; count?: number; note?: string; children: ReactNode }) {
  return (
    <section className="border-b border-border py-2">
      <h2 className="flex items-baseline gap-2 px-3 pb-1 font-semibold">
        {title}
        {count !== undefined && <span className="font-normal tabular-nums text-muted">{count}</span>}
      </h2>
      {note && <p className="px-3 pb-1 text-[11px] text-muted">{note}</p>}
      {count === 0 ? <p className="px-3 text-muted">None.</p> : children}
    </section>
  );
}

function Limited<T>({ items, render }: { items: readonly T[]; render: (item: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, LIST_LIMIT);
  return (
    <>
      <ul>{shown.map(render)}</ul>
      {items.length > LIST_LIMIT && (
        <button type="button" onClick={() => setAll(!all)} className="px-3 pt-1 text-muted hover:text-foreground">
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}

function PathLink({
  path,
  onMap,
  selected,
  hovered,
  actions,
}: {
  path: string;
  onMap: boolean;
  selected: boolean;
  hovered: boolean;
  actions: MapActions;
}) {
  // A path the map doesn't hold, such as a file no side parsed, is text: there's nothing to reveal.
  if (!onMap) return <span className="min-w-0 break-all font-mono text-[11px] text-muted">{path}</span>;
  return (
    <button
      type="button"
      onClick={() => actions.revealFile(path)}
      onMouseEnter={() => actions.hover({ kind: "file", path })}
      onMouseLeave={() => actions.hover(null)}
      className={`min-w-0 break-all text-left font-mono text-[11px] hover:underline ${selected ? "font-semibold" : ""} ${
        hovered ? "bg-surface ring-1 ring-inset ring-accent" : ""
      }`}
    >
      {path}
    </button>
  );
}

const KIND: Record<KindedEdge["kind"], string> = {
  import: "import",
  reexport: "re-export",
  dynamic: "dynamic import",
  require: "require",
};

function ImportRow({ edge, path }: { edge: KindedEdge; path: (p: string) => ReactNode }) {
  return (
    <li className="px-3 py-0.5">
      <div>{path(edge.from)}</div>
      <div className="flex items-baseline gap-1 pl-2">
        <span className="text-muted">→</span>
        {path(edge.to)}
        {edge.kind !== "import" && <span className="shrink-0 text-muted">{KIND[edge.kind]}</span>}
      </div>
    </li>
  );
}

const REASON: Record<Unparsed["reason"], string> = {
  "not-js-or-ts": "not JavaScript or TypeScript",
  "declaration-file": "a declaration file",
  "too-large": "too large to parse",
  "symbolic-link": "a symbolic link",
  dependencies: "inside a dependencies folder",
  "hidden-directory": "inside a hidden folder",
};

/** Why a changed file isn't on the map on a side where it exists, in the parser's words. */
function NotParsed({ path, base, head }: { path: string; base: PreviewSide; head: PreviewSide }) {
  const notes = (["before", "after"] as const).flatMap((label) => {
    const side = label === "before" ? base : head;
    const u = side.unparsed.find((x) => x.path === path);
    return u ? [{ label, u }] : [];
  });
  if (notes.length === 0) return null;
  // The same reason on both sides is said once.
  const same = notes.length === 2 && notes[0].u.reason === notes[1].u.reason;
  return (
    <>
      {(same ? [notes[1]] : notes).map(({ label, u }) => (
        <div key={label} className="pl-4 text-muted" title={u.detail}>
          not parsed{same ? "" : ` ${label}`}: {REASON[u.reason]}
        </div>
      ))}
    </>
  );
}

const percent = (share: number | null) => (share === null ? "—" : `${(share * 100).toFixed(1)}%`);

function CoverageTable({ base, head, gap }: { base: PreviewSide; head: PreviewSide; gap: Change["gap"] }) {
  const row = (label: string, side: PreviewSide, shares: Shares) => (
    <tr>
      <td className="pr-2 text-muted">{label}</td>
      <td className="pr-2 font-mono">{side.adapter}</td>
      <td className="pr-2 tabular-nums">
        {side.coverage.parsed}/{side.coverage.parsed + side.coverage.unparsed}{" "}
        <span className={gap.differs.includes("files") ? "font-semibold" : "text-muted"}>{percent(shares.files)}</span>
      </td>
      <td className="tabular-nums">
        {side.coverage.internal}/{side.coverage.internal + side.coverage.unresolved}{" "}
        <span className={gap.differs.includes("imports") ? "font-semibold" : "text-muted"}>{percent(shares.imports)}</span>
      </td>
    </tr>
  );
  const warnings = [...base.warnings.map((w) => ({ label: "before", w })), ...head.warnings.map((w) => ({ label: "after", w }))];
  return (
    <div className="px-3">
      <table className="w-full">
        <thead className="text-left text-[11px] text-muted">
          <tr>
            <th className="font-normal" />
            <th className="font-normal">adapter</th>
            <th className="font-normal">files parsed</th>
            <th className="font-normal">imports resolved</th>
          </tr>
        </thead>
        <tbody>
          {row("before", base, gap.base)}
          {row("after", head, gap.head)}
        </tbody>
      </table>
      {base.adapter !== head.adapter && (
        <p className="pt-1">The two sides were read as different frameworks; categories are the after side&apos;s.</p>
      )}
      {warnings.map(({ label, w }, i) => (
        <p key={i} className="pt-1 text-muted">
          {label}: {w}
        </p>
      ))}
    </div>
  );
}

/** Loud on purpose: a diff between two unequal parses can show imports that only one parse could see. */
function GapWarning({ gap }: { gap: Change["gap"] }) {
  const what = gap.differs.map((k) =>
    k === "files"
      ? `files parsed ${percent(gap.base.files)} before, ${percent(gap.head.files)} after`
      : `imports resolved ${percent(gap.base.imports)} before, ${percent(gap.head.imports)} after`,
  );
  return (
    <div role="alert" className="border-b-2 border-danger px-3 py-2 text-danger">
      <p className="font-semibold">The two sides weren&apos;t parsed equally.</p>
      <p className="pt-0.5">
        {what.join("; ")}. Some added or removed imports below may come from what the parser could read on one side, not from
        the change.
      </p>
    </div>
  );
}

function ExplainChange({
  previewId,
  tracing,
  resolve,
  state,
  actions,
}: {
  previewId: string;
  tracing: Tracing;
  resolve: (path: string) => Target | null;
  state: MapState;
  actions: MapActions;
}) {
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<Explained | null>(null);
  const explain = async () => {
    setPending(true);
    setAnswer(await explainChange(previewId));
    setPending(false);
  };
  return (
    <div className="px-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={explain}
          disabled={pending}
          className="flex h-6 items-center rounded-sm border border-border px-2 hover:border-muted disabled:text-muted"
        >
          {pending ? "Explaining…" : "Explain this change"}
        </button>
        <span className="min-w-0 truncate text-muted">from the lists below</span>
      </div>
      {answer &&
        (answer.ok ? (
          <Prose text={answer.text} resolve={resolve} actions={actions} hovered={state.hovered} />
        ) : (
          <p className="pt-2 text-danger">{answer.error}</p>
        ))}
      <p className="pt-1.5 text-[11px] text-muted">
        {answer?.ok && (
          <>
            <span className="font-mono">{answer.model}</span>
            {answer.cached ? " · from cache" : " · answered now"}
            {" · "}
          </>
        )}
        {tracing.enabled ? (
          <>
            traced to <span className="font-mono">{tracing.project}</span>
          </>
        ) : (
          <span className="text-danger" title="Calls still work; they just aren't recorded">
            not traced: {tracing.reason}
          </span>
        )}
      </p>
    </div>
  );
}
