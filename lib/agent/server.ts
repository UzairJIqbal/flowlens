import { isRecord } from "./ask.ts";

// The agent server's API, as both the ask route and the answer check call it.
// One copy, so the answer check measures the run the Ask panel gets: the same
// assistant, the same input shape, the same run context. Plain fetch, no Next.

export const ASSISTANT = "cartograph-agent";

/**
 * What the Ask panel and the ask route say when AGENT_URL isn't set. The live
 * site runs that way on purpose: the agent is its own service, and LangSmith
 * hosts it only on a paid plan. It runs locally instead.
 */
export const NO_AGENT =
  "Asking isn't available on this deployment. The agent runs as its own service, which has no free host, so it only runs locally. The README says how.";

/** The agent answered, but not with a stream: it refused the run. */
export class AgentRefused extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`The agent refused the run (HTTP ${status})`);
    this.status = status;
  }
}

/** A new conversation, with metadata stored on it for whoever reads it back. */
export async function openThread(agentUrl: string, metadata: Record<string, string>): Promise<string> {
  const res = await fetch(`${agentUrl}/threads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ metadata }),
  });
  const body: unknown = await res.json();
  if (!res.ok || !isRecord(body) || typeof body.thread_id !== "string") {
    throw new Error(`Could not open a thread (HTTP ${res.status})`);
  }
  return body.thread_id;
}

export interface Run {
  message: string;
  /** Travels as run context, never in a message: the model can't see it. */
  credential: string;
  /** Recorded on the run's trace. */
  metadata?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * One turn on a thread, as the agent's server-sent event stream. A network
 * failure is thrown as fetch throws it; a refusal as AgentRefused.
 */
export async function startRun(agentUrl: string, threadId: string, run: Run): Promise<ReadableStream<Uint8Array>> {
  const upstream = await fetch(`${agentUrl}/threads/${threadId}/runs/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      assistant_id: ASSISTANT,
      input: { messages: [{ role: "user", content: run.message }] },
      context: { credential: run.credential },
      metadata: run.metadata,
      stream_mode: ["updates", "messages-tuple"],
      // Closing the panel or the tab stops the run, rather than leaving it
      // spending model calls on an answer nobody will read.
      on_disconnect: "cancel",
    }),
    signal: run.signal,
  });
  if (!upstream.ok || !upstream.body) throw new AgentRefused(upstream.status);
  return upstream.body;
}
