import type { Metadata } from "next";
import { listAnalyses } from "@/lib/analyses/list";
import { listPreviews } from "@/lib/previews/read";
import { AnalysisList } from "./analysis-list";
import { SubmitForm } from "./submit-form";

export const metadata: Metadata = { title: "Analyses" };

// A run started from this page parses inside the same function, after the
// response (after() counts toward the limit). 300 seconds is the Hobby cap;
// the archive size limit is set so a parse fits inside it. A run cut off here
// shows as stale once its ten minutes pass.
export const maxDuration = 300;

/** Loads visible analyses and previews and renders the dashboard with its submission form. */
export default async function DashboardPage({ searchParams }: PageProps<"/analyses">) {
  const [analyses, previews, { url }] = await Promise.all([listAnalyses(), listPreviews(), searchParams]);

  return (
    <>
      {/* A URL here was pasted into the landing page before signing in. */}
      <SubmitForm handoff={typeof url === "string" ? url : undefined} />
      {/* No previews is nothing to say: the form already says pull requests are accepted. */}
      {previews.length > 0 && (
        <AnalysisList
          kind="preview"
          title="Pull request previews"
          analyses={previews.map(({ prNumber, prTitle, ...p }) => ({ ...p, pr: { number: prNumber, title: prTitle } }))}
        />
      )}
      <AnalysisList kind="analysis" title="Analyses" analyses={analyses} />
    </>
  );
}
