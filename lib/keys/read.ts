import { createSupabaseClient } from "@/lib/supabase/server";

export type AccessKey = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

// No organization filter: the policy returns this organization's keys. The
// hash isn't selectable by members at all, so it can't end up on the page.
export async function listAccessKeys(): Promise<AccessKey[]> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("access_keys")
    .select("id, name, created_at, last_used_at, revoked_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`Could not load access keys: ${error.message}`);

  return data.map((k) => ({
    id: k.id,
    name: k.name,
    createdAt: k.created_at,
    lastUsedAt: k.last_used_at,
    revokedAt: k.revoked_at,
  }));
}
