import { auth } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { readStoredMap, type StoredMap } from "@/lib/analyses/map";
import { answer, readHistory, type Exchange } from "@/lib/agent/answer";
import { isRecord, type AskEvent } from "@/lib/agent/ask";
import type { Selection } from "@/lib/map/selection";
import { createSupabaseClient } from "@/lib/supabase/server";
import { spend } from "@/lib/usage";

// The one way to ask. The map is read as the signed-in member, so the
// analyses policy decides whether they may ask about it at all, and the answer
// runs here, in this request, streamed back as it happens.
//
// Every failure here is answered, never thrown.

export const maxDuration = 300;

/**
 * Where the answer stops, short of the 300 seconds Vercel allows, so it says
 * why it stopped instead of being cut off mid-sentence.
 */
const BUDGET_MS = 270_000;

const MAX_MESSAGE = 2000;

type Asked = { analysisId: string; message: string; selection: Selection | null; history: Exchange[] };

export async function POST(req: NextRequest) {
  const started = Date.now();
  const { userId, orgId } = await auth();
  if (!userId || !orgId) return refuse(401, "Sign in and pick an organization to ask.");

  const asked = parse(await req.json().catch(() => null));
  if (typeof asked === "string") return refuse(400, asked);

  const supabase = await createSupabaseClient();
  let map: StoredMap | null;
  try {
    map = await readStoredMap(supabase, asked.analysisId);
  } catch (e) {
    return refuse(500, e instanceof Error ? e.message : String(e));
  }
  // Not in their organization and not parsed yet read the same.
  if (map === null) return refuse(404, "There's no map to ask about: the analysis isn't in your organization, or hasn't been parsed yet.");

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AskEvent) => {
        // The asker left; there's no one to send to.
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {}
      };
      await answer({
        map,
        history: asked.history,
        message: withSelection(asked.message, asked.selection),
        spend: () => spend("ask"),
        deadline: started + BUDGET_MS,
        signal: req.signal,
        metadata: { analysis: asked.analysisId, organization: orgId },
        emit,
      });
      try {
        controller.close();
      } catch {}
    },
  });

  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

function refuse(status: number, error: string) {
  return Response.json({ error }, { status });
}

function parse(body: unknown): Asked | string {
  if (!isRecord(body)) return "Expected a JSON body.";
  const { analysisId, message, selection, history } = body;
  if (typeof analysisId !== "string" || analysisId === "") return "analysisId is required.";
  if (typeof message !== "string" || message.trim() === "") return "Ask something.";
  if (message.length > MAX_MESSAGE) return `Questions are limited to ${MAX_MESSAGE} characters.`;
  const picked = parseSelection(selection);
  if (picked === undefined) return "selection is malformed.";
  const earlier = readHistory(history);
  if (earlier === null) return "history is malformed.";
  return { analysisId, message: message.trim(), selection: picked, history: earlier };
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
 * instructions expect to hear it. It's a hint about what "this" means, not a
 * fact: the model still looks the path up.
 */
function withSelection(message: string, selection: Selection | null): string {
  if (selection === null) return message;
  const what = selection.kind === "file" ? `the file \`${selection.path}\`` : `the folder \`${selection.id}/\``;
  return `${message}\n\n(Selected on the map: ${what}.)`;
}
