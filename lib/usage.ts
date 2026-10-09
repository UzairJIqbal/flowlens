import { createSupabaseClient } from "@/lib/supabase/server";

/** The things that can reach the model, each with its own daily ceiling in the database. */
export type Spend = "run" | "explain" | "ask";

const WHAT: Record<Spend, string> = {
  run: "analysis runs",
  explain: "explanations",
  ask: "questions",
};

/**
 * Counts one against the organization's daily ceiling, as the signed-in
 * member, before anything reaches the model. Throws a plain refusal once the
 * ceiling is reached. The count and the ceiling live in the database; which
 * organization is counted comes from the session token, never from here.
 */
export async function spend(kind: Spend): Promise<void> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase.rpc("spend", { p_kind: kind });
  if (error) throw new Error(`Couldn't check today's usage: ${error.message}`);
  // The function returns null when the request may go ahead; the generated type can't say so.
  const ceiling: number | null = data;
  if (ceiling !== null) {
    throw new Error(
      `This organization has used its ${ceiling} ${WHAT[kind]} for today. The limit keeps the free model quota usable for everyone on this site, and it resets at midnight UTC.`,
    );
  }
}
