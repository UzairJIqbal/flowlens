"use server";

import { sessionCache } from "@/lib/ai/cache";
import { MODEL } from "@/lib/ai/client";
import { explainChange as explainChangeFrom, type ChangeFacts } from "@/lib/ai/explain";
import type { Explained } from "@/lib/analyses/explain";
import { createSupabaseClient } from "@/lib/supabase/server";
import { spend } from "@/lib/usage";
import { frameworkOf } from "@/lib/taxonomy";
import { combine } from "./combine";
import { getStoredPreview, type StoredPreview } from "./read";

/**
 * Past this many entries a list is cut, and the model is told how many were
 * left out. Enough for a pull request someone reads in one sitting.
 */
const LIST_LIMIT = 60;

/**
 * Explains a preview's change from the diff the map draws. Everything the
 * model is handed is computed here, as the user, from the two stored parses;
 * nothing comes from the browser but which preview.
 */
export async function explainChange(previewId: string): Promise<Explained> {
  try {
    const stored = await getStoredPreview(previewId);
    if (!stored) throw new Error("This preview has no stored result to explain");
    const supabase = await createSupabaseClient();
    const { output, cached } = await explainChangeFrom(changeFacts(stored), sessionCache(supabase, stored.organizationId, () => spend("explain")));
    return { ok: true, text: output, cached, model: MODEL };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function changeFacts(stored: StoredPreview): ChangeFacts {
  const change = combine(stored.base, stored.head, stored.changed);
  const cut = <T,>(list: readonly T[]) => ({ shown: list.slice(0, LIST_LIMIT), omitted: Math.max(list.length - LIST_LIMIT, 0) });
  const changed = cut(stored.changed);
  const added = cut(change.diff.addedEdges);
  const removed = cut(change.diff.removedEdges);
  const affected = cut(change.affected);
  return {
    repository: `${stored.repoOwner}/${stored.repoName}`,
    pullRequest: stored.prNumber,
    base: stored.baseSha,
    head: stored.headSha,
    framework: frameworkOf(stored.head.adapter).label,
    changed: changed.shown.map(({ path, status, previousPath }) => ({ path, status, previousPath })),
    addedImports: added.shown,
    removedImports: removed.shown,
    affected: affected.shown,
    omitted: {
      changed: changed.omitted,
      addedImports: added.omitted,
      removedImports: removed.omitted,
      affected: affected.omitted,
    },
    coverageDiffers: change.gap.differs,
  };
}
