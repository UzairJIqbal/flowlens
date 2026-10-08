// Two explanation prompts, the retired one and the current one, run over the
// same files as two experiments and scored side by side.
//
//   pnpm eval:prompts [--rebuild]
//
// Two scores. only_shown_paths is exact: the invented-path check. Specificity
// is not: "is this specific enough to be useful" has no exact answer, so a
// model judges it, and that number is an opinion with a method, not a
// measurement. The judge is the same model that wrote both explanations.

import "../scripts/load-env.ts";
import type { Example } from "langsmith/schemas";
import { evaluate } from "langsmith/evaluation";
import { traceable } from "langsmith/traceable";
import { cached } from "../lib/ai/cache.ts";
import { complete, evalClient, flushTraces, traceOptions } from "../lib/ai/client.ts";
import { FILE_SYSTEM, fileMessage, shownForFile, type FileFacts } from "../lib/ai/explain.ts";
import { ONLY_SHOWN_PATHS, pathFeedback } from "../lib/ai/invented.ts";
import { fileFacts, parsedSource } from "../lib/analyses/stored.ts";
import { neighbours } from "../lib/map/detail.ts";
import { RETIRED_FILE_SYSTEM } from "./retired-prompt.ts";
import { counter, ensureDataset, flag, isRecord, latestAnalyses, mean, noCache, readFacts, spread, str } from "./shared.ts";

const DATASET = "flowlens-explain-files";
// Enough files per repository to span it, few enough that two experiments and
// their judging stay a few minutes of calls.
const PER_REPOSITORY = 8;
const SPECIFICITY = "judged_specificity";

const rebuild = flag("--rebuild");
if (process.argv.length > 2) {
  console.error("usage: pnpm eval:prompts [--rebuild]");
  process.exit(1);
}

await ensureDataset(DATASET, "Files with at least one neighbour, spread across each analysed repository.", rebuild, async () => {
  const examples = [];
  const skipped: string[] = [];
  for (const stored of await latestAnalyses()) {
    const around = neighbours(
      stored.files.map((f) => f.path),
      stored.edges,
    );
    // A file with no neighbours has nothing for "what part it plays" to say.
    const connected = stored.files.filter((f) => {
      const n = around.get(f.path)!;
      return n.imports.length + n.importedBy.length > 0;
    });
    for (const f of spread(connected, PER_REPOSITORY)) {
      try {
        // The facts the app builds, from the same code.
        const facts = fileFacts(stored, f.path);
        const source = await parsedSource(stored.repo, stored.commit, f.path, f.hash);
        examples.push({ inputs: { facts, source }, metadata: { repository: stored.name, commit: stored.commit } });
      } catch (error) {
        skipped.push(`${stored.name} ${f.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (skipped.length > 0) console.log(`skipped ${skipped.length} files:\n  ${skipped.join("\n  ")}`);
  return examples;
});

const { client } = evalClient();
const examples: Example[] = [];
for await (const example of client.listExamples({ datasetName: DATASET })) examples.push(example);
if (examples.length === 0) {
  console.error(`${DATASET} is empty. Analyse a repository first, then run with --rebuild.`);
  process.exit(1);
}

const JUDGE_SYSTEM = `You score one explanation of a source file, written for a developer reading the codebase's dependency map. You are given exactly what its writer was given, the file, its neighbours and its source, and then the explanation.

Score how specific it is: does a developer learn what this file actually does, and what it provides to or takes from the neighbours named, beyond what its path already says?

5: concrete throughout. Says what the file does and why each neighbour named connects to it.
4: mostly concrete, with a little filler.
3: the main point is there, but generic phrasing carries much of it.
2: mostly generic. It could describe many files.
1: generic throughout, or it describes something the source doesn't do.

A claim the source contradicts lowers the score. Length doesn't raise it. Formatting doesn't count either way. Give a one-sentence reason, then the score.`;

const JUDGE_SCHEMA = {
  name: "specificity",
  schema: {
    type: "object",
    properties: { reason: { type: "string" }, score: { type: "integer", enum: [1, 2, 3, 4, 5] } },
    required: ["reason", "score"],
    additionalProperties: false,
  },
};

// No cache read in this trace: a judge's verdict is never stored or reused, so
// there is no hit to make visible.
const judge = traceable(async (facts: FileFacts, source: string, explanation: string) => {
  const output = await complete({
    system: JUDGE_SYSTEM,
    user: `${fileMessage(facts, source)}\n\nThe explanation:\n<explanation>\n${explanation}\n</explanation>`,
    schema: JUDGE_SCHEMA,
  });
  const parsed: unknown = JSON.parse(output);
  if (!isRecord(parsed) || typeof parsed.reason !== "string" || ![1, 2, 3, 4, 5].includes(Number(parsed.score))) {
    throw new Error(`The judge's answer wasn't a score: ${output}`);
  }
  return { score: Number(parsed.score), reason: parsed.reason };
}, traceOptions("judge"));

type Fields = Record<string, unknown>;

/** The evaluators for one experiment; the judge, the last call per file, moves its counter. */
const evaluators = (tick: () => void) => [
  ({ inputs, outputs }: { inputs: Fields; outputs: Fields }) => {
    if (typeof outputs.output !== "string") return { key: ONLY_SHOWN_PATHS, score: null, comment: "no explanation" };
    return pathFeedback(outputs.output, shownForFile(readFacts(inputs.facts)));
  },
  async ({ inputs, outputs }: { inputs: Fields; outputs: Fields }) => {
    try {
      if (typeof outputs.output !== "string") return { key: SPECIFICITY, score: null, comment: "no explanation" };
      const verdict = await judge(readFacts(inputs.facts), str(inputs.source, "source"), outputs.output);
      return { key: SPECIFICITY, score: verdict.score, comment: verdict.reason };
    } finally {
      tick();
    }
  },
];

/** One experiment: the same messages, with only the system prompt changed. */
async function experiment(name: "retired" | "current", system: string) {
  return evaluate(
    async (inputs: Fields) => {
      const facts = readFacts(inputs.facts);
      const source = str(inputs.source, "source");
      // The app's cache read, a miss every time, so the trace has the app's shape.
      const answer = await cached("explain-file", noCache, { system, facts }, facts, (f) =>
        complete({ system, user: fileMessage(f, source) }),
      );
      return { output: answer.output };
    },
    {
      data: examples,
      client,
      experimentPrefix: `explain-${name}`,
      description: `The ${name} explanation prompt.`,
      metadata: { prompt: name },
      maxConcurrency: 2,
      evaluators: evaluators(counter(name, examples.length)),
    },
  );
}

console.log(
  `${examples.length} files × 2 prompts, an explanation and a judgement each: ${examples.length * 4} model calls. ` +
    `Several minutes on the free tier.`,
);
const retired = await experiment("retired", RETIRED_FILE_SYSTEM);
const current = await experiment("current", FILE_SYSTEM);

/** Scores by example, for one key; null where the explanation or its scoring failed. */
function scores(results: typeof retired, key: string): Map<string, number | null> {
  const byExample = new Map<string, number | null>();
  for (const row of results.results) {
    const found = row.evaluationResults.results.find((r) => r.key === key);
    byExample.set(row.example.id, typeof found?.score === "number" ? found.score : null);
  }
  return byExample;
}

function line(key: string, scale: string) {
  const before = scores(retired, key);
  const after = scores(current, key);
  // Only examples both experiments scored, so the two means are over the same files.
  const a: number[] = [];
  const b: number[] = [];
  for (const [id, s] of before) {
    const t = after.get(id);
    if (typeof s === "number" && typeof t === "number") {
      a.push(s);
      b.push(t);
    }
  }
  const wins = b.filter((s, i) => s > a[i]).length;
  const losses = b.filter((s, i) => s < a[i]).length;
  const diff = mean(b) - mean(a);
  const signed = `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}`;
  console.log(
    `${key.padEnd(20)} ${mean(a).toFixed(2).padStart(7)} ${mean(b).toFixed(2).padStart(7)} ${signed.padStart(7)}  ` +
      `${scale}, n=${a.length}; current better on ${wins}, worse on ${losses}, same on ${a.length - wins - losses}`,
  );
  return examples.length - a.length;
}

console.log(`\n${"".padEnd(20)} ${"retired".padStart(7)} ${"current".padStart(7)} ${"diff".padStart(7)}`);
const unscoredPaths = line(ONLY_SHOWN_PATHS, "share with no invented path");
const unscoredJudged = line(SPECIFICITY, "1 to 5, model-judged");
if (unscoredPaths + unscoredJudged > 0) {
  console.log(`left out where either experiment failed: ${unscoredPaths} for paths, ${unscoredJudged} for specificity`);
}
console.log(
  `\n${ONLY_SHOWN_PATHS} is exact. ${SPECIFICITY} is the same model judging its own explanations against a rubric:` +
    ` a soft number, good for direction, not a measurement.`,
);

const ids = await Promise.all([retired, current].map(async (r) => (await client.readProject({ projectName: r.experimentName })).id));
console.log(`side by side: ${await client.getDatasetUrl({ datasetName: DATASET })}/compare?selectedSessions=${ids.join(",")}`);
await flushTraces();
