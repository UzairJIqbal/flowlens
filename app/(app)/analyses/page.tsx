import { listAnalyses } from "@/lib/analyses/list";
import { AnalysisList } from "./analysis-list";
import { SubmitForm } from "./submit-form";

/** Loads visible analyses and renders the dashboard with its repository submission form. */
export default async function DashboardPage({ searchParams }: PageProps<"/analyses">) {
  const [analyses, { url }] = await Promise.all([listAnalyses(), searchParams]);

  return (
    <>
      {/* A URL here was pasted into the landing page before signing in. */}
      <SubmitForm handoff={typeof url === "string" ? url : undefined} />
      <AnalysisList analyses={analyses} />
    </>
  );
}
