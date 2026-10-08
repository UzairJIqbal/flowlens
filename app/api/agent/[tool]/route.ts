import type { NextRequest } from "next/server";
import { readCredentialedMap } from "@/lib/agent/credential";
import {
  analysisSummary,
  fileNeighbours,
  filesByRole,
  findFiles,
  LookupMiss,
  routeTable,
  walkGraph,
} from "@/lib/agent/lookups";
import type { StoredMap } from "@/lib/analyses/map";

// The agent's read-only surface: one GET per lookup. There is no signed-in
// user here, only the bearer credential, and which analysis is read is
// whatever it names. Nothing in the URL can choose another.
//
// 400 and 404 are the model's mistakes and their bodies tell it why; the agent
// reads them. 401 and 409 end its run: answering around a lookup that never
// happened is the one thing it must not do.

class BadRequest extends Error {}

function required(params: URLSearchParams, name: string): string {
  const value = params.get(name)?.trim();
  if (!value) throw new BadRequest(`${name} is required`);
  return value;
}

const lookups: Record<string, (map: StoredMap, params: URLSearchParams) => unknown> = {
  analysis_summary: (map) => analysisSummary(map),
  find_files: (map, p) => findFiles(map, required(p, "match")),
  files_by_role: (map, p) => filesByRole(map, required(p, "role")),
  file_neighbours: (map, p) => fileNeighbours(map, required(p, "path")),
  walk_graph: (map, p) => {
    const direction = required(p, "direction");
    if (direction !== "dependents" && direction !== "dependencies") {
      throw new BadRequest("direction must be dependents or dependencies");
    }
    return walkGraph(map, required(p, "path"), direction);
  },
  route_table: (map) => routeTable(map),
};

export async function GET(req: NextRequest, ctx: RouteContext<"/api/agent/[tool]">) {
  const { tool } = await ctx.params;
  const lookup = Object.hasOwn(lookups, tool) ? lookups[tool] : undefined;
  if (!lookup) return Response.json({ error: `No lookup called ${tool}` }, { status: 404 });

  const credential = req.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!credential) return Response.json({ error: "No credential" }, { status: 401 });

  const read = await readCredentialedMap(credential);
  if (read.kind === "denied") {
    return Response.json({ error: "The credential is invalid or expired" }, { status: 401 });
  }
  if (read.kind === "empty") {
    return Response.json({ error: "Nothing has been stored for this analysis yet" }, { status: 409 });
  }

  try {
    return Response.json(lookup(read.map, req.nextUrl.searchParams));
  } catch (e) {
    if (e instanceof BadRequest) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof LookupMiss) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
