"use server";

import { sessionCache } from "@/lib/ai/cache";
import { MODEL } from "@/lib/ai/client";
import { explainFile as explainFileFrom, explainFolder as explainFolderFrom } from "@/lib/ai/explain";
import { fold } from "@/lib/map/fold";
import { fetchFile, resolveHead } from "@/lib/pipeline/github";
import { createSupabaseClient } from "@/lib/supabase/server";
import { spend } from "@/lib/usage";
import { fileFacts, parsedSource, readAnalysis, readStored, sha256 } from "./stored";

export type Explained = { ok: true; text: string; cached: boolean; model: string } | { ok: false; error: string };

/**
 * Explains one file from its stored neighbours. Everything the model is handed
 * is read here, as the user, from what the parser stored; nothing comes from
 * the browser but which file.
 */
export async function explainFile(analysisId: string, path: string): Promise<Explained> {
  return answer(async () => {
    const supabase = await createSupabaseClient();
    const stored = await readStored(supabase, analysisId);
    const facts = fileFacts(stored, path);
    return explainFileFrom(facts, sessionCache(supabase, stored.organizationId, () => spend("explain")), () =>
      parsedSource(stored.repo, stored.commit, path, facts.file.hash),
    );
  });
}

/** Explains a folded folder: what it holds, and why so much points at it. */
export async function explainFolder(analysisId: string, folder: string): Promise<Explained> {
  return answer(async () => {
    const supabase = await createSupabaseClient();
    const stored = await readStored(supabase, analysisId);
    // The same pure fold the map ran over the same files, so this is the node on screen.
    const node = fold(stored.files).nodes.find((n) => n.id === folder);
    if (!node) throw new Error(`${folder} isn't a folder on this map`);
    const inside = new Set(node.files);
    const byPath = new Map(stored.files.map((f) => [f.path, f]));
    const facts = {
      repository: stored.name,
      commit: stored.commit,
      framework: stored.framework,
      folder,
      files: node.files.map((p) => ({ ...stored.describe(byPath.get(p)!), lines: byPath.get(p)!.lines })),
      incoming: stored.edges.filter((e) => !inside.has(e.from) && inside.has(e.to)),
      outgoing: stored.edges.filter((e) => inside.has(e.from) && !inside.has(e.to)),
      internal: stored.edges.filter((e) => inside.has(e.from) && inside.has(e.to)).length,
    };
    return explainFolderFrom(facts, sessionCache(supabase, stored.organizationId, () => spend("explain")));
  });
}

export type Freshness =
  | { state: "current"; commit: string }
  /** `file` is null for a folder, which is checked only against the commit. */
  | { state: "moved"; commit: string; head: string; file: "changed" | "removed" | "unchanged" | null }
  | { state: "unknown"; reason: string };

/**
 * Whether the repository has moved past the analysed commit, and for a file,
 * whether its content did. Compares the stored hash with the file at the
 * current head.
 */
export async function checkFreshness(analysisId: string, path: string | null): Promise<Freshness> {
  try {
    const supabase = await createSupabaseClient();
    const analysis = await readAnalysis(supabase, analysisId);
    const head = await resolveHead(analysis.repo);
    if (head === analysis.commit) return { state: "current", commit: analysis.commit };
    if (path === null) return { state: "moved", commit: analysis.commit, head, file: null };

    const stored = await supabase
      .from("files")
      .select("hash")
      .eq("analysis_id", analysisId)
      .eq("path", path)
      .maybeSingle();
    if (stored.error) throw new Error(`Could not read the file: ${stored.error.message}`);
    if (!stored.data) throw new Error(`${path} isn't in this analysis`);
    const now = await fetchFile(analysis.repo, head, path);
    const file = now === null ? "removed" : sha256(now) === stored.data.hash ? "unchanged" : "changed";
    return { state: "moved", commit: analysis.commit, head, file };
  } catch (error) {
    return { state: "unknown", reason: reason(error) };
  }
}

async function answer(explain: () => Promise<{ output: string; cached: boolean }>): Promise<Explained> {
  try {
    const { output, cached } = await explain();
    return { ok: true, text: output, cached, model: MODEL };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
