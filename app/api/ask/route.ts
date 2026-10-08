import { auth } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { isRecord, readSse, translate, type AskEvent } from "@/lib/agent/ask";
import { mintAgentCredential } from "@/lib/agent/credential";
import type { Selection } from "@/lib/map/selection";

// The one way into the agent. It proves the asker may read the analysis by
// having the database mint them a credential for it, opens or continues a
// conversation that belongs to them, and relays the run back as it happens.
//
// The agent is never told which analysis it's reading: the credential travels
// as run context, and every lookup it makes reads whatever that names.
//
// Every failure here is answered, never thrown: with the agent down, this
// route fails and nothing else in the app notices.

const ASSISTANT = "cartograph-agent";
const MAX_MESSAGE = 2000;

/** Who a conversation belongs to, stored on its thread and checked on every turn. */
type Owner = { organization: string; user: string; analysis: string };

type Asked = { analysisId: string; threadId: string | null; message: string; selection: Selection | null };

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) return refuse(401, "Sign in and pick an organization to ask.");

  const asked = parse(await req.json().catch(() => null));
  if (typeof asked === "string") return refuse(400, asked);

  const credential = await mintAgentCredential(asked.analysisId);
  if (credential === null) return refuse(404, "No such analysis in your organization.");

  // Read here rather than with the app's required variables: without it, only
  // asking stops working.
  const agentUrl = process.env.AGENT_URL?.trim();
  if (!agentUrl) return refuse(503, "AGENT_URL is not set, so there is no agent to ask.");

  const owner: Owner = { organization: orgId, user: userId, analysis: asked.analysisId };
  let threadId: string | null;
  try {
    threadId = asked.threadId === null ? await openThread(agentUrl, owner) : await continueThread(agentUrl, asked.threadId, owner);
  } catch {
    return refuse(503, `The agent isn't reachable at ${agentUrl}.`);
  }
  // Not found and not theirs read the same, so a thread id says nothing about whose it is.
  if (threadId === null) return refuse(409, "That conversation no longer exists on the agent. Start a new one.");

  let upstream: Response;
  try {
    upstream = await fetch(`${agentUrl}/threads/${threadId}/runs/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assistant_id: ASSISTANT,
        input: { messages: [{ role: "user", content: withSelection(asked.message, asked.selection) }] },
        context: { credential },
        stream_mode: ["updates", "messages-tuple"],
        // Closing the panel or the tab stops the run, rather than leaving it
        // spending model calls on an answer nobody will read.
        on_disconnect: "cancel",
      }),
      signal: req.signal,
    });
  } catch {
    return refuse(503, `The agent isn't reachable at ${agentUrl}.`);
  }
  if (!upstream.ok || !upstream.body) {
    return refuse(502, `The agent refused the question (HTTP ${upstream.status}).`);
  }

  return new Response(relay(upstream.body, threadId), {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

function refuse(status: number, error: string) {
  return Response.json({ error }, { status });
}

function parse(body: unknown): Asked | string {
  if (!isRecord(body)) return "Expected a JSON body.";
  const { analysisId, threadId, message, selection } = body;
  if (typeof analysisId !== "string" || analysisId === "") return "analysisId is required.";
  if (threadId !== undefined && threadId !== null && typeof threadId !== "string") return "threadId must be a string.";
  if (typeof message !== "string" || message.trim() === "") return "Ask something.";
  if (message.length > MAX_MESSAGE) return `Questions are limited to ${MAX_MESSAGE} characters.`;
  const picked = parseSelection(selection);
  if (picked === undefined) return "selection is malformed.";
  return { analysisId, threadId: threadId ?? null, message: message.trim(), selection: picked };
}

function parseSelection(value: unknown): Selection | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return undefined;
  if (value.kind === "file" && typeof value.path === "string") return { kind: "file", path: value.path };
  if (value.kind === "folder" && typeof value.id === "string") return { kind: "folder", id: value.id };
  return undefined;
}

/**
 * What's selected on the map, said in the message itself, which is how the
 * agent's instructions expect to hear it. It's a hint about what "this" means,
 * not a fact: the agent still looks the path up.
 */
function withSelection(message: string, selection: Selection | null): string {
  if (selection === null) return message;
  const what = selection.kind === "file" ? `the file \`${selection.path}\`` : `the folder \`${selection.id}/\``;
  return `${message}\n\n(Selected on the map: ${what}.)`;
}

async function openThread(agentUrl: string, owner: Owner): Promise<string> {
  const res = await fetch(`${agentUrl}/threads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ metadata: owner }),
  });
  const body: unknown = await res.json();
  if (!res.ok || !isRecord(body) || typeof body.thread_id !== "string") {
    throw new Error(`Could not open a thread (HTTP ${res.status})`);
  }
  return body.thread_id;
}

/** The thread, if it exists and was opened by this person, in this organization, about this analysis. */
async function continueThread(agentUrl: string, threadId: string, owner: Owner): Promise<string | null> {
  const res = await fetch(`${agentUrl}/threads/${encodeURIComponent(threadId)}`);
  if (res.status === 404 || res.status === 422) return null;
  if (!res.ok) throw new Error(`Could not read the thread (HTTP ${res.status})`);
  const body: unknown = await res.json();
  const stored = isRecord(body) ? body.metadata : null;
  if (!isRecord(stored)) return null;
  const theirs =
    stored.organization === owner.organization && stored.user === owner.user && stored.analysis === owner.analysis;
  return theirs ? threadId : null;
}

/** The agent's stream as newline-delimited AskEvents, each sent the moment it's read. */
function relay(upstream: ReadableStream<Uint8Array>, threadId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (e: AskEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      send({ type: "thread", id: threadId });
      let failed = false;
      try {
        for await (const message of readSse(upstream)) {
          for (const e of translate(message)) {
            if (e.type === "error") failed = true;
            send(e);
          }
        }
        if (!failed) send({ type: "done" });
      } catch (err) {
        // The reader closed (the asker left) or the agent dropped the
        // connection mid-answer. The second is worth saying; the first has
        // nobody to say it to, and enqueueing would throw.
        try {
          send({ type: "error", message: `The agent stopped mid-answer: ${err instanceof Error ? err.message : String(err)}` });
        } catch {}
      }
      try {
        controller.close();
      } catch {}
    },
  });
}
