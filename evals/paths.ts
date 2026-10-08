// The invented-path check over real traffic: every explanation people were
// shown in the last few days, read back from the traces and scored again.
//
//   pnpm eval:paths [--days 7]
//   pnpm eval:paths --splice src/made-up.ts
//
// The second form takes the newest real explanation, splices a path into it,
// and checks that. The live score on each run in the dashboard comes from the
// same function, run by the app as it answers.

import "../scripts/load-env.ts";
import { evalClient } from "../lib/ai/client.ts";
import { shownForFile, shownForFolder } from "../lib/ai/explain.ts";
import { checkPaths } from "../lib/ai/invented.ts";
import { isRecord, option, readFacts, readFolderFacts, str } from "./shared.ts";

// More than a few days of clicking produces. Past it, the report says so.
const MAX_RUNS = 1000;

const splice = option("--splice");
const days = Number(option("--days") ?? 7);
if (!Number.isFinite(days) || days <= 0 || process.argv.length > 2) {
  console.error("usage: pnpm eval:paths [--days N] | --splice <path>");
  process.exit(1);
}

const { client, project } = evalClient();
const projectId = (await client.readProject({ projectName: project })).id;
const projectUrl = await client.getProjectUrl({ projectId });

interface Explained {
  id: string;
  /** The file or folder explained. */
  subject: string;
  text: string;
  shown: string[];
}

type Traced = { id?: string; name?: string; inputs?: unknown; outputs?: unknown; metadata?: unknown };

/** Null for a run that produced no answer: it errored, and nobody was shown anything. */
function read(run: Traced): Explained | null {
  const id = str(run.id, "run id");
  if (!isRecord(run.outputs) || typeof run.outputs.output !== "string") return null;
  if (run.name === "explain-file") {
    const facts = readFacts(run.inputs);
    return { id, subject: facts.file.path, text: run.outputs.output, shown: shownForFile(facts) };
  }
  const facts = readFolderFacts(run.inputs);
  return { id, subject: `${facts.folder}/`, text: run.outputs.output, shown: shownForFolder(facts) };
}

const since = new Date(Date.now() - days * 86_400_000);
const runs = client.runs.query({
  project_ids: [projectId],
  is_root: true,
  filter: 'or(eq(name, "explain-file"), eq(name, "explain-folder"))',
  min_start_time: since.toISOString(),
  selects: ["ID", "NAME", "INPUTS", "OUTPUTS", "METADATA", "START_TIME"],
  page_size: 100,
});

// A cache hit is the same answer shown again. Scored once, newest run kept,
// so a file clicked twenty times doesn't count twenty times.
const byAnswer = new Map<string, Explained>();
let total = 0;
let unanswered = 0;
// Inputs in a shape this can't read, such as a run traced before a change to
// the facts. Counted, not guessed at, and the rest still scored.
const unreadable: string[] = [];
for await (const run of runs) {
  if (++total > MAX_RUNS) break;
  let explained: Explained | null;
  try {
    explained = read(run);
  } catch (error) {
    unreadable.push(`${projectUrl}/r/${String(run.id)}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  if (explained === null) {
    unanswered++;
    continue;
  }
  const key = isRecord(run.metadata) && typeof run.metadata.cache_key === "string" ? run.metadata.cache_key : explained.id;
  if (!byAnswer.has(key)) byAnswer.set(key, explained);
}

if (splice !== undefined) {
  const newest = byAnswer.values().next().value;
  if (newest === undefined) {
    console.error(`No explanation in the last ${days} days to splice into. Click Explain on any file first.`);
    process.exit(1);
  }
  // After the first sentence, where a real slip would sit.
  const end = newest.text.search(/[.!?](\s|$)/);
  const at = end === -1 ? newest.text.length : end + 1;
  const text = `${newest.text.slice(0, at)} It also relies on \`${splice}\`.${newest.text.slice(at)}`;
  const { invented } = checkPaths(text, newest.shown);
  console.log(`spliced into the explanation of ${newest.subject} (${projectUrl}/r/${newest.id}):\n`);
  console.log(text);
  console.log(
    invented.length === 0
      ? `\nNOT CAUGHT: ${splice} passed as a shown path.`
      : `\ncaught: ${invented.join(", ")}`,
  );
  process.exit(invented.length === 0 ? 1 : 0);
}

if (total > MAX_RUNS) console.log(`stopped at ${MAX_RUNS} runs; pass a smaller --days to score all of a window`);
const scored = [...byAnswer.values()];
if (scored.length === 0) {
  console.log(`No explanations in the last ${days} days. Click Explain on a few files and folders, then run this again.`);
  process.exit(1);
}

const failures = scored.map((e) => ({ ...e, invented: checkPaths(e.text, e.shown).invented })).filter((e) => e.invented.length > 0);
for (const f of failures) {
  console.log(`\n${f.subject}  ${projectUrl}/r/${f.id}`);
  for (const token of f.invented) console.log(`  not shown: ${token}\n    in: "${sentenceWith(f.text, token)}"`);
  console.log(`  shown (${f.shown.length}): ${f.shown.join(", ")}`);
}

const passed = scored.length - failures.length;
console.log(
  `\nonly_shown_paths: ${passed}/${scored.length} explanations named only paths they were shown (${pct(passed / scored.length)})`,
);
console.log(
  `${Math.min(total, MAX_RUNS)} runs since ${since.toISOString().slice(0, 10)}, ${scored.length} distinct answers` +
    (unanswered > 0 ? `, ${unanswered} errored and weren't scored` : "") +
    (unreadable.length > 0 ? `, ${unreadable.length} couldn't be read and weren't scored` : ""),
);
if (unreadable.length > 0) console.log(`couldn't read:\n  ${unreadable.join("\n  ")}`);

/** Returns the text around the first matching token, bounded by sentence or line breaks. */
function sentenceWith(text: string, token: string): string {
  const at = text.indexOf(token);
  const start = Math.max(text.lastIndexOf(". ", at) + 1, text.lastIndexOf("\n", at) + 1, 0);
  const stop = [text.indexOf(". ", at + token.length), text.indexOf("\n", at + token.length)].filter((i) => i !== -1);
  return text.slice(start, stop.length === 0 ? text.length : Math.min(...stop) + 1).trim();
}

/** Formats a fraction as a percentage with one decimal place. */
function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
