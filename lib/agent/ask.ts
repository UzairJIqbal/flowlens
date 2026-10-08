// What the ask entry point relays to the browser, and how it reads the agent's
// stream to get there. Pure: no Next, no React, no database.
//
// The agent server streams LangGraph server-sent events. Of those, three
// things matter to someone watching: a tool call the moment the model makes
// it, its result the moment the lookup returns, and the answer's text as it's
// written. Everything else (middleware steps, run metadata, thought
// signatures) is dropped here, so the browser never parses LangGraph's shapes.

/** One line of the relayed stream, in the order it happened. */
export type AskEvent =
  | { type: "thread"; id: string }
  | { type: "call"; id: string; name: string; args: Record<string, unknown> }
  /** `note` says what came back, in a few words, when the shape is known. */
  | { type: "result"; id: string; found: boolean; note: string | null }
  | { type: "text"; delta: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface SseMessage {
  event: string;
  data: string;
}

/** Splits a server-sent event stream into its messages as they arrive. */
export async function* readSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const message = parseBlock(block);
        if (message) yield message;
      }
    }
    const last = parseBlock(buffer);
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): SseMessage | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length === 0 ? null : { event, data: data.join("\n") };
}

/** The relay's events for one server-sent message; most messages have none. */
export function translate({ event, data }: SseMessage): AskEvent[] {
  let body: unknown;
  try {
    body = JSON.parse(data);
  } catch {
    return [];
  }

  if (event === "error") {
    const message = isRecord(body) && typeof body.message === "string" ? body.message : "The agent failed";
    return [{ type: "error", message }];
  }

  // The model's turn as a whole, once it's finished: its tool calls are
  // complete here, and come before the tools run.
  if (event === "updates" && isRecord(body)) {
    const out: AskEvent[] = [];
    for (const [node, update] of Object.entries(body)) {
      if (!isRecord(update) || !Array.isArray(update.messages)) continue;
      for (const m of update.messages) {
        if (!isRecord(m)) continue;
        if (node === "model_request" && Array.isArray(m.tool_calls)) {
          for (const c of m.tool_calls) {
            if (isRecord(c) && typeof c.id === "string" && typeof c.name === "string") {
              out.push({ type: "call", id: c.id, name: c.name, args: isRecord(c.args) ? c.args : {} });
            }
          }
        }
        if (node === "tools" && typeof m.tool_call_id === "string") {
          const name = typeof m.name === "string" ? m.name : "";
          out.push({ type: "result", id: m.tool_call_id, ...describeResult(name, m.status, textOf(m.content)) });
        }
      }
    }
    return out;
  }

  // Token by token. Only the agent's own model's text: a tool's output is
  // streamed here too, and is a result, not part of the answer.
  if (event === "messages" && Array.isArray(body)) {
    const [chunk, meta] = body;
    if (!isRecord(chunk) || !isRecord(meta) || meta.langgraph_node !== "model_request") return [];
    if (chunk.type !== "ai" && chunk.type !== "AIMessageChunk") return [];
    const delta = textOf(chunk.content);
    return delta === "" ? [] : [{ type: "text", delta }];
  }

  return [];
}

/** A message's text: a plain string, or the text blocks of a list of blocks. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (isRecord(b) && b.type === "text" && typeof b.text === "string" ? b.text : "")).join("");
}

/**
 * What a lookup returned, in a few words, from the surface's own response.
 * The counts are the lookups' own totals, not a recount of what was listed.
 */
export function describeResult(name: string, status: unknown, content: string): { found: boolean; note: string | null } {
  if (status === "error") return { found: false, note: "failed" };
  // The surface's 400 and 404, as the agent's lookup hands them to the model.
  if (content.startsWith("Not found:")) return { found: false, note: "not found" };
  let body: unknown;
  try {
    body = JSON.parse(content);
  } catch {
    return { found: true, note: null };
  }
  if (!isRecord(body)) return { found: true, note: null };

  switch (name) {
    case "analysis_summary":
      return { found: true, note: isRecord(body.files) && typeof body.files.parsed === "number" ? count(body.files.parsed, "file") : null };
    case "find_files":
    case "files_by_role":
    case "walk_graph":
      return { found: true, note: typeof body.total === "number" ? count(body.total, "file") : null };
    case "file_neighbours":
      return {
        found: true,
        note:
          Array.isArray(body.imports) && Array.isArray(body.importedBy)
            ? `imports ${body.imports.length} · imported by ${body.importedBy.length}`
            : null,
      };
    case "route_table":
      return { found: true, note: Array.isArray(body.routes) ? count(body.routes.length, "route") : null };
    default:
      return { found: true, note: null };
  }
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
