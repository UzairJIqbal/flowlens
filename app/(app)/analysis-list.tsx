"use client";

import Link from "next/link";
import { useState } from "react";
import type { AnalysisStatus, AnalysisSummary } from "@/lib/analyses/list";
import type { Progress } from "@/lib/analyses/progress";
import { useAnalysisProgress } from "@/lib/analyses/use-progress";
import { LiveLabel } from "@/app/_components/live-label";
import { utc } from "@/lib/utc";

// State is told apart by shape first, so it reads in greyscale. Only a failure
// earns colour, because it is the one state someone has to act on.
const STATUS: Record<AnalysisStatus, { glyph: string; className: string }> = {
  queued: { glyph: "○", className: "text-muted" },
  parsing: { glyph: "◐", className: "text-foreground" },
  complete: { glyph: "●", className: "text-foreground" },
  failed: { glyph: "✕", className: "text-danger" },
};

const ORDER: AnalysisStatus[] = ["parsing", "queued", "complete", "failed"];

export function AnalysisList({ analyses }: { analyses: AnalysisSummary[] }) {
  // Published stages received since the page loaded, layered over the rows
  // the server rendered. A row with one has moved, so it is no longer stale.
  const [moved, setMoved] = useState<Record<string, Progress>>({});

  // Only rows that were unfinished when the page rendered: those are the ones
  // that can move without someone opening them.
  const unfinished = analyses
    .filter((a) => a.progress.status === "queued" || a.progress.status === "parsing")
    .map((a) => a.id);

  const live = useAnalysisProgress(unfinished, (id, progress) => {
    const rendered = analyses.find((a) => a.id === id)?.progress;
    setMoved((current) => {
      const shown = current[id] ?? rendered;
      // The catch-up read usually repeats what's on screen; that isn't movement.
      return shown && same(shown, progress) ? current : { ...current, [id]: progress };
    });
  });

  const rows = analyses.map((a) => {
    const progress = moved[a.id];
    return progress ? { ...a, progress, stale: false } : a;
  });

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-4 border-b border-border px-3 text-xs">
        <h1 className="font-semibold">
          Analyses
          <span className="ml-1.5 font-normal tabular-nums text-muted">{rows.length}</span>
        </h1>
        {rows.length > 0 && <StateCounts analyses={rows} />}
        <LiveLabel live={live} />
      </div>

      {rows.length === 0 ? <Empty /> : <Table analyses={rows} />}
    </section>
  );
}

function same(a: Progress, b: Progress): boolean {
  return a.status === b.status && a.stage === b.stage && a.message === b.message;
}

function StateCounts({ analyses }: { analyses: AnalysisSummary[] }) {
  const counts = new Map<AnalysisStatus, number>();
  for (const a of analyses) counts.set(a.progress.status, (counts.get(a.progress.status) ?? 0) + 1);
  const stale = analyses.filter((a) => a.stale).length;

  return (
    <ul className="flex gap-3 text-muted">
      {ORDER.filter((s) => counts.has(s)).map((s) => (
        <li key={s} className="flex items-center gap-1">
          <span className={STATUS[s].className} aria-hidden>
            {STATUS[s].glyph}
          </span>
          {s}
          <span className="tabular-nums text-foreground">{counts.get(s)}</span>
        </li>
      ))}
      {stale > 0 && (
        <li className="flex items-center gap-1">
          <span className="text-danger">stale</span>
          <span className="tabular-nums text-foreground">{stale}</span>
        </li>
      )}
    </ul>
  );
}

function Table({ analyses }: { analyses: AnalysisSummary[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-160 table-fixed border-collapse text-xs">
        <colgroup>
          <col className="w-[30%]" />
          <col className="w-[14%]" />
          <col className="w-[16%]" />
          <col />
        </colgroup>
        <thead className="sticky top-0 bg-surface text-left text-muted">
          <tr className="border-b border-border">
            <th className="h-7 px-3 font-normal">Repository</th>
            <th className="h-7 px-3 font-normal">State</th>
            <th className="h-7 px-3 font-normal">Created, UTC</th>
            <th className="h-7 px-3 font-normal">Detail</th>
          </tr>
        </thead>
        <tbody>
          {analyses.map((a) => {
            const status = STATUS[a.progress.status];
            const { date, time } = utc(a.createdAt);
            const detail = describe(a);
            return (
              <tr key={a.id} className="border-b border-border hover:bg-surface">
                <td className="h-7 truncate px-3 font-mono">
                  <Link
                    href={a.progress.status === "complete" ? `/analyses/${a.id}/map` : `/analyses/${a.id}`}
                    className="hover:text-accent"
                  >
                    <span className="text-muted">{a.repoOwner}/</span>
                    {a.repoName}
                  </Link>
                </td>
                <td className={`h-7 truncate px-3 ${status.className}`}>
                  <span className="mr-1.5 inline-block w-3" aria-hidden>
                    {status.glyph}
                  </span>
                  {a.progress.status}
                  {a.stale && <span className="ml-1.5 text-danger">stale</span>}
                </td>
                <td className="h-7 px-3 font-mono tabular-nums">
                  <span className="text-muted">{date}</span> {time}
                </td>
                <td className="h-7 truncate px-3 text-muted" title={detail}>
                  {detail}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function describe({ progress, stale }: AnalysisSummary): string {
  if (stale) return "No progress past the time limit. Open it to run it again.";
  const where = progress.stage ? `${progress.stage}: ` : "";
  switch (progress.status) {
    case "parsing":
    case "failed":
      return `${where}${progress.message ?? ""}`;
    case "queued":
    case "complete":
      return "";
  }
}

function Empty() {
  return (
    <div className="p-3 text-xs">
      <div className="max-w-md rounded border border-dashed border-border px-4 py-5">
        <p className="font-medium">No analyses in this organization yet.</p>
        <p className="mt-1 text-muted">
          Paste a public repository URL above. Whatever anyone here maps shows up
          in this list for the whole team.
        </p>
      </div>
    </div>
  );
}
