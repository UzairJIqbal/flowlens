import type { StoredMap } from "../analyses/map.ts";
import { analysisSummary, fileNeighbours, filesByRole, findFiles, LookupMiss, routeTable, walkGraph } from "./lookups.ts";

// The agent's read-only surface, minus where the map comes from: a lookup's
// name and parameters in, its HTTP status and body out. The app answers with
// the map a credential names; the answer check answers with a parse it holds
// in memory. One copy, so what the agent reads is the same either way.
//
// 400 and 404 are the model's mistakes and their bodies tell it why; the agent
// reads them.

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

export function hasLookup(tool: string): boolean {
  return Object.hasOwn(lookups, tool);
}

/** One lookup's answer. Anything other than the model's own mistake is thrown. */
export function answerLookup(map: StoredMap, tool: string, params: URLSearchParams): { status: number; body: unknown } {
  if (!hasLookup(tool)) return { status: 404, body: { error: `No lookup called ${tool}` } };
  try {
    return { status: 200, body: lookups[tool](map, params) };
  } catch (e) {
    if (e instanceof BadRequest) return { status: 400, body: { error: e.message } };
    if (e instanceof LookupMiss) return { status: 404, body: { error: e.message } };
    throw e;
  }
}
