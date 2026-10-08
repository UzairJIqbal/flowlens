import { notFound } from "next/navigation";
import { Constants } from "@/lib/supabase/database.types";
import { getPreview } from "@/lib/previews/read";
import { retryPreview } from "@/lib/previews/actions";
import { ProgressView } from "@/app/_components/progress-view";
import { PreviewCrumbs } from "../preview-crumbs";

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
