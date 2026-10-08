"use client";

import { useRouter } from "next/navigation";
import { useState, type Dispatch, type SetStateAction } from "react";
import type { Tracing } from "@/lib/ai/client";
import { rerunAnalysis } from "@/lib/analyses/actions";
import { checkFreshness, explainFile, explainFolder, type Explained, type Freshness } from "@/lib/analyses/explain";
import type { Selection } from "@/lib/map/selection";
import { linkPaths, parseProse, type Span, type Target } from "@/lib/map/prose";
import type { MapActions } from "./map-state";

/** One target's explanation, as far as it has got. */
export interface Entry {
  pending: boolean;
  answer: Explained | null;
  /** Null until the check has been asked for. */
  freshness: Freshness | "checking" | null;
}

/** Keyed by what was explained, so each file and folder keeps its own. */
export type Entries = ReadonlyMap<string, Entry>;

/** Keeps file and folder explanation entries distinct even when their paths match. */
const keyOf = (s: Selection) => (s.kind === "file" ? `file:${s.path}` : `folder:${s.id}`);

/** Requests and displays the selection's explanation, freshness and tracing status. */
export function Explanation({
  analysisId,
  selection,
  entries,
  setEntries,
  resolve,
  actions,
  hovered,
  tracing,
}: {
  analysisId: string;
  selection: Selection;
  entries: Entries;
  setEntries: Dispatch<SetStateAction<Entries>>;
  /** What a path in the prose leads to on this map, if anything. */
  resolve: (path: string) => Target | null;
  actions: MapActions;
  hovered: ReadonlySet<string>;
  tracing: Tracing;
}) {
  const key = keyOf(selection);
  const entry = entries.get(key);

  /** Updates this selection's entry without discarding answers for other selections. */
  const update = (change: (e: Entry) => Entry) =>
    setEntries((prev) => new Map(prev).set(key, change(prev.get(key) ?? { pending: false, answer: null, freshness: null })));

  /** Stores the answer before checking whether its analysed source is still current. */
  const explain = async () => {
    update((e) => ({ ...e, pending: true, freshness: "checking" }));
    const answer =
      selection.kind === "file"
        ? await explainFile(analysisId, selection.path)
        : await explainFolder(analysisId, selection.id);
    update((e) => ({ ...e, pending: false, answer }));
    // After the answer, not alongside it: actions run one at a time, and the
    // explanation is what was asked for.
    const freshness = await checkFreshness(analysisId, selection.kind === "file" ? selection.path : null);
    update((e) => ({ ...e, freshness }));
  };

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={explain}
          disabled={entry?.pending}
          className="flex h-6 items-center rounded-sm border border-border px-2 hover:border-muted disabled:text-muted"
        >
          {entry?.pending ? "Explaining…" : "Explain"}
        </button>
        <span className="min-w-0 truncate text-muted">
          {selection.kind === "file" ? "this file from its neighbours" : "this folder and what points at it"}
        </span>
      </div>

      {entry?.freshness && <FreshnessNote analysisId={analysisId} freshness={entry.freshness} file={selection.kind === "file"} />}

      {entry?.answer &&
        (entry.answer.ok ? (
          <Prose text={entry.answer.text} resolve={resolve} actions={actions} hovered={hovered} />
        ) : (
          <p className="pt-2.5 text-danger">{entry.answer.error}</p>
        ))}

      <p className="mt-3 border-t border-border pt-1.5 text-[11px] text-muted">
        {entry?.answer?.ok && (
          <>
            <span className="font-mono">{entry.answer.model}</span>
            {entry.answer.cached ? " · from cache" : " · answered now"}
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

/** Reports freshness and offers another analysis when the repository has moved. */
function FreshnessNote({ analysisId, freshness, file }: { analysisId: string; freshness: Freshness | "checking"; file: boolean }) {
  if (freshness === "checking") return <p className="pt-2.5 text-muted">Checking GitHub for changes since the analysis…</p>;
  if (freshness.state === "unknown") return <p className="pt-2.5 text-muted">Couldn&apos;t check for changes: {freshness.reason}</p>;
  if (freshness.state === "current") {
    return (
      <p className="pt-2.5 text-muted">
        Current: <span className="font-mono">{freshness.commit.slice(0, 7)}</span> is still the latest commit.
      </p>
    );
  }

  const analysed = <span className="font-mono">{freshness.commit.slice(0, 7)}</span>;
  const head = <span className="font-mono">{freshness.head.slice(0, 7)}</span>;
  // Stale content is the one thing here coloured as a warning.
  const message =
    freshness.file === "changed" ? (
      <span className="text-danger">Stale. This file has changed since {analysed}, the commit analysed.</span>
    ) : freshness.file === "removed" ? (
      <span className="text-danger">Stale. This file no longer exists at the latest commit, {head}.</span>
    ) : (
      <>
        The repository has moved past {analysed} to {head}.{" "}
        {file ? "This file is unchanged, but its neighbours may not be." : "Files in this folder may have changed."}
      </>
    );
  return (
    <div className="pt-2.5">
      <p>{message}</p>
      <Reanalyse analysisId={analysisId} />
    </div>
  );
}

/** Offers an analysis restart with pending and error feedback. */
function Reanalyse({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null });
  /** Restarts the analysis and opens its progress page, or displays the returned error. */
  const run = async () => {
    setState({ pending: true, error: null });
    const result = await rerunAnalysis(analysisId);
    if (result === null) router.push(`/analyses/${analysisId}`);
    else setState({ pending: false, error: result.error });
  };
  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={state.pending}
        className="mt-1.5 flex h-6 items-center rounded-sm border border-border px-2 hover:border-muted disabled:text-muted"
      >
        {state.pending ? "Starting…" : "Re-analyse"}
      </button>
      {state.error && <p className="pt-1 text-danger">{state.error}</p>}
    </>
  );
}

/** Renders parsed explanation paragraphs and bullets with navigation to known map paths. */
function Prose({
  text,
  resolve,
  actions,
  hovered,
}: {
  text: string;
  resolve: (path: string) => Target | null;
  actions: MapActions;
  hovered: ReadonlySet<string>;
}) {
  const blocks = parseProse(text);
  return (
    <div className="space-y-2 pt-2.5 leading-relaxed">
      {blocks.map((b, i) =>
        b.bullet ? (
          <p key={i} className="flex gap-1.5 pl-1">
            <span className="text-muted" aria-hidden>
              •
            </span>
            <span className="min-w-0">
              <Spans spans={b.spans} resolve={resolve} actions={actions} hovered={hovered} />
            </span>
          </p>
        ) : (
          <p key={i}>
            <Spans spans={b.spans} resolve={resolve} actions={actions} hovered={hovered} />
          </p>
        ),
      )}
    </div>
  );
}

/** Applies inline formatting and turns resolved paths into map navigation and hover controls. */
function Spans({
  spans,
  resolve,
  actions,
  hovered,
}: {
  spans: Span[];
  resolve: (path: string) => Target | null;
  actions: MapActions;
  hovered: ReadonlySet<string>;
}) {
  return spans.map((s, i) => {
    const pieces = linkPaths(s.text, resolve).map((p, j) => {
      if (!p.target) return <span key={j}>{p.text}</span>;
      const target = p.target;
      const lit = target.kind === "file" && hovered.has(target.path);
      return (
        <button
          key={j}
          type="button"
          onClick={() => (target.kind === "file" ? actions.revealFile(target.path) : actions.openFolder(target.id))}
          onMouseEnter={() =>
            actions.hover(target.kind === "file" ? { kind: "file", path: target.path } : { kind: "folder", id: target.id })
          }
          onMouseLeave={() => actions.hover(null)}
          className={`break-all font-mono text-[11px] text-accent hover:underline ${lit ? "bg-surface ring-1 ring-inset ring-accent" : ""}`}
        >
          {p.text}
        </button>
      );
    });
    const style = `${s.bold ? "font-semibold" : ""} ${s.code ? "rounded-sm bg-surface px-0.5 font-mono text-[11px] whitespace-pre-wrap" : ""}`;
    return (
      <span key={i} className={style}>
        {pieces}
      </span>
    );
  });
}
