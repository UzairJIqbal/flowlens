import assert from "node:assert/strict";
import { test } from "node:test";

// cache.ts reaches lib/env.ts through the model client, which refuses to load
// without its variables. Nothing here calls a service, so any value stands in
// for one that's unset, and tracing stays off.
for (const key of [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
  "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "GOOGLE_API_KEY",
  "GH_READ_TOKEN",
]) {
  process.env[key] ||= key === "NEXT_PUBLIC_SUPABASE_URL" ? "http://localhost" : "unused";
}
process.env.LANGSMITH_TRACING = "false";
const { cached } = await import("./cache.ts");
type Cache = import("./cache.ts").Cache;

/** An in-memory cache that counts misses the way the daily limit does. */
function memory(refuse = false) {
  const stored = new Map<string, string>();
  const counts = { spent: 0, asked: 0 };
  const cache: Cache = {
    get: async (key) => stored.get(key) ?? null,
    put: async (key, _task, output) => void stored.set(key, output),
    miss: async () => {
      if (refuse) throw new Error("limit reached");
      counts.spent += 1;
    },
  };
  const ask = async (input: string) => {
    counts.asked += 1;
    return `about ${input}`;
  };
  return { cache, counts, ask, stored };
}

test("a cache hit doesn't count against the daily limit", async () => {
  const { cache, counts, ask } = memory();
  const first = await cached("explain-file", cache, { file: "a.ts" }, "a.ts", ask);
  assert.equal(first.cached, false);
  assert.deepEqual(counts, { spent: 1, asked: 1 });

  const second = await cached("explain-file", cache, { file: "a.ts" }, "a.ts", ask);
  assert.equal(second.cached, true);
  assert.equal(second.output, first.output);
  assert.deepEqual(counts, { spent: 1, asked: 1 });
});

test("a refused miss never reaches the model and caches nothing", async () => {
  const { cache, counts, ask, stored } = memory(true);
  await assert.rejects(cached("explain-file", cache, { file: "a.ts" }, "a.ts", ask), /limit reached/);
  assert.equal(counts.asked, 0);
  assert.equal(stored.size, 0);
});
