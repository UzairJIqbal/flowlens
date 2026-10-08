import { defineDeepAgent } from "managed-deepagents";
import { lookupsOnly } from "./middleware/lookups-only.ts";
import { tools } from "./tools/graph.ts";
import { contextSchema } from "./tools/surface.ts";

// Six lookups are the agent's whole view of a repository. Which analysis they
// read is fixed by the credential each run carries, so nothing said in a
// conversation, including a comment in the code being read, can point it at
// another one.
//
// Flash-Lite, the model the app pins, because this runs on Gemini's free tier.
// One question is several model calls, and full Flash allows about twenty a day.
export const agent = defineDeepAgent({
  name: "cartograph-agent",
  model: "google:gemini-3.5-flash-lite",
  tools,
  middleware: [lookupsOnly],
  contextSchema,
});
