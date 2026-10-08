"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { isPullRequestUrl } from "@/lib/pipeline/github";
import { claimPreview, executePreview, submitPreview } from "@/lib/pipeline/preview";
import { claimRun, executeRun, submitRepository } from "@/lib/pipeline/run";
import { STALE_AFTER_MINUTES } from "@/lib/pipeline/stale";
import { getAnalysis } from "./read";
import type { Progress } from "./progress";

export type ActionState = { error: string } | null;
export type SubmitState = { error: string; url: string } | null;

/**
 * The dashboard form. A repository already in this organization isn't run
 * again; the user is taken to the analysis that exists. Only a new one starts.
 * A pull request URL goes to its preview instead, under the same rule.
 */
export async function submitAnalysis(_: SubmitState, form: FormData): Promise<SubmitState> {
  const entry = form.get("url");
  const url = typeof entry === "string" ? entry.trim() : "";
  if (url === "") return { error: "Paste a GitHub repository or pull request URL.", url };

  // From the verified session, never from the form.
  const { orgId } = await auth();
  if (!orgId) return { error: "No organization is active. Pick one from the switcher.", url };

  let destination: string;
  try {
    if (isPullRequestUrl(url)) {
      const { previewId, status } = await submitPreview(orgId, url);
      destination = `/previews/${previewId}`;
      if (status === "complete") {
        destination += "/map";
      } else if (status !== "parsing") {
        // New, or an earlier attempt failed: pasting it again is asking again.
        const run = await claimPreview(previewId);
        if (run) after(() => executePreview(run));
      }
    } else {
      const submitted = await submitRepository(orgId, url);
      const { analysisId } = submitted;
      destination = `/analyses/${analysisId}`;
      if (!submitted.created) {
        // Already analysed: its map if one is stored, otherwise its pipeline.
        if ((await getAnalysis(analysisId))?.commitSha) destination += "/map";
      } else {
        // Claimed before responding, so the progress page opens on a running
        // row rather than a queued one it would have to wait on.
        const run = await claimRun(analysisId);
        if (!run) throw new Error("The analysis was created but could not be started. Re-run it from its page.");
        after(() => executeRun(run));
      }
    }
  } catch (error) {
    return { error: reason(error), url };
  }

  // Outside the try: redirect works by throwing.
  redirect(destination);
}

/** The deliberate re-run, from the analysis page. */
export async function rerunAnalysis(analysisId: string): Promise<ActionState> {
  try {
    // The run writes with the secret key and can't tell who asked. Reading the
    // row as the user first is what decides they may: the policy returns it
    // or it doesn't.
    if (!(await getAnalysis(analysisId))) return { error: "This analysis isn't in your organization." };

    const run = await claimRun(analysisId);
    if (!run) {
      return {
        error: `Already running. It can be started again once it finishes, or after ${STALE_AFTER_MINUTES} minutes without finishing.`,
      };
    }
    after(() => executeRun(run));
    return null;
  } catch (error) {
    return { error: reason(error) };
  }
}

/**
 * One read, made when a live channel has just joined, to cover anything
 * published between the page rendering and the socket subscribing.
 */
export async function readProgress(analysisId: string): Promise<Progress | null> {
  return (await getAnalysis(analysisId))?.progress ?? null;
}

/** Converts a caught value into the error message returned by a server action. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
