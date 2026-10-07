import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

// Clerk owns the session. Supabase never stores or refreshes one of its own;
// it is handed the Clerk session token on every request, so policies can read
// the organization claim with auth.jwt().
export async function createSupabaseClient() {
  const { getToken } = await auth();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { accessToken: async () => (await getToken()) ?? null },
  );
}
