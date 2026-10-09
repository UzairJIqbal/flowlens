import { getCurrentRunTree, traceable } from "langsmith/traceable";
import type { ChatCompletionFunctionTool, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { StoredMap } from "../analyses/map.ts";
import { streamRound, traceOptions } from "../ai/client.ts";
import { describeResult, isRecord, type AskEvent } from "./ask.ts";
import { INSTRUCTIONS } from "./instructions.ts";
import { answerLookup } from "./surface.ts";

// One question, answered inside the request that asked it: the model is
// offered the six lookups and asks for them until it can answer, and every
// lookup is read from the map this request holds. Nothing outlives the
// request; the conversation so far arrives with the question, as text.
//
// No Next, no database. The map, the daily limit and the deadline are the
// caller's, so the answer check runs exactly this against a parse in memory.

/** Model rounds one question may take. A model still asking for lookups after this many is going in circles. */
export const MAX_ROUNDS = 8;

/**
 * An earlier question and the text answered to it, as the browser sends them
 * back. Never a lookup or its result: everything the model reads as looked up
 * was looked up in this request.
 */
export interface Exchange {
  question: string;
  answer: string;
}

/** The most recent exchanges kept; older ones are dropped, not refused. */
const MAX_HISTORY = 6;
const MAX_QUESTION = 2000;
/** An earlier answer longer than this is cut, and says so. */
const MAX_ANSWER = 4000;

/**
 * The conversation so far, from the browser, so it's believed only as text:
 * each entry is a question and the answer's words, and nothing else is read
 * from it. A lookup and its result can't be sent, so nothing the model treats
 * as looked up can come from anywhere but this request.
 */
export function readHistory(value: unknown): Exchange[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: Exchange[] = [];
  for (const entry of value.slice(-MAX_HISTORY)) {
    if (!isRecord(entry) || typeof entry.question !== "string" || typeof entry.answer !== "string") return null;
    const question = entry.question.slice(0, MAX_QUESTION);
    const answer = entry.answer.length > MAX_ANSWER ? `${entry.answer.slice(0, MAX_ANSWER)} [cut]` : entry.answer;
    out.push({ question, answer });
  }
  return out;
}

export interface Question {
  map: StoredMap;
  history: readonly Exchange[];
  message: string;
  /** Counts one model round against the daily limit, before it's asked. Throws to refuse it. */
  spend: () => Promise<void>;
  /** When to stop: no round is started, and no rate limit waited out, past it. */
  deadline: number;
  signal?: AbortSignal;
  metadata?: Record<string, string>;
  emit: (event: AskEvent) => void;
}

export interface Answered {
  /** Everything the model wrote, across rounds. */
  text: string;
  lookups: number;
  /** Null when the question failed; the reason was emitted as an error. */
  rounds: number | null;
  runId: string | null;
}

// The six lookups as the model sees them. Each is answered by the same graph
// functions that draw the canvas, so nothing here computes a relationship: the
// model picks what to ask about, and the parser's edges answer.
const path = {
  type: "string",
  description: "A file path exactly as a previous lookup returned it, e.g. `src/lib/auth.ts`.",
};

function tool(name: string, description: string, properties: Record<string, object> = {}): ChatCompletionFunctionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required: Object.keys(properties) },
    },
  };
}

const TOOLS: ChatCompletionFunctionTool[] = [
  tool(
    "analysis_summary",
    "The whole analysis at a glance: the repository and commit, the framework detected, how many files were parsed and skipped, how many files each role has, how many routes there are, the files imported most, and the files nothing imports. Start here when you don't yet know the repository.",
  ),
  tool(
    "find_files",
    "Files whose path contains some text, matched anywhere in the path and ignoring case. Use it to find where something lives by name, e.g. `auth`, `api/users` or `middleware`.",
    { match: { type: "string", description: "Part of a path." } },
  ),
  tool(
    "files_by_role",
    "Every file with one role, where a role is what the framework's conventions say a file is (a page, an endpoint, a controller…). Use a role exactly as analysis_summary lists it.",
    { role: { type: "string", description: "A role as analysis_summary lists it." } },
  ),
  tool("file_neighbours", "One file's direct imports, both ways: the files it imports and the files that import it.", {
    path,
  }),
  tool(
    "walk_graph",
    "Follow imports from one file, two levels deep, each file listed with how many steps away it is. `dependents` walks to everything that imports it, and what imports those, which is what may break if it changes. `dependencies` walks to everything it needs to work.",
    { path, direction: { type: "string", enum: ["dependents", "dependencies"] } },
  ),
  tool(
    "route_table",
    "Every route the framework's conventions define: method, URL path, and the file and line it comes from, plus the routes that couldn't be fully recovered and why.",
  ),
];

/**
 * Answers one question, emitting each lookup and the answer's text as they
 * happen, then `done`, or `error` with why it stopped. Never throws: a
 * failure is said to the asker, and recorded on the trace.
 */
export async function answer(q: Question): Promise<Answered> {
  const answered: Answered = { text: "", lookups: 0, rounds: null, runId: null };
  // The map and the stream stay out of the trace's inputs: the question and
  // the conversation are what was asked.
  const run = traceable(
    async (asked: { message: string; history: readonly Exchange[] }) => {
      answered.runId = getCurrentRunTree(true)?.id ?? null;
      await rounds(q, asked.message, answered);
      return { answer: answered.text, lookups: answered.lookups, rounds: answered.rounds };
    },
    traceOptions("ask", {
      metadata: {
        ...q.metadata,
        // Said on every trace rather than assumed: an answer depends on the
        // conversation before it, so none is stored or reused.
        answer_cache: "none: answers depend on the conversation",
      },
    }),
  );
  try {
    await run({ message: q.message, history: q.history });
    q.emit({ type: "done" });
  } catch (e) {
    // The asker left: there's nobody to tell.
    if (!q.signal?.aborted) q.emit({ type: "error", message: reason(e, q.deadline) });
  }
  return answered;
}

async function rounds(q: Question, message: string, answered: Answered): Promise<void> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: INSTRUCTIONS },
    ...q.history.flatMap((e): ChatCompletionMessageParam[] => [
      { role: "user", content: e.question },
      { role: "assistant", content: e.answer },
    ]),
    { role: "user", content: message },
  ];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (Date.now() >= q.deadline) throw new OutOfTime();
    await q.spend();
    const turn = await streamRound({ messages, tools: TOOLS, deadline: q.deadline, signal: q.signal }, (delta) => {
      answered.text += delta;
      q.emit({ type: "text", delta });
    });
    messages.push(turn.message);

    if (turn.calls.length === 0) {
      answered.rounds = round;
      // The one answer the instructions forbid. It has been shown as it was
      // written, so it's marked rather than withheld.
      if (answered.lookups === 0) q.emit({ type: "unchecked" });
      return;
    }

    for (const call of turn.calls) {
      const { name } = call.function;
      const args = parseArgs(call.function.arguments);
      // A model's call ids are only unique within its round.
      const id = `${round}:${call.id}`;
      q.emit({ type: "call", id, name, args: args ?? {} });
      const content =
        args === null
          ? `Not found: ${JSON.stringify({ error: "The arguments weren't a JSON object" })}`
          : await lookup(q.map, name, args);
      answered.lookups++;
      q.emit({ type: "result", id, ...describeResult(name, content) });
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  throw new Error(`Stopped after ${MAX_ROUNDS} rounds of lookups without an answer. Try a narrower question.`);
}

/** One lookup, traced as a tool run under the answer, in the words the model reads. */
async function lookup(map: StoredMap, name: string, args: Record<string, unknown>): Promise<string> {
  return traceable(
    (input: Record<string, unknown>) => {
      const { status, body } = answerLookup(map, name, input);
      // A path the analysis doesn't have, or a role it doesn't use, is the
      // model's mistake to correct, so it reads why.
      return status === 200 ? JSON.stringify(body) : `Not found: ${JSON.stringify(body)}`;
    },
    traceOptions(name, { runType: "tool" }),
  )(args);
}

function parseArgs(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text === "" ? "{}" : text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

class OutOfTime extends Error {}

/** Why the answer stopped, in words for the asker. */
function reason(e: unknown, deadline: number): string {
  // The deadline aborts a stream mid-answer, which the SDK reports as an abort.
  if (e instanceof OutOfTime || Date.now() >= deadline) {
    return "Out of time before the answer finished. The AI quota may be busy; try again in a minute.";
  }
  return e instanceof Error ? e.message : String(e);
}
