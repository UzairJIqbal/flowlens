import { createClient } from "@supabase/supabase-js";
import { env } from "../env.ts";
import type { Database } from "./database.types.ts";

// The pipeline's writer, and nothing else's. A run outlives the Clerk session
// token it started under, so it can't write as the user; it writes with the
// secret key instead, which bypasses row-level security. That makes whoever
// calls the pipeline responsible for having checked, through the user's own
// client, that the user may act on the analysis. Reads for the interface never
// go through here.
export function createAdminClient() {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
