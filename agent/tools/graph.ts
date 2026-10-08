import { tool } from "langchain";
import { z } from "zod";
import { lookup, type Runtime } from "./surface.ts";

// The six lookups. Each one forwards to the surface, which answers with the
// same graph functions that draw the canvas, so nothing here computes a
// relationship. The agent picks what to ask about; the parser's edges answer.

const path = z.string().describe("A file path exactly as a previous lookup returned it, e.g. `src/lib/auth.ts`.");

export const analysisSummary = tool((_input, runtime: Runtime) => lookup("analysis_summary", {}, runtime), {
  name: "analysis_summary",
  description:
    "The whole analysis at a glance: the repository and commit, the framework detected, how many files were parsed and skipped, how many files each role has, how many routes there are, the files imported most, and the files nothing imports. Start here when you don't yet know the repository.",
  schema: z.object({}),
});

export const findFiles = tool(({ match }, runtime: Runtime) => lookup("find_files", { match }, runtime), {
  name: "find_files",
  description:
    "Files whose path contains some text, matched anywhere in the path and ignoring case. Use it to find where something lives by name, e.g. `auth`, `api/users` or `middleware`.",
  schema: z.object({ match: z.string().min(1).describe("Part of a path.") }),
});

export const filesByRole = tool(({ role }, runtime: Runtime) => lookup("files_by_role", { role }, runtime), {
  name: "files_by_role",
  description:
    "Every file with one role, where a role is what the framework's conventions say a file is (a page, an endpoint, a controller…). Use a role exactly as analysis_summary lists it.",
  schema: z.object({ role: z.string().min(1).describe("A role as analysis_summary lists it.") }),
});

export const fileNeighbours = tool(({ path }, runtime: Runtime) => lookup("file_neighbours", { path }, runtime), {
  name: "file_neighbours",
  description: "One file's direct imports, both ways: the files it imports and the files that import it.",
  schema: z.object({ path }),
});

export const walkGraph = tool(
  ({ path, direction }, runtime: Runtime) => lookup("walk_graph", { path, direction }, runtime),
  {
    name: "walk_graph",
    description:
      "Follow imports from one file, two levels deep, each file listed with how many steps away it is. `dependents` walks to everything that imports it, and what imports those, which is what may break if it changes. `dependencies` walks to everything it needs to work.",
    schema: z.object({ path, direction: z.enum(["dependents", "dependencies"]) }),
  },
);

export const routeTable = tool((_input, runtime: Runtime) => lookup("route_table", {}, runtime), {
  name: "route_table",
  description:
    "Every route the framework's conventions define: method, URL path, and the file and line it comes from, plus the routes that couldn't be fully recovered and why.",
  schema: z.object({}),
});

export const tools = [analysisSummary, findFiles, filesByRole, fileNeighbours, walkGraph, routeTable];
