import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { MapSource } from "@/lib/agent/lookups";
import { storedCoverage } from "./map";
import { isStale } from "@/lib/pipeline/stale";
import { rowProgress, type Progress } from "./progress";

export type { AnalysisStatus } from "./progress";

export type AnalysisSummary = {
  id: string;
  repoOwner: string;
  repoName: string;
  progress: Progress;
  stale: boolean;
  createdAt: string;
};

// No organization filter here, on purpose. Which rows come back is decided by
// the policy reading the organization claim off the token the client carries,
// so switching organization changes the result of this same query.
export async function listAnalyses(): Promise<AnalysisSummary[]> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("analyses")
    .select(
      "id, status, stage, stage_message, error, started_at, created_at, project:projects!inner(repo_owner, repo_name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Could not load analyses: ${error.message}`);

  const now = Date.now();
  return data.map((row) => ({
    id: row.id,
    repoOwner: row.project.repo_owner,
    repoName: row.project.repo_name,
    progress: rowProgress(row),
    stale: isStale(row.status, row.started_at, row.created_at, now),
    createdAt: row.created_at,
  }));
}

/**
 * Every analysis with a stored map, as whoever the client reads as. Same rule
 * as above: the policy picks the organization, so a key and a member see the
 * same rows for the same organization.
 */
export async function listMaps(supabase: SupabaseClient<Database>): Promise<(MapSource & { id: string })[]> {
  const { data, error } = await supabase
    .from("analyses")
    .select("id, status, commit_sha, finished_at, coverage, project:projects!inner(repo_owner, repo_name)")
    .not("commit_sha", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Could not load analyses: ${error.message}`);

  return data.flatMap((row) =>
    // Filtered above; the type just can't see it.
    row.commit_sha === null
      ? []
      : [
          {
            id: row.id,
            repoOwner: row.project.repo_owner,
            repoName: row.project.repo_name,
            commitSha: row.commit_sha,
            status: row.status,
            finishedAt: row.finished_at,
            coverage: storedCoverage(row.coverage),
          },
        ],
  );
}
