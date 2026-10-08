import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

// The agent's lookups read with the publishable key and nothing else. The
// credential rides along as a header the database checks itself, and the
// policies admit only the analysis it names; an absent, forged or expired one
// reads as nothing at all. No secret key is anywhere on this path.
export function createCredentialedClient(credential: string) {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { "x-agent-credential": credential } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
