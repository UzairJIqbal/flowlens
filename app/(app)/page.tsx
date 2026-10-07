import {
  listAnalyses,
  type AnalysisStatus,
  type AnalysisSummary,
} from "@/lib/analyses/list";

// State is told apart by shape first, so it reads in greyscale. Only a failure
// earns colour, because it is the one state someone has to act on.
const STATUS: Record<AnalysisStatus, { glyph: string; className: string }> = {
  queued: { glyph: "○", className: "text-muted" },
  parsing: { glyph: "◐", className: "text-foreground" },
  complete: { glyph: "●", className: "text-foreground" },
  failed: { glyph: "✕", className: "text-danger" },
};

const ORDER: AnalysisStatus[] = ["parsing", "queued", "complete", "failed"];

export default async function DashboardPage() {
  const analyses = await listAnalyses();

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-4 border-b border-border px-3 text-xs">
        <h1 className="font-semibold">
          Analyses
          <span className="ml-1.5 font-normal tabular-nums text-muted">
            {analyses.length}
          </span>
        </h1>
        {analyses.length > 0 && <StateCounts analyses={analyses} />}
      </div>

      {analyses.length === 0 ? <Empty /> : <Table analyses={analyses} />}
    </section>
  );
}

function StateCounts({ analyses }: { analyses: AnalysisSummary[] }) {
  const counts = new Map<AnalysisStatus, number>();
  for (const a of analyses) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);

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
    </ul>
  );
}

function Table({ analyses }: { analyses: AnalysisSummary[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-160 border-collapse text-xs">
        <colgroup>
          <col className="w-[34%]" />
          <col className="w-[12%]" />
          <col className="w-[16%]" />
          <col />
        </colgroup>
        <thead className="sticky top-0 bg-surface text-left text-muted">
          <tr className="border-b border-border">
            <th className="h-7 px-3 font-normal">Repository</th>
            <th className="h-7 px-3 font-normal">State</th>
            <th className="h-7 px-3 font-normal">Started, UTC</th>
            <th className="h-7 px-3 font-normal">Detail</th>
          </tr>
        </thead>
        <tbody>
          {analyses.map((a) => {
            const status = STATUS[a.status];
            const { date, time } = utc(a.createdAt);
            return (
              <tr
                key={a.id}
                className="border-b border-border hover:bg-surface"
              >
                <td className="h-7 truncate px-3 font-mono">
                  <span className="text-muted">{a.repoOwner}/</span>
                  {a.repoName}
                </td>
                <td className={`h-7 px-3 ${status.className}`}>
                  <span className="mr-1.5 inline-block w-3" aria-hidden>
                    {status.glyph}
                  </span>
                  {a.status}
                </td>
                <td className="h-7 px-3 font-mono tabular-nums">
                  <span className="text-muted">{date}</span> {time}
                </td>
                <td className="h-7 truncate px-3 text-muted">
                  {a.error ?? ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Empty() {
  return (
    <div className="p-3 text-xs">
      <div className="max-w-md rounded border border-dashed border-border px-4 py-5">
        <p className="font-medium">No analyses in this organization yet.</p>
        <p className="mt-1 text-muted">
          When anyone here maps a repository, it shows up in this list for the
          whole team.
        </p>
      </div>
    </div>
  );
}

// Absolute rather than "3m ago": a relative time is stale the moment it renders.
function utc(timestamp: string): { date: string; time: string } {
  const iso = new Date(timestamp).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
