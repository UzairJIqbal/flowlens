// Runs the pipeline for one repository from a terminal, printing each stage as
// the database publishes it.
//
//   pnpm analyze <github url> --org org_... [--rerun]
//
// Writes real rows for that organization, exactly as the app will. A
// repository already analysed there is left alone unless --rerun is given.

import "./load-env.ts";
import { flushTraces, tracing } from "../lib/ai/client.ts";
import { createAdminClient } from "../lib/supabase/admin.ts";
import { runAnalysis, submitRepository } from "../lib/pipeline/run.ts";

const args = process.argv.slice(2);
const orgAt = args.indexOf("--org");
const org = orgAt === -1 ? undefined : args.splice(orgAt, 2)[1];
const rerunAt = args.indexOf("--rerun");
if (rerunAt !== -1) args.splice(rerunAt, 1);
const url = args[0];

if (url === undefined || org === undefined || !org.startsWith("org_")) {
  console.error("usage: pnpm analyze <github url> --org org_... [--rerun]");
  process.exit(1);
}

const started = performance.now();
const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1).padStart(5)}s`;

const { analysisId, created } = await submitRepository(org, url);
console.log(`analysis ${analysisId} (${created ? "created" : "already existed"})`);
if (!created && rerunAt === -1) {
  console.log("not running it again; pass --rerun to");
  process.exit(0);
}

// Listen the way the progress page will: a private channel per analysis.
const db = createAdminClient();
const channel = db.channel(`analysis:${analysisId}`, { config: { private: true } });
channel.on("broadcast", { event: "*" }, (message) => {
  console.log(`${elapsed()}  ${message.event.padEnd(8)}  ${JSON.stringify(message.payload)}`);
});
const subscribed = await new Promise<string>((resolve) => {
  const timer = setTimeout(() => resolve("TIMED_OUT"), 10_000);
  channel.subscribe((status, err) => {
    if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      clearTimeout(timer);
      resolve(err ? `${status}: ${err.message}` : status);
    }
  });
});
if (subscribed !== "SUBSCRIBED") {
  console.log(`could not subscribe to progress (${subscribed}); running without it`);
}

await runAnalysis(analysisId);

// Broadcasts trail the commit slightly; give the last one a moment to arrive.
await new Promise((resolve) => setTimeout(resolve, 2000));
await db.removeChannel(channel);

const row = await db
  .from("analyses")
  .select("status, stage, stage_message, error, commit_sha, adapter, coverage, warnings")
  .eq("id", analysisId)
  .single();
if (row.error) throw new Error(row.error.message);
const files = await db.from("files").select("id", { count: "exact", head: true }).eq("analysis_id", analysisId);
const edges = await db.from("edges").select("id", { count: "exact", head: true }).eq("analysis_id", analysisId);

const a = row.data;
console.log(`
status   ${a.status} (stage ${a.stage})
message  ${a.error ?? a.stage_message}
commit   ${a.commit_sha ?? "-"}
adapter  ${a.adapter ?? "-"}
stored   ${files.count ?? "?"} files, ${edges.count ?? "?"} edges
warnings ${a.warnings?.length ? a.warnings.join("; ") : "none"}
coverage ${a.coverage === null ? "-" : JSON.stringify(a.coverage)}
tracing  ${tracing.enabled ? `to ${tracing.project}` : `off (${tracing.reason})`}`);

// Exiting drops whatever traces are still queued for sending.
await flushTraces();
process.exit(a.status === "complete" ? 0 : 1);
