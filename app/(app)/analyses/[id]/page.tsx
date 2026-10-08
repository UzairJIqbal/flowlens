import { notFound } from "next/navigation";
import { rerunAnalysis } from "@/lib/analyses/actions";
import { STAGES } from "@/lib/analyses/progress";
import { getAnalysis } from "@/lib/analyses/read";
import { ProgressView } from "@/app/_components/progress-view";

/** Loads an accessible analysis for the progress page, or returns not found. */
export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Read as the user: another organization's analysis is absent, not forbidden.
  const analysis = await getAnalysis(id);
  if (!analysis) notFound();

  return (
    <ProgressView
      run={{ ...analysis, kind: "analysis", stages: STAGES, mapHref: `/analyses/${analysis.id}/map` }}
      crumbs={
        <h1 className="truncate font-mono">
          <span className="text-muted">{analysis.repoOwner}/</span>
          {analysis.repoName}
        </h1>
      }
      rerun={rerunAnalysis.bind(null, analysis.id)}
      rerunNote="Fetches the latest commit and replaces the stored result."
      rerunsComplete
    />
  );
}
