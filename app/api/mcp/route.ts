import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { traceable } from "langsmith/traceable";
import { z } from "zod";
import { traceOptions } from "@/lib/ai/client";
import { coverageReport, fileNeighbours, NotInAnalysis, provenance, walkGraph } from "@/lib/agent/lookups";
import { listMaps } from "@/lib/analyses/list";
import { readStoredMap, type StoredMap } from "@/lib/analyses/map";
import type { Database } from "@/lib/supabase/database.types";
import { createKeyedClient } from "@/lib/supabase/key";

// The map, for coding agents, over MCP. Read-only, and nothing but parsed
// facts: every answer is one of the chat agent's lookups over the stored map,
// with the commit it came from beside it. No model is called and nothing is
// summarised; the agent on the other end does its own reasoning.
//
// Stateless: each request builds its own server, reads as the key it carries,
// and is done. The key decides the organization in the database, and the
// policies decide the rows. Nothing here checks who may read what.

type Db = SupabaseClient<Database>;

const analysis = z.uuid().describe("An analysis id from list_analyses.");
const path = z
  .string()
  .min(1)
  .describe("A file path from the repository root, e.g. src/lib/db.ts. Must match a file in the analysis exactly.");

function text(body: unknown, isError = false): CallToolResult {
  // Compact on purpose: the agent pays for every token it reads.
  return { content: [{ type: "text", text: JSON.stringify(body) }], ...(isError && { isError }) };
}

/**
 * One lookup over one stored map. A path the analysis doesn't have is an
 * answer, not a failure: it is said plainly, and never swapped for a near one.
 */
async function onMap(db: Db, id: string, ask: (map: StoredMap) => object): Promise<CallToolResult> {
  const map = await readStoredMap(db, id);
  // Not stored, or not this key's organization's: the policy returned nothing,
  // and the two read the same on purpose.
  if (!map) return text({ error: `No stored map for analysis ${id} is readable with this key. list_analyses shows the ones that are.` }, true);
  const source = provenance(map);
  try {
    return text({ analysis: source, ...ask(map) });
  } catch (e) {
    if (e instanceof NotInAnalysis) return text({ analysis: source, path: e.path, result: "not in this analysis" });
    throw e;
  }
}

function server(db: Db, keyId: string): McpServer {
  const mcp = new McpServer({ name: "flowlens", version: "1.0.0" });
  // Each call is a traced run with no model call inside it, so a trace of an
  // MCP session shows lookups and nothing else.
  const traced = <A,>(name: string, run: (args: A) => Promise<CallToolResult>) =>
    traceable(run, traceOptions(`mcp ${name}`, { runType: "tool", metadata: { access_key: keyId } }));

  const listAnalyses = traced("list_analyses", async () =>
    text({ analyses: (await listMaps(db)).map((m) => ({ id: m.id, ...provenance(m) })) }),
  );
  mcp.registerTool(
    "list_analyses",
    {
      description:
        "The organization's analysed repositories, newest first: id, repository, the commit the map was parsed from, when, and coverage. Start here to get an analysis id.",
      annotations: { readOnlyHint: true },
    },
    () => listAnalyses(undefined),
  );

  const neighbours = traced("file_neighbours", (a: { analysis: string; path: string }) =>
    onMap(db, a.analysis, (map) => fileNeighbours(map, a.path)),
  );
  mcp.registerTool(
    "file_neighbours",
    {
      description:
        "What one file imports and what imports it, one level each way, with the kinds of import (import, reexport, dynamic_import, require) on each edge.",
      inputSchema: { analysis, path },
      annotations: { readOnlyHint: true },
    },
    (a) => neighbours(a),
  );

  const blastRadius = traced("blast_radius", (a: { analysis: string; path: string }) =>
    onMap(db, a.analysis, (map) => walkGraph(map, a.path, "dependents")),
  );
  mcp.registerTool(
    "blast_radius",
    {
      description:
        "Every file that imports this one, and every file importing those, two levels deep, with each file's distance. What may break if this file changes. Call before editing a file other files import.",
      inputSchema: { analysis, path },
      annotations: { readOnlyHint: true },
    },
    (a) => blastRadius(a),
  );

  const dependencyChain = traced("dependency_chain", (a: { analysis: string; path: string }) =>
    onMap(db, a.analysis, (map) => walkGraph(map, a.path, "dependencies")),
  );
  mcp.registerTool(
    "dependency_chain",
    {
      description:
        "Every file this one imports, and every file those import, two levels deep, with each file's distance. What this file needs to work.",
      inputSchema: { analysis, path },
      annotations: { readOnlyHint: true },
    },
    (a) => dependencyChain(a),
  );

  const coverage = traced("coverage_report", (a: { analysis: string }) => onMap(db, a.analysis, coverageReport));
  mcp.registerTool(
    "coverage_report",
    {
      description:
        "How much of the repository the map covers: files parsed and skipped, imports by outcome, and why imports went unresolved or were excluded. A file or import outside it has no edges on the map.",
      inputSchema: { analysis },
      annotations: { readOnlyHint: true },
    },
    (a) => coverage(a),
  );

  return mcp;
}

async function handle(req: Request): Promise<Response> {
  const key = req.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!key) return Response.json({ error: "No access key. Create one under Settings in Flowlens." }, { status: 401 });

  const db = createKeyedClient(key);
  // Refused here rather than left to read as an organization with no maps,
  // so a revoked key fails instead of answering "nothing". This decides
  // whether there is a caller at all; which rows it sees is the policies'.
  const touched = await db.rpc("touch_access_key");
  if (touched.error) return Response.json({ error: `Could not check the key: ${touched.error.message}` }, { status: 500 });
  if (!touched.data) return Response.json({ error: "The access key is unknown or revoked." }, { status: 401 });

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server(db, touched.data).connect(transport);
  return transport.handleRequest(req);
}

export { handle as DELETE, handle as GET, handle as POST };
