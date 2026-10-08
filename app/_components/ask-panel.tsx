"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { isRecord, type AskEvent } from "@/lib/agent/ask";
import type { Span, Target } from "@/lib/map/prose";
import type { Selection } from "@/lib/map/selection";
import { Prose, Spans } from "./explanation";
import type { MapActions } from "./map-state";

/** A lookup the agent made, and what came back once it has. */
type Call = {
  kind: "call";
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: { found: boolean; note: string | null } | null;
};

/** Steps in the order they happened, so text written between lookups stays between them. */
type Step = Call | { kind: "text"; text: string };

interface Turn {
  question: string;
  /** What was selected when it was asked, and so what the agent was told. */
  selection: Selection | null;
  steps: Step[];
  state: "running" | "done" | "failed";
  error: string | null;
}

/**
 * Questions about the whole repository, answered by the agent from the same
 * stored map the canvas draws. Each lookup appears the moment the agent makes
 * it and is filled in when it returns: a question takes several of them, and
 * fifteen seconds of nothing reads as broken.
 */
export function AskPanel({
  analysisId,
  selection,
  resolve,
  actions,
  hovered,
}: {
  analysisId: string;
  selection: Selection | null;
  resolve: (path: string) => Target | null;
  actions: MapActions;
  hovered: ReadonlySet<string>;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Bumped by "New conversation", so a stream still arriving from the old one
  // can't write into the new one.
  const conversation = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const latest = useRef<HTMLElement>(null);
  const running = turns.at(-1)?.state === "running";

  // A new question is brought to the top once, when it's asked. The answer
  // then grows below it without the pane following along.
  useEffect(() => {
    if (scroller.current && latest.current) scroller.current.scrollTop = latest.current.offsetTop;
  }, [turns.length]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const ask = async () => {
    const question = draft.trim();
    if (question === "" || running) return;
    const mine = conversation.current;
    const controller = new AbortController();
    inFlight.current = controller;
    const update = (change: (t: Turn) => Turn) => {
      if (conversation.current === mine) setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? change(t) : t)));
    };
    const fail = (error: string) => update((t) => ({ ...t, state: "failed", error }));

    setDraft("");
    setTurns((ts) => [...ts, { question, selection, steps: [], state: "running", error: null }]);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ analysisId, threadId, message: question, selection }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body || !res.headers.get("content-type")?.startsWith("application/x-ndjson")) {
        const body: unknown = await res.json().catch(() => null);
        fail(isRecord(body) && typeof body.error === "string" ? body.error : `Asking failed (HTTP ${res.status}).`);
        return;
      }
      let finished = false;
      for await (const event of readEvents(res.body)) {
        if (event.type === "thread") {
          if (conversation.current === mine) setThreadId(event.id);
        } else if (event.type === "done" || event.type === "error") {
          finished = true;
          if (event.type === "done") update((t) => ({ ...t, state: "done" }));
          else fail(event.message);
        } else {
          update((t) => ({ ...t, steps: apply(t.steps, event) }));
        }
      }
      if (!finished) fail("The answer stopped before it finished.");
    } catch {
      if (!controller.signal.aborted) fail("Lost the connection while answering.");
    }
  };

  const reset = () => {
    conversation.current += 1;
    inFlight.current?.abort();
    setTurns([]);
    setThreadId(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask();
    }
  };

  const link = { resolve, actions, hovered };

  return (
    <div className="flex h-full flex-col text-xs">
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
        {turns.length === 0 ? (
          <p className="px-3 py-2.5 leading-relaxed text-muted">
            Ask about this repository: where something lives, what a file imports and what imports it, what may break if
            it changes, and its routes. Every answer is looked up in the parsed map, and each lookup is shown as it runs.
          </p>
        ) : (
          turns.map((t, i) => <TurnView key={i} ref={i === turns.length - 1 ? latest : undefined} turn={t} link={link} />)
        )}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-border p-2">
        <p className="truncate pb-1 text-muted">
          {selection === null ? (
            "Nothing selected on the map"
          ) : (
            <>
              Asking with <span className="font-mono text-[11px] text-foreground">{selectionLabel(selection)}</span> selected
            </>
          )}
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
          rows={3}
          placeholder="Ask about this repository"
          className="block w-full resize-none rounded-sm border border-border bg-background px-2 py-1 text-xs placeholder:text-muted focus:border-muted focus:outline-none disabled:text-muted"
        />
        <div className="flex items-center gap-2 pt-1.5">
          <button
            type="submit"
            disabled={running || draft.trim() === ""}
            className="flex h-6 items-center rounded-sm border border-border px-2 hover:border-muted disabled:text-muted"
          >
            {running ? "Answering…" : "Ask"}
          </button>
          {turns.length > 0 && (
            <button type="button" onClick={reset} className="ml-auto text-muted hover:text-foreground">
              New conversation
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

type Link = { resolve: (path: string) => Target | null; actions: MapActions; hovered: ReadonlySet<string> };

function TurnView({ turn, link, ref }: { turn: Turn; link: Link; ref?: Ref<HTMLElement> }) {
  const stopped = turn.state === "failed";
  return (
    <section ref={ref} className="border-b border-border px-3 py-2.5">
      <p className="whitespace-pre-wrap font-semibold">{turn.question}</p>
      {turn.selection && (
        <p className="truncate text-muted">
          with <span className="font-mono text-[11px]">{selectionLabel(turn.selection)}</span> selected
        </p>
      )}
      {turn.steps.map((s, i) =>
        s.kind === "call" ? (
          <CallRow key={s.id} call={s} stopped={stopped} link={link} />
        ) : (
          <Prose key={i} text={s.text} resolve={link.resolve} actions={link.actions} hovered={link.hovered} />
        ),
      )}
      {turn.state === "running" && <p className="pt-2 text-muted">working…</p>}
      {turn.error && <p className="pt-2 text-danger">{turn.error}</p>}
    </section>
  );
}

function CallRow({ call, stopped, link }: { call: Call; stopped: boolean; link: Link }) {
  const status = call.result === null ? (stopped ? "stopped" : "…") : (call.result.note ?? (call.result.found ? "done" : "not found"));
  return (
    <div className="mt-1.5 flex gap-2 border-l-2 border-border pl-2 text-muted">
      <span className="min-w-0 flex-1">
        <Spans spans={callLabel(call)} resolve={link.resolve} actions={link.actions} hovered={link.hovered} />
      </span>
      <span className="shrink-0 tabular-nums">{status}</span>
    </div>
  );
}

/** Each lookup in plain words, with what it was asked about as code so a path in it links to the map. */
function callLabel({ name, args }: Call): Span[] {
  const arg = (key: string) => ({ text: typeof args[key] === "string" ? args[key] : "", code: true });
  switch (name) {
    case "analysis_summary":
      return [{ text: "Read the repository summary" }];
    case "find_files":
      return [{ text: "Find paths containing " }, arg("match")];
    case "files_by_role":
      return [{ text: "List files with the role " }, arg("role")];
    case "file_neighbours":
      return [{ text: "What " }, arg("path"), { text: " imports and what imports it" }];
    case "walk_graph":
      return args.direction === "dependents"
        ? [{ text: "Everything that depends on " }, arg("path")]
        : [{ text: "Everything " }, arg("path"), { text: " depends on" }];
    case "route_table":
      return [{ text: "Read the route table" }];
    default:
      return [{ text: name, code: true }];
  }
}

function apply(steps: Step[], event: Exclude<AskEvent, { type: "thread" | "done" | "error" }>): Step[] {
  switch (event.type) {
    case "call":
      return [...steps, { kind: "call", id: event.id, name: event.name, args: event.args, result: null }];
    case "result":
      return steps.map((s) =>
        s.kind === "call" && s.id === event.id ? { ...s, result: { found: event.found, note: event.note } } : s,
      );
    case "text": {
      const last = steps.at(-1);
      return last?.kind === "text"
        ? [...steps.slice(0, -1), { kind: "text", text: last.text + event.delta }]
        : [...steps, { kind: "text", text: event.delta }];
    }
  }
}

/** The relay's newline-delimited events, one at a time as they arrive. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AskEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.trim() === "") continue;
      // Our own route wrote this line from an AskEvent.
      const event: AskEvent = JSON.parse(line);
      yield event;
    }
  }
}

function selectionLabel(s: Selection): string {
  return s.kind === "file" ? s.path : `${s.id}/`;
}
