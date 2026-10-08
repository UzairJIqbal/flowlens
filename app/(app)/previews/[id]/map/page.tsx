import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PreviewWorkspace } from "@/app/_components/preview-workspace";
import { tracing } from "@/lib/ai/client";
import { getPreview, getStoredPreview } from "@/lib/previews/read";
import { PreviewCrumbs } from "../../preview-crumbs";

/** The pull request's two parses as one map, or its progress page while they aren't stored. */
export default async function PreviewMapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Read as the user: another organization's preview is absent, not forbidden.
  const preview = await getPreview(id);
  if (!preview) notFound();
  const stored = await getStoredPreview(preview.id);
  if (!stored) redirect(`/previews/${preview.id}`);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
        <Link href="/analyses" className="shrink-0 text-muted hover:text-foreground">
          Analyses
        </Link>
        <span className="text-muted">/</span>
        <PreviewCrumbs {...stored} />
        <span className="shrink-0 font-mono text-muted" title="The merge base, then the pull request's head">
          {stored.baseSha.slice(0, 7)}…{stored.headSha.slice(0, 7)}
        </span>
        <Link href={`/previews/${stored.id}`} className="ml-auto shrink-0 text-muted hover:text-foreground">
          Pipeline
        </Link>
      </div>
      <PreviewWorkspace
        previewId={stored.id}
        tracing={tracing}
        base={stored.base}
        head={stored.head}
        changed={stored.changed}
      />
    </section>
  );
}
