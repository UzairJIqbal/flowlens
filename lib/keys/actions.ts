"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseClient } from "@/lib/supabase/server";

export type CreateKeyState = { name: string; key: string } | { error: string; name: string } | null;
export type RevokeState = { error: string } | null;

/**
 * Makes a key for the active organization and returns it, the one time it is
 * ever readable. The database makes it and keeps only its hash; the insert
 * policy decides which organization it belongs to.
 */
export async function createAccessKey(_: CreateKeyState, form: FormData): Promise<CreateKeyState> {
  const entry = form.get("name");
  const name = typeof entry === "string" ? entry.trim() : "";
  if (name === "") return { error: "Name the key, e.g. after the machine or agent it's for.", name };
  if (name.length > 60) return { error: "Keep the name to 60 characters.", name };

  // From the verified session, never from the form.
  const { orgId } = await auth();
  if (!orgId) return { error: "No organization is active. Pick one from the switcher.", name };

  try {
    // A key points at its organization's row, which exists only once something
    // has been recorded for it. Clerk owns organizations; this is the same
    // upsert a first analysis makes.
    const org = await createAdminClient().from("organizations").upsert({ id: orgId }, { ignoreDuplicates: true });
    if (org.error) throw new Error(`Could not record the organization: ${org.error.message}`);

    const supabase = await createSupabaseClient();
    const { data, error } = await supabase.rpc("create_access_key", { p_name: name });
    if (error) throw new Error(`Could not create the key: ${error.message}`);
    revalidatePath("/settings");
    return { name, key: data };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), name };
  }
}

/** Revoking is final; the policy refuses to revive a revoked key. */
export async function revokeAccessKey(id: string): Promise<RevokeState> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("access_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) return { error: `Could not revoke the key: ${error.message}` };
  if (data.length === 0) return { error: "That key is already revoked or isn't in this organization." };
  revalidatePath("/settings");
  return null;
}
