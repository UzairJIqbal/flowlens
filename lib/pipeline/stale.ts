import type { Enums } from "../supabase/database.types.ts";

/**
 * Nothing here has a queue or a timeout, so a process that dies mid-run leaves
 * its row unfinished for good. Past this age an unfinished run is treated as
 * abandoned: shown as stale, and allowed to be started again.
 */
export const STALE_AFTER_MINUTES = 10;

// A queued row never started, so its age is counted from when it was created.
export function isStale(
  status: Enums<"analysis_status">,
  startedAt: string | null,
  createdAt: string,
  now: number,
): boolean {
  if (status !== "queued" && status !== "parsing") return false;
  return now - new Date(startedAt ?? createdAt).getTime() > STALE_AFTER_MINUTES * 60_000;
}
