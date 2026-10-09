import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Constants } from "@/lib/supabase/database.types";
import { getPreview } from "@/lib/previews/read";
import { retryPreview } from "@/lib/previews/actions";
import { ProgressView } from "@/app/_components/progress-view";
import { PreviewCrumbs } from "../preview-crumbs";

export const metadata: Metadata = { title: "Preview" };

// A run started from this page parses inside the same function, after the
// response (after() counts toward the limit). 300 seconds is the Hobby cap;
// the archive size limit is set so a parse fits inside it. A run cut off here
// shows as stale once its ten minutes pass.
export const maxDuration = 300;

/** Loads an accessible preview for its progress page, or returns not found. */
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const preview = await getPreview(id);
  if (!preview) notFound();

  return (
    <ProgressView
      run={{
        ...preview,
        kind: "preview",
        stages: Constants.public.Enums.preview_stage,
        commitSha: preview.progress.status === "complete" ? preview.headSha : null,
        mapHref: `/previews/${preview.id}/map`,
      }}
      crumbs={<PreviewCrumbs {...preview} />}
      rerun={retryPreview.bind(null, preview.id)}
      rerunNote="Downloads and parses both commits again."
      rerunsComplete={false}
    />
  );
}
