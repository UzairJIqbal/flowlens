import { listAnalyses } from "@/lib/analyses/list";
import { AnalysisList } from "./analysis-list";
import { SubmitForm } from "./submit-form";

/** Loads visible analyses and renders the dashboard with its repository submission form. */
export default async function DashboardPage() {
  const analyses = await listAnalyses();

  return (
    <>
      <SubmitForm />
      <AnalysisList analyses={analyses} />
    </>
  );
}
