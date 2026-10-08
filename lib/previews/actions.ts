"use server";

import { after } from "next/server";
import type { ActionState } from "@/lib/analyses/actions";
import type { Progress } from "@/lib/analyses/progress";
import { claimPreview, executePreview } from "@/lib/pipeline/preview";
import { STALE_AFTER_MINUTES } from "@/lib/pipeline/stale";
import { getPreview } from "./read";

/** Runs a failed or abandoned preview again, from its page. */
export async function retryPreview(previewId: string): Promise<ActionState> {
  try {
    // Read as the user first: the run writes with the secret key and can't
    // tell who asked, so the policy returning the row is the permission.
    if (!(await getPreview(previewId))) return { error: "This preview isn't in your organization." };
    const run = await claimPreview(previewId);
    if (!run) {
      return { error: `Already running or complete. A stuck run can be started again after ${STALE_AFTER_MINUTES} minutes.` };
    }
    after(() => executePreview(run));
    return null;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The catch-up read made when a preview's live channel has just joined. */
export async function readPreviewProgress(previewId: string): Promise<Progress | null> {
  return (await getPreview(previewId))?.progress ?? null;
}
