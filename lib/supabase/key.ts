import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

// A coding agent's reads, with the publishable key and nothing else. The
// access key rides along as a header; the database hashes it, finds its
// organization, and the members' policies take it from there. An unknown or
// revoked key reads as no organization, so as nothing.
export function createKeyedClient(key: string) {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { "x-flowlens-key": key } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
