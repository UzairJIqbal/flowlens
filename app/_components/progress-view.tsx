"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, type ReactNode } from "react";
import type { ActionState } from "@/lib/analyses/actions";
import type { AnalysisStage, Progress } from "@/lib/analyses/progress";
import { useRunProgress, type RunKind } from "@/lib/analyses/use-progress";
import { utc } from "@/lib/utc";
import { LiveLabel } from "@/app/_components/live-label";

type View = {
  progress: Progress;
  // Only what this page has actually seen published. A stage passed before
  // the page opened has no message, rather than a guessed one.
  messages: Partial<Record<AnalysisStage, string>>;
  stale: boolean;
};

type StageState = "done" | "current" | "failed" | "pending";

const GLYPH: Record<StageState, { glyph: string; className: string }> = {
  done: { glyph: "●", className: "text-foreground" },
  current: { glyph: "◐", className: "text-foreground" },
  failed: { glyph: "✕", className: "text-danger" },
  pending: { glyph: "○", className: "text-muted" },
};

/** One run as the page loaded it: an analysis or a pull request preview. */
export type RunDetail = {
  id: string;
  kind: RunKind;
  stages: readonly AnalysisStage[];
  progress: Progress;
  stale: boolean;
  startedAt: string | null;
  /** The commit shown after "Complete", when the run has one stored. */
  commitSha: string | null;
  mapHref: string;
};

/** Shows live stages and rerun controls, opening the map when a watched run completes. */
export function ProgressView({
  run: analysis,
  crumbs,
  rerun,
  rerunNote,
  rerunsComplete,
}: {
  run: RunDetail;
  /** The page heading after the "Analyses" crumb. */
  crumbs: ReactNode;
  rerun: (state: ActionState) => Promise<ActionState>;
  rerunNote: string;
  /** False when a complete run can't change by running again. */
  rerunsComplete: boolean;
}) {
  const { stages, mapHref } = analysis;
  const [view, setView] = useState<View>(() => ({
    progress: analysis.progress,
    messages: record({}, analysis.progress),
    stale: analysis.stale,
  }));
  const [rerunState, rerunAction, rerunPending] = useActionState(rerun, null);

  const router = useRouter();

  const live = useRunProgress(analysis.kind, [analysis.id], (_, next) => {
    // A run finishing while this page watches goes straight to its map. Opening
    // the page on an analysis that was already complete doesn't: that visit is
    // for the pipeline itself, to re-run it.
    if (next.status === "complete" && view.progress.status !== "complete") router.push(mapHref);
    setView((current) => advance(stages, current, next));
  });

  const { progress, messages, stale } = view;
  const canRerun = (progress.status !== "parsing" || stale) && (rerunsComplete || progress.status !== "complete");

  return (
    <section className="flex min-h-0 flex-1 flex-col text-xs">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Link href="/analyses" className="text-muted hover:text-foreground">
          Analyses
        </Link>
        <span className="text-muted">/</span>
        {crumbs}
        <LiveLabel live={live} />
      </div>

      <div className="flex max-w-3xl flex-col gap-3 p-3">
        <ol>
          {stages.map((stage) => {
            const state = stageState(stages, stage, progress);
            const glyph = GLYPH[state];
            const message =
              state === "failed" ? progress.message : state === "pending" ? undefined : messages[stage];
            return (
              <li key={stage} className="grid h-6 grid-cols-[1rem_3.5rem_1fr] items-center">
                <span className={glyph.className} aria-hidden>
                  {glyph.glyph}
                </span>
                <span className={state === "pending" ? "text-muted" : glyph.className}>{stage}</span>
                <span
                  className={`truncate ${state === "failed" ? "text-danger" : state === "done" ? "text-muted" : ""}`}
                  title={message ?? undefined}
                >
                  {message}
                </span>
              </li>
            );
          })}
        </ol>

        <Outcome analysis={analysis} view={view} />

        {/* The stored map survives a re-run until the new one replaces it. */}
        {analysis.commitSha && progress.status !== "parsing" && (
          <p>
            <Link href={mapHref} className="text-accent hover:underline">
              Open the map
            </Link>
          </p>
        )}

        {canRerun && (
          <form action={rerunAction} className="flex items-center gap-2">
            <button
              type="submit"
              disabled={rerunPending}
              className="h-6 rounded border border-border px-2.5 hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {rerunPending ? "Starting" : "Re-run"}
            </button>
            <span className="text-muted">{rerunNote}</span>
          </form>
        )}
        {rerunState && <p className="text-danger">{rerunState.error}</p>}
      </div>
    </section>
  );
}

/** Explains the run outcome or stale state without repeating a stage failure message. */
function Outcome({ analysis, view: { progress, stale } }: { analysis: RunDetail; view: View }) {
  if (stale) {
    const since = analysis.startedAt ? `${utc(analysis.startedAt).time} UTC` : "it was created";
    return (
      <p className="text-danger">
        Stale: unfinished since {since}. The run that owned it has stopped without recording why.
      </p>
    );
  }
  switch (progress.status) {
    case "queued":
      return <p className="text-muted">Queued. No run has started.</p>;
    case "parsing":
      return null;
    case "complete":
      return (
        <p>
          Complete
          {/* The stored commit belongs to the run the page loaded with, not one finished since. */}
          {analysis.commitSha && progress === analysis.progress && (
            <span className="text-muted">
              {" "}
              at <span className="font-mono">{analysis.commitSha.slice(0, 7)}</span>
            </span>
          )}
          .
        </p>
      );
    case "failed":
      // The reason sits on the stage it failed in; only a run that failed
      // before reaching any stage needs it here.
      return progress.stage ? null : <p className="text-danger">Failed: {progress.message}</p>;
  }
}

/** Derives a stage indicator from its position in the current run and the run status. */
function stageState(stages: readonly AnalysisStage[], stage: AnalysisStage, progress: Progress): StageState {
  const at = progress.stage ? stages.indexOf(progress.stage) : -1;
  const index = stages.indexOf(stage);
  switch (progress.status) {
    case "queued":
      return "pending";
    case "complete":
      return "done";
    case "parsing":
      return index < at ? "done" : index === at ? "current" : "pending";
    case "failed":
      return index < at ? "done" : index === at ? "failed" : "pending";
  }
}

/** Applies changed progress, clearing old messages on restart and the stale marker on movement. */
function advance(stages: readonly AnalysisStage[], view: View, next: Progress): View {
  const { progress } = view;
  // The catch-up read usually repeats what's on screen; that isn't movement.
  if (progress.status === next.status && progress.stage === next.stage && progress.message === next.message) {
    return view;
  }
  // A new run starts back at the first stage, so what the last one said goes.
  const restarted =
    next.status === "parsing" &&
    (progress.status !== "parsing" ||
      (next.stage !== null && progress.stage !== null && stages.indexOf(next.stage) < stages.indexOf(progress.stage)));
  return { progress: next, messages: record(restarted ? {} : view.messages, next), stale: false };
}

/** Retains messages observed during parsing for display after their stages finish. */
function record(messages: View["messages"], progress: Progress): View["messages"] {
  if (progress.status !== "parsing" || !progress.stage || !progress.message) return messages;
  return { ...messages, [progress.stage]: progress.message };
}
