import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MapWorkspace } from "@/app/_components/map-workspace";
import { NO_AGENT } from "@/lib/agent/server";
import { tracing } from "@/lib/ai/client";
import { getAnalysis, getStoredMap } from "@/lib/analyses/read";

export const metadata: Metadata = { title: "Map" };

// A run started from this page parses inside the same function, after the
// response (after() counts toward the limit). 300 seconds is the Hobby cap;
// the archive size limit is set so a parse fits inside it. A run cut off here
// shows as stale once its ten minutes pass.
export const maxDuration = 300;

/** Renders the stored map, redirecting to progress when no result is available. */
export default async function AnalysisMapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Read as the user: another organization's analysis is absent, not forbidden.
  const analysis = await getAnalysis(id);
  if (!analysis) notFound();

  const map = await getStoredMap(analysis.id);
  // Nothing stored yet: the pipeline page is the only thing to show.
  if (!map) redirect(`/analyses/${analysis.id}`);

  const repo = {
    name: `${map.repoOwner}/${map.repoName}`,
    adapter: map.adapter,
    coverage: { parsed: map.coverage.files.parsed, skipped: map.coverage.files.skipped },
    routes: { found: map.routes.length, withheld: map.withheldRoutes.length },
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
        <Link href="/analyses" className="text-muted hover:text-foreground">
          Analyses
        </Link>
        <span className="text-muted">/</span>
        <h1 className="truncate font-mono">
          <span className="text-muted">{map.repoOwner}/</span>
          {map.repoName}
        </h1>
        <span className="font-mono text-muted">{map.commitSha.slice(0, 7)}</span>
        <span className="text-muted">
          <span className="tabular-nums text-foreground">{map.files.length}</span> files ·{" "}
          <span className="tabular-nums text-foreground">{map.edges.length}</span> edges
        </span>
        <Link href={`/analyses/${analysis.id}`} className="ml-auto text-muted hover:text-foreground">
          Pipeline
          {/* A re-run in progress or failed doesn't touch this map; say so. */}
          {map.status !== "complete" && <span className="ml-1">({map.status})</span>}
        </Link>
      </div>
      <MapWorkspace
        analysisId={analysis.id}
        askUnavailable={process.env.AGENT_URL?.trim() ? null : NO_AGENT}
        tracing={tracing}
        title="Categories"
        repo={repo}
        files={map.files}
        edges={map.edges}
        routes={map.routes}
        withheldRoutes={map.withheldRoutes}
      />
    </section>
  );
}
