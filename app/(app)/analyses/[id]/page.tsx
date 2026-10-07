import { notFound } from "next/navigation";
import { rerunAnalysis } from "@/lib/analyses/actions";
import { getAnalysis } from "@/lib/analyses/read";
import { ProgressView } from "./progress-view";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Read as the user: another organization's analysis is absent, not forbidden.
  const analysis = await getAnalysis(id);
  if (!analysis) notFound();

  return <ProgressView analysis={analysis} rerun={rerunAnalysis.bind(null, analysis.id)} />;
}
