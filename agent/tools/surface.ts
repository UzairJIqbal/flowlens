import type { ToolRuntime } from "langchain";
import { z } from "zod";

// The agent reaches an analysis only through Flowlens's read-only surface, and
// only with the credential the app minted for this run. The credential arrives
// as run context, never in a message, so the model can't see it, repeat it, or
// be talked into swapping it. Whatever analysis it names is the only one any
// lookup can reach.

export const contextSchema = z.object({ credential: z.string().min(1) });

export type Runtime = ToolRuntime<unknown, typeof contextSchema>;

/**
 * One lookup: `GET {FLOWLENS_URL}/api/agent/{tool}?{params}` with the run's
 * credential as a bearer token, returning the surface's body for the model to
 * read.
 */
export async function lookup(tool: string, params: Record<string, string>, runtime: Runtime): Promise<string> {
  const base = process.env.FLOWLENS_URL;
  if (!base) throw new Error("FLOWLENS_URL is not set");
  const { credential } = runtime.context;
  if (!credential) throw new Error(`${tool}: the run carries no credential`);

  const url = new URL(`/api/agent/${tool}`, base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  // A redirect is never an answer: followed, the app's sign-in redirect hands
  // back a sign-in page, which the model reads as a successful lookup.
  const res = await fetch(url, { headers: { authorization: `Bearer ${credential}` }, redirect: "manual" });
  const body = await res.text();
  if (res.ok && res.headers.get("content-type")?.startsWith("application/json")) return body;

  // A path the analysis doesn't have, or a role it doesn't use, is the model's
  // mistake to correct, so it reads why. Anything else (an expired credential,
  // a redirect, the app down) ends the run, rather than leaving the model to
  // answer around a lookup that never happened.
  if (res.status === 400 || res.status === 404) return `Not found: ${body}`;
  throw new Error(`${tool}: Flowlens answered HTTP ${res.status} ${res.headers.get("content-type") ?? ""}`.trim());
}
