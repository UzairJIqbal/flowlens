import { Client } from "langsmith";
import { wrapOpenAI } from "langsmith/wrappers/openai";
import OpenAI from "openai";
import { env } from "../env.ts";

// The one place in the codebase that constructs a model client. Anything that
// builds its own skips tracing without saying so, so nothing else may.
//
// Gemini, through its OpenAI-compatible endpoint: one SDK, and LangSmith's
// OpenAI wrapper records tokens for every call made through it.

/**
 * Pinned exactly. Google's stable name for version 3.6-flash-07-2026, not the
 * moving `gemini-flash-latest` alias. It is part of every cache key, so
 * re-pinning misses only this model's cached answers.
 */
export const MODEL = "gemini-3.6-flash";

export type Tracing = { enabled: true; project: string } | { enabled: false; reason: string };

/**
 * Whether calls are being traced, and if not, why. Shown in the interface: an
 * absent key otherwise looks exactly like a working setup with no traffic.
 * Calls succeed either way.
 */
export const tracing: Tracing = (() => {
  if (process.env.LANGSMITH_TRACING?.trim() !== "true") {
    return { enabled: false, reason: "LANGSMITH_TRACING is not true" };
  }
  if (!process.env.LANGSMITH_API_KEY?.trim()) return { enabled: false, reason: "LANGSMITH_API_KEY is not set" };
  return { enabled: true, project: process.env.LANGSMITH_PROJECT?.trim() || "default" };
})();

// Passed explicitly rather than left to the environment, so what the
// interface reports and what actually happens can't disagree.
const langsmith = tracing.enabled ? new Client() : undefined;
const traceConfig = {
  client: langsmith,
  tracingEnabled: tracing.enabled,
  project_name: tracing.enabled ? tracing.project : undefined,
};

const openai = wrapOpenAI(
  new OpenAI({ apiKey: env.GOOGLE_API_KEY, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" }),
  traceConfig,
);

/**
 * Options for a traced run, with this module's tracing decision in them. Every
 * `traceable` takes these, so a run can't be traced to somewhere the interface
 * doesn't report. A model call made inside the run is recorded as its child.
 */
export function traceOptions(
  name: string,
  options: { runType?: "chain" | "tool"; metadata?: Record<string, string> } = {},
) {
  return { ...traceConfig, name, run_type: options.runType ?? "chain", metadata: options.metadata };
}

export interface Request {
  system: string;
  user: string;
  /** Asks for JSON matching this schema instead of prose. */
  schema?: { name: string; schema: Record<string, unknown> };
}

/** One model call. An answer that was cut off is refused, never shown as though it were whole. */
export async function complete({ system, user, schema }: Request): Promise<string> {
  const response = await openai.chat.completions.create({
    model: MODEL,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...(schema && { response_format: { type: "json_schema", json_schema: { ...schema, strict: true } } }),
  });
  const choice = response.choices[0];
  if (choice === undefined) throw new Error("The model returned no answer");
  if (choice.finish_reason !== "stop") throw new Error(`The model stopped early (${choice.finish_reason})`);
  const content = choice.message.content?.trim();
  if (!content) throw new Error("The model returned an empty answer");
  return content;
}

/**
 * Traces are sent in the background. A long-running server sends them
 * eventually; a script has to wait for them before it exits.
 */
export async function flushTraces(): Promise<void> {
  await langsmith?.awaitPendingTraceBatches();
}
