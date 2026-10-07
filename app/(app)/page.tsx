import { listAnalyses } from "@/lib/analyses/list";
import { AnalysisList } from "./analysis-list";
import { SubmitForm } from "./submit-form";

export default async function DashboardPage() {
  const analyses = await listAnalyses();

  return (
    <>
      <SubmitForm />
      <AnalysisList analyses={analyses} />
    </>
  );
}
