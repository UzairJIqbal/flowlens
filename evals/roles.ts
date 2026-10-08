// Role accuracy. Files a convention identified never reach the classifier, so
// they're a held-out set with real answers: hide the role, ask, compare.
//
//   pnpm eval:roles [--rebuild]
//
// The dataset is built from the latest analysis of each repository the first
// time, and kept, so later runs score the same files. --rebuild makes it again.

import "../scripts/load-env.ts";
import type { Example } from "langsmith/schemas";
import { evaluate } from "langsmith/evaluation";
import { classifyBatch, type Unidentified } from "../lib/ai/classify.ts";
import { evalClient, flushTraces } from "../lib/ai/client.ts";
import { parsedSource } from "../lib/analyses/stored.ts";
import { neighbours } from "../lib/map/detail.ts";
import { MODEL_ROLES, type ModelRole } from "../lib/taxonomy.ts";
import { counter, ensureDataset, flag, isRecord, latestAnalyses, noCache, num, str, strings } from "./shared.ts";

const DATASET = "flowlens-roles";
const MINIMUM = 30;

const rebuild = flag("--rebuild");
if (process.argv.length > 2) {
  console.error("usage: pnpm eval:roles [--rebuild]");
  process.exit(1);
}

const isModelRole = (value: unknown): value is ModelRole => MODEL_ROLES.some((r) => r === value);

await ensureDataset(
  DATASET,
  "Files whose role a convention assigned, limited to roles the classifier may return.",
  rebuild,
  async () => {
    const examples = [];
    const skipped: string[] = [];
    for (const stored of await latestAnalyses()) {
      const around = neighbours(
        stored.files.map((f) => f.path),
        stored.edges,
      );
      // Only roles the classifier may answer with: scoring it on one it's
      // forbidden to give (page, controller) would measure nothing.
      const held = stored.files.filter((f) => f.by === "convention" && isModelRole(f.role));
      for (const f of held) {
        try {
          const file: Unidentified = {
            path: f.path,
            hash: f.hash,
            lines: f.lines,
            ...around.get(f.path)!,
            source: await parsedSource(stored.repo, stored.commit, f.path, f.hash),
          };
          examples.push({
            inputs: { framework: stored.framework, file },
            outputs: { role: f.role },
            metadata: { repository: stored.name, commit: stored.commit },
          });
        } catch (error) {
          skipped.push(`${stored.name} ${f.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (skipped.length > 0) console.log(`skipped ${skipped.length} files:\n  ${skipped.join("\n  ")}`);
    return examples;
  },
);

const { client } = evalClient();
const examples: Example[] = [];
for await (const example of client.listExamples({ datasetName: DATASET })) examples.push(example);
if (examples.length < MINIMUM) {
  // Loud rather than a percentage over too few to mean anything.
  console.error(
    `${DATASET} has ${examples.length} files; role accuracy needs at least ${MINIMUM}. Analyse a repository with more ` +
      `conventional services, models, components or hooks (pnpm analyze <url> --org ...), then run with --rebuild.`,
  );
  process.exit(1);
}

function readFile(value: unknown): Unidentified {
  if (!isRecord(value)) throw new Error("file isn't an object");
  return {
    path: str(value.path, "file.path"),
    hash: str(value.hash, "file.hash"),
    lines: num(value.lines, "file.lines"),
    imports: strings(value.imports, "file.imports"),
    importedBy: strings(value.importedBy, "file.importedBy"),
    source: str(value.source, "file.source"),
  };
}

console.log(`${examples.length} files, one model call each.`);
const tick = counter("classified", examples.length);
const results = await evaluate(
  // One file per call: a file's answer can't lean on the files batched beside it.
  async (inputs: Record<string, unknown>) => {
    const file = readFile(inputs.file);
    const framework = inputs.framework === null ? null : str(inputs.framework, "framework");
    try {
      const roles = await classifyBatch(framework, [file], noCache);
      return { role: roles.get(file.path) ?? null };
    } finally {
      tick();
    }
  },
  {
    data: examples,
    client,
    experimentPrefix: "roles",
    description: "Classifier on files whose role a convention assigned, with the role hidden.",
    maxConcurrency: 2,
    evaluators: [
      // A failed run arrives with no outputs at all, and scores 0 like any wrong answer.
      ({ outputs, referenceOutputs }: { outputs?: Record<string, unknown>; referenceOutputs?: Record<string, unknown> }) => {
        const expected = referenceOutputs?.role;
        const got = outputs?.role;
        return {
          key: "role_match",
          score: got === expected ? 1 : 0,
          comment: `expected ${String(expected)}, got ${got === undefined ? "no answer" : String(got)}`,
        };
      },
    ],
  },
);

const rows = results.results.map(({ run, example }) => ({
  expected: str(example.outputs?.role, "expected role"),
  got: run.error ? undefined : run.outputs?.role,
}));
const errored = rows.filter((r) => r.got === undefined).length;
const correct = rows.filter((r) => r.got === r.expected).length;

console.log(`\nrole_match by expected role:`);
for (const role of MODEL_ROLES) {
  const of = rows.filter((r) => r.expected === role);
  if (of.length === 0) continue;
  const right = of.filter((r) => r.got === role).length;
  const wrong = new Map<string, number>();
  for (const r of of) if (r.got !== role) wrong.set(String(r.got ?? "error"), (wrong.get(String(r.got ?? "error")) ?? 0) + 1);
  const misses = [...wrong].map(([g, n]) => `${g} ${n}`).join(", ");
  console.log(`  ${role.padEnd(10)} ${String(right).padStart(3)}/${String(of.length).padEnd(4)} ${misses && `answered: ${misses}`}`);
}
console.log(
  `\nrole accuracy: ${correct}/${rows.length} (${((correct / rows.length) * 100).toFixed(1)}%)` +
    (errored > 0 ? `, ${errored} calls failed and count as wrong` : ""),
);
console.log(`experiment: ${await client.getProjectUrl({ projectName: results.experimentName })}`);
await flushTraces();
