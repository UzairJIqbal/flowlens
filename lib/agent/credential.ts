import { createSupabaseClient } from "@/lib/supabase/server";
import { createCredentialedClient } from "@/lib/supabase/agent";
import { readStoredMap, type StoredMap } from "@/lib/analyses/map";

/**
 * A credential naming one analysis and its organization, good for five
 * minutes. Minted by the database as the signed-in user: the analyses policy
 * decides whether they may have one, and the signing key never leaves it.
 * Null when the analysis isn't in their organization.
 */
export async function mintAgentCredential(analysisId: string): Promise<string | null> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.rpc("mint_agent_credential", { p_analysis: analysisId });
  // P0002 is the database saying the policy didn't return the analysis.
  if (error?.code === "P0002") return null;
  if (error) throw new Error(`Could not mint a credential: ${error.message}`);
  return data;
}

export type CredentialedMap = { kind: "map"; map: StoredMap } | { kind: "denied" } | { kind: "empty" };

/**
 * The stored graph of whichever analysis the credential names. The agent
 * never says which one it wants, and this never asks: the policy returns the
 * one row the credential admits, or none when it's absent, forged or expired.
 */
export async function readCredentialedMap(credential: string): Promise<CredentialedMap> {
  const supabase = createCredentialedClient(credential);
  const { data, error } = await supabase.from("analyses").select("id").limit(2);
  if (error) throw new Error(`Could not check the credential: ${error.message}`);
  if (data.length === 0) return { kind: "denied" };
  // A credential that admits two analyses means the policy is wrong, and
  // answering from either would be answering about the wrong repository.
  if (data.length > 1) throw new Error("A credential admitted more than one analysis");

  const map = await readStoredMap(supabase, data[0].id);
  return map ? { kind: "map", map } : { kind: "empty" };
}
