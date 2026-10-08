import type { NextRequest } from "next/server";
import { readCredentialedMap } from "@/lib/agent/credential";
import { answerLookup, hasLookup } from "@/lib/agent/surface";

// The agent's read-only surface: one GET per lookup. There is no signed-in
// user here, only the bearer credential, and which analysis is read is
// whatever it names. Nothing in the URL can choose another.
//
// 401 and 409 end the agent's run: answering around a lookup that never
// happened is the one thing it must not do.

export async function GET(req: NextRequest, ctx: RouteContext<"/api/agent/[tool]">) {
  const { tool } = await ctx.params;
  if (!hasLookup(tool)) return Response.json({ error: `No lookup called ${tool}` }, { status: 404 });

  const credential = req.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!credential) return Response.json({ error: "No credential" }, { status: 401 });

  const read = await readCredentialedMap(credential);
  if (read.kind === "denied") {
    return Response.json({ error: "The credential is invalid or expired" }, { status: 401 });
  }
  if (read.kind === "empty") {
    return Response.json({ error: "Nothing has been stored for this analysis yet" }, { status: 409 });
  }

  const { status, body } = answerLookup(read.map, tool, req.nextUrl.searchParams);
  return Response.json(body, { status });
}
