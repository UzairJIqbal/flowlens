import { Client } from "langsmith";
import { wrapOpenAI } from "langsmith/wrappers/openai";
import OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionFunctionTool,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { env } from "../env.ts";

// The one place in the codebase that constructs a model client. Anything that
// builds its own skips tracing without saying so, so nothing else may.
//
// Gemini, through its OpenAI-compatible endpoint: one SDK, and LangSmith's
// OpenAI wrapper records tokens for every call made through it.

/**
 * Pinned exactly: a stable name, not the moving `gemini-flash-lite-latest`
 * alias. It is part of every cache key, so re-pinning misses only this model's
 * cached answers.
 *
 * Flash-Lite because this runs on the free tier. Full Flash allows about 20
 * requests a day there, fewer than one eval run makes; Flash-Lite allows
 * hundreds.
 */
export const MODEL = "gemini-3.5-flash-lite";

/**
 * How many times a call refused for the per-minute limit waits and tries
 * again. Each wait is as long as Google says; a few cover a burst of
 * concurrent calls queuing behind one another.
 */
const RATE_RETRIES = 4;

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
  const response = await withinRateLimit(() =>
    openai.chat.completions.create({
      model: MODEL,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(schema && { response_format: { type: "json_schema", json_schema: { ...schema, strict: true } } }),
    }),
  );
  const choice = response.choices[0];
  if (choice === undefined) throw new Error("The model returned no answer");
  if (choice.finish_reason !== "stop") throw new Error(`The model stopped early (${choice.finish_reason})`);
  const content = choice.message.content?.trim();
  if (!content) throw new Error("The model returned an empty answer");
  return content;
}

/** A tool call as the model made it, with whatever else the endpoint attached to it. */
type SignedToolCall = ChatCompletionMessageFunctionToolCall & { extra_content?: unknown };

/** One model round that could ask for lookups. */
export interface ToolRound {
  /** The round as it goes back to the model in the next one, tool calls' signatures included. */
  message: ChatCompletionAssistantMessageParam;
  calls: ChatCompletionMessageFunctionToolCall[];
}

/** A per-minute refusal that couldn't be waited out before the caller's deadline. */
export class QuotaBusy extends Error {
  constructor() {
    super("The AI quota is busy. Try again in a minute.");
  }
}

/**
 * One streamed model call that may ask for tools. Text is handed to `onText`
 * as it's written; the calls come back whole once the round ends.
 *
 * Nothing is waited for past `deadline`: a per-minute refusal that would
 * outlast it is QuotaBusy, and a stream still going at the deadline is
 * aborted.
 */
export async function streamRound(
  request: { messages: ChatCompletionMessageParam[]; tools: ChatCompletionFunctionTool[]; deadline: number; signal?: AbortSignal },
  onText: (delta: string) => void,
): Promise<ToolRound> {
  const { messages, tools, deadline } = request;
  const signal = AbortSignal.any([
    AbortSignal.timeout(Math.max(0, deadline - Date.now())),
    ...(request.signal ? [request.signal] : []),
  ]);
  const stream = await withinRateLimit(
    () => openai.chat.completions.create({ model: MODEL, reasoning_effort: "low", messages, tools, stream: true }, { signal }),
    deadline,
  );

  let text = "";
  let finish: string | null = null;
  const calls: SignedToolCall[] = [];
  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (choice === undefined) continue;
    if (choice.delta.content) {
      text += choice.delta.content;
      onText(choice.delta.content);
    }
    for (const part of choice.delta.tool_calls ?? []) {
      // OpenAI streams a call in pieces under one index. Gemini sends each
      // call whole, in one piece, with no index at all.
      const at = typeof part.index === "number" ? part.index : calls.length;
      const call = (calls[at] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
      // Gemini signs each tool call and refuses the next round unless the
      // signature comes back with it.
      if ("extra_content" in part) call.extra_content = part.extra_content;
    }
    finish = choice.finish_reason ?? finish;
  }
  // Gemini reports "stop" even when it asked for tools, so the calls decide
  // whether the round asked for lookups, not the finish reason.
  if (finish === "length") throw new Error("The model stopped early (length)");
  if (calls.length === 0 && text.trim() === "") throw new Error("The model returned an empty answer");
  return {
    message: { role: "assistant", content: text === "" ? null : text, ...(calls.length > 0 && { tool_calls: calls }) },
    calls,
  };
}

/**
 * The free tier refuses calls past a few a minute, saying how long to wait.
 * Waiting that long and trying again beats failing work the next minute would
 * take. A spent daily quota isn't waited out: it says so instead. Nor is a
 * wait that would run past the caller's deadline. Every refused attempt stays
 * in the trace as an errored model call.
 */
async function withinRateLimit<T>(call: () => Promise<T>, deadline = Infinity): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof OpenAI.APIError) || error.status !== 429) throw error;
      // Google's quota details arrive in the error body, not in headers.
      const body = `${error.message} ${JSON.stringify(error.error ?? null)}`;
      if (/PerDay/.test(body)) {
        throw new Error(`The free daily quota for ${MODEL} is spent. It resets at midnight Pacific time.`);
      }
      if (attempt === RATE_RETRIES) throw error;
      const delay = /retryDelay\W+(\d+(?:\.\d+)?)s/.exec(body);
      const wait = delay ? Number(delay[1]) * 1000 + 1000 : 60_000;
      if (Date.now() + wait > deadline) throw new QuotaBusy();
      // Said out loud: a silent minute-long wait looks exactly like a hang.
      console.warn(`${MODEL} per-minute limit reached; waiting ${Math.round(wait / 1000)}s (retry ${attempt + 1}/${RATE_RETRIES})`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/**
 * Traces are sent in the background. A long-running server sends them
 * eventually; a script has to wait for them before it exits.
 */
export async function flushTraces(): Promise<void> {
  await langsmith?.awaitPendingTraceBatches();
}

/**
 * The tracing client, for the evals. They refuse to run untraced: an
 * experiment nobody can open in the dashboard is a number with nothing behind
 * it.
 */
export function evalClient(): { client: Client; project: string } {
  if (!tracing.enabled || !langsmith) {
    throw new Error(`Evals need LangSmith, and tracing is off${tracing.enabled ? "" : `: ${tracing.reason}`}`);
  }
  return { client: langsmith, project: tracing.project };
}

let projectId: Promise<string> | undefined;

/**
 * Scores a traced run, so the score sits on the run in the dashboard. Nothing
 * to score when tracing is off. A failure to record is logged, not thrown:
 * the answer it scores has already been given.
 */
export async function recordFeedback(runId: string, feedback: { key: string; score: number; comment: string }) {
  if (!langsmith || !tracing.enabled) return;
  try {
    projectId ??= langsmith.readProject({ projectName: tracing.project }).then((p) => p.id);
    // "model" is LangSmith's name for an automated evaluator, which this is; no model is involved.
    await langsmith.createFeedback({ runId, sessionId: await projectId, ...feedback, feedbackSourceType: "model" });
  } catch (error) {
    projectId = undefined;
    console.error(`Could not record ${feedback.key} on run ${runId}:`, error instanceof Error ? error.message : error);
  }
}
