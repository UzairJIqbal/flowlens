import { createMiddleware } from "langchain";
import { tools } from "../tools/graph.ts";

// The runtime gives every deep agent a scratch filesystem, a todo list and
// sub-agents. Here they are worse than unused: a glob over the empty scratch
// space answers "no files match auth", which reads like a fact about the
// repository, and every such call would show in the chat as a lookup. So the
// model is only ever offered the six lookups.

const lookups = new Set<string>(tools.map((t) => t.name));

export const lookupsOnly = createMiddleware({
  name: "LookupsOnly",
  wrapModelCall: (request, handler) =>
    handler({
      ...request,
      tools: request.tools.filter((t) => typeof t.name === "string" && lookups.has(t.name)),
    }),
});
