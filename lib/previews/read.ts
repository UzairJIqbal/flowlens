import { createSupabaseClient } from "@/lib/supabase/server";
import { isStale } from "@/lib/pipeline/stale";
import type { ChangedFile } from "@/lib/pipeline/github";
import { rowProgress, type Progress } from "@/lib/analyses/progress";
import { readChanged, readSide, type PreviewSide } from "./side";

// Read as the signed-in user, with no organization filter: which previews come
// back is the policy's decision.

export type PreviewDetail = {
  id: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  prTitle: string;
  baseSha: string;
  headSha: string;
  startedAt: string | null;
  progress: Progress;
  stale: boolean;
};

export type PreviewSummary = Pick<PreviewDetail, "id" | "repoOwner" | "repoName" | "prNumber" | "prTitle" | "progress" | "stale"> & {
  createdAt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS =
  "id, pr_number, pr_title, base_sha, head_sha, status, stage, stage_message, error, started_at, created_at, project:projects!inner(repo_owner, repo_name)";

export async function listPreviews(): Promise<PreviewSummary[]> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("pr_previews")
    .select("id, pr_number, pr_title, status, stage, stage_message, error, started_at, created_at, project:projects!inner(repo_owner, repo_name)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Could not load previews: ${error.message}`);
  const now = Date.now();
  return data.map((row) => ({
    id: row.id,
    repoOwner: row.project.repo_owner,
    repoName: row.project.repo_name,
    prNumber: row.pr_number,
    prTitle: row.pr_title,
    progress: rowProgress(row),
    stale: isStale(row.status, row.started_at, row.created_at, now),
    createdAt: row.created_at,
  }));
}

/** One preview, or null when the policy doesn't return it, which reads the same as not existing. */
export async function getPreview(previewId: string): Promise<PreviewDetail | null> {
  if (!UUID.test(previewId)) return null;
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.from("pr_previews").select(COLUMNS).eq("id", previewId).maybeSingle();
  if (error) throw new Error(`Could not load the preview: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    repoOwner: data.project.repo_owner,
    repoName: data.project.repo_name,
    prNumber: data.pr_number,
    prTitle: data.pr_title,
    baseSha: data.base_sha,
    headSha: data.head_sha,
    startedAt: data.started_at,
    progress: rowProgress(data),
    stale: isStale(data.status, data.started_at, data.created_at, Date.now()),
  };
}

export type StoredPreview = PreviewDetail & {
  /** The row's own organization, which an answer about it is cached under. */
  organizationId: string;
  changed: ChangedFile[];
  base: PreviewSide;
  head: PreviewSide;
};

/** A complete preview with both sides, or null when it isn't visible or isn't complete. */
export async function getStoredPreview(previewId: string): Promise<StoredPreview | null> {
  const detail = await getPreview(previewId);
  if (!detail || detail.progress.status !== "complete") return null;
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.from("pr_previews").select("organization_id, changed, base, head").eq("id", previewId).maybeSingle();
  if (error) throw new Error(`Could not load the preview: ${error.message}`);
  if (!data) return null;
  return {
    ...detail,
    organizationId: data.organization_id,
    changed: readChanged(data.changed), base: readSide(data.base, "base"), head: readSide(data.head, "head") };
}
