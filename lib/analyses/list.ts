import { createSupabaseClient } from "@/lib/supabase/server";
import type { Enums } from "@/lib/supabase/database.types";

export type AnalysisStatus = Enums<"analysis_status">;

export type AnalysisSummary = {
  id: string;
  repoOwner: string;
  repoName: string;
  status: AnalysisStatus;
  error: string | null;
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
      "id, status, error, created_at, project:projects!inner(repo_owner, repo_name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Could not load analyses: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    repoOwner: row.project.repo_owner,
    repoName: row.project.repo_name,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
  }));
}
