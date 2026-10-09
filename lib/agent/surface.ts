import type { StoredMap } from "../analyses/map.ts";
import { analysisSummary, fileNeighbours, filesByRole, findFiles, LookupMiss, routeTable, walkGraph } from "./lookups.ts";

// The six lookups by name, as the model calls them: a name and its arguments
// in, a status and body out. The ask route answers with the map the asker's
// own query read; the answer check answers with a parse it holds in memory.
// One copy, so what the model reads is the same either way.
//
// 400 and 404 are the model's mistakes and their bodies tell it why; the
// model reads them.

class BadRequest extends Error {}

function required(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim() === "") throw new BadRequest(`${name} is required`);
  return value.trim();
}

const lookups: Record<string, (map: StoredMap, args: Record<string, unknown>) => unknown> = {
  analysis_summary: (map) => analysisSummary(map),
  find_files: (map, a) => findFiles(map, required(a, "match")),
  files_by_role: (map, a) => filesByRole(map, required(a, "role")),
  file_neighbours: (map, a) => fileNeighbours(map, required(a, "path")),
  walk_graph: (map, a) => {
    const direction = required(a, "direction");
    if (direction !== "dependents" && direction !== "dependencies") {
      throw new BadRequest("direction must be dependents or dependencies");
    }
    return walkGraph(map, required(a, "path"), direction);
  },
  route_table: (map) => routeTable(map),
};

export function hasLookup(tool: string): boolean {
  return Object.hasOwn(lookups, tool);
}

/** One lookup's answer. Anything other than the model's own mistake is thrown. */
export function answerLookup(map: StoredMap, tool: string, args: Record<string, unknown>): { status: number; body: unknown } {
  if (!hasLookup(tool)) return { status: 404, body: { error: `No lookup called ${tool}` } };
  try {
    return { status: 200, body: lookups[tool](map, args) };
  } catch (e) {
    if (e instanceof BadRequest) return { status: 400, body: { error: e.message } };
    if (e instanceof LookupMiss) return { status: 404, body: { error: e.message } };
    throw e;
  }
}
