import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin.ts";
import type { Database } from "../supabase/database.types.ts";
import { getCurrentRunTree, traceable } from "langsmith/traceable";
import { MODEL, traceOptions } from "./client.ts";

export type Task = "explain-file" | "explain-folder" | "classify" | "explain-change";

export interface Cache {
  get(key: string): Promise<string | null>;
  put(key: string, task: Task, output: string): Promise<void>;
}

/**
 * Over everything that decides what the model is handed, the prompt included,
 * plus the pinned model. Source text is represented by its content hash, so a
 * key can be made before the source is fetched.
 */
function cacheKey(task: Task, keyed: unknown): string {
  return createHash("sha256").update(JSON.stringify([task, MODEL, keyed])).digest("hex");
}

/** Reads as the signed-in user, so the policy decides whose answers are visible. */
export function sessionCache(reader: SupabaseClient<Database>, organizationId: string): Cache {
  return {
    async get(key) {
      const { data, error } = await reader.from("model_cache").select("output").eq("key", key).maybeSingle();
      if (error) throw new Error(`Could not read the cache: ${error.message}`);
      return data?.output ?? null;
    },
    put: (key, task, output) => write(organizationId, key, task, output),
  };
}

/**
 * For the pipeline, which has no user to apply a policy to. It writes with the
 * secret key already, and filters to the run's organization itself.
 */
export function pipelineCache(organizationId: string): Cache {
  const db = createAdminClient();
  return {
    async get(key) {
      const { data, error } = await db
        .from("model_cache")
        .select("output")
        .eq("organization_id", organizationId)
        .eq("key", key)
        .maybeSingle();
      if (error) throw new Error(`Could not read the cache: ${error.message}`);
      return data?.output ?? null;
    },
    put: (key, task, output) => write(organizationId, key, task, output),
  };
}

// Only the server writes, with the secret key; the table has no write policy.
async function write(organizationId: string, key: string, task: Task, output: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("model_cache")
    .upsert(
      { organization_id: organizationId, key, task, model: MODEL, output },
      { onConflict: "organization_id,key", ignoreDuplicates: true },
    );
  // Loud rather than skipped: a cache that silently stops filling looks like one that works.
  if (error) throw new Error(`Could not write the cache: ${error.message}`);
}

export interface Answer {
  output: string;
  cached: boolean;
  /** The traced run that produced it, for scoring it afterwards. */
  runId: string | null;
}

/**
 * The cache read happens inside the traced run, not before it, so a hit is a
 * recorded run with no model call in it. Without that, a working cache and a
 * broken one look the same in the traces.
 *
 * `ask` runs only on a miss, and must produce what `keyed` describes. It may
 * throw to refuse an answer, which is then not cached.
 */
export function cached<I>(
  task: Task,
  cache: Cache,
  keyed: unknown,
  input: I,
  ask: (input: I) => Promise<string>,
): Promise<Answer> {
  const key = cacheKey(task, keyed);
  const read = traceable((k: string) => cache.get(k), traceOptions("cache read", { runType: "tool" }));
  // The argument is only what the trace records as the run's input. Typed
  // `unknown` because traceable's types can't be resolved over a generic one.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- recorded, not read
  const run = traceable(async (recorded: unknown): Promise<Omit<Answer, "runId">> => {
    runId = getCurrentRunTree(true)?.id ?? null;
    const hit = await read(key);
    if (hit !== null) return { output: hit, cached: true };
    const output = await ask(input);
    await cache.put(key, task, output);
    return { output, cached: false };
  }, traceOptions(task, { metadata: { model: MODEL, cache_key: key } }));
  // Kept out of the run's output, so the trace records the answer alone.
  let runId: string | null = null;
  return run(input).then((answer) => ({ ...answer, runId }));
}
