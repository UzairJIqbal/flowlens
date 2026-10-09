import { createSupabaseClient } from "@/lib/supabase/server";
import { isStale } from "@/lib/pipeline/stale";
import { readStoredMap, type StoredMap } from "./map";
import { rowProgress, type Progress } from "./progress";

export type AnalysisDetail = {
  id: string;
  repoOwner: string;
  repoName: string;
  commitSha: string | null;
  startedAt: string | null;
  progress: Progress;
  stale: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One analysis, read as the signed-in user. Null when the policy doesn't
 * return it, which is the same answer whether it belongs to another
 * organization or doesn't exist.
 */
export async function getAnalysis(analysisId: string): Promise<AnalysisDetail | null> {
  // Anything else would reach Postgres as a cast error rather than "not here".
  if (!UUID.test(analysisId)) return null;

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("analyses")
    .select(
      "id, status, stage, stage_message, error, commit_sha, started_at, created_at, project:projects!inner(repo_owner, repo_name)",
    )
    .eq("id", analysisId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the analysis: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    repoOwner: data.project.repo_owner,
    repoName: data.project.repo_name,
    commitSha: data.commit_sha,
    startedAt: data.started_at,
    progress: rowProgress(data),
    stale: isStale(data.status, data.started_at, data.created_at, Date.now()),
  };
}

/** The stored graph of one analysis, read as the signed-in user. */
export async function getStoredMap(analysisId: string): Promise<StoredMap | null> {
  return readStoredMap(await createSupabaseClient(), analysisId);
}
