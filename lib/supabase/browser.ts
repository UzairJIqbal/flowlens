import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * The browser's Supabase client, only ever used for realtime. It carries the
 * Clerk session token exactly as the server client does, so joining a private
 * channel is checked against the same organization claim as reading a row. A
 * bare client would join as anon and every channel would refuse it.
 */
export function createBrowserSupabaseClient(accessToken: () => Promise<string | null>) {
  // Spelled out in full: Next only inlines NEXT_PUBLIC_ values it can see.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set");
  }
  return createClient<Database>(url, key, { accessToken });
}
