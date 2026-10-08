import type { Cache } from "../lib/ai/cache.ts";
import { evalClient } from "../lib/ai/client.ts";
import type { Described, FileFacts, FolderFacts } from "../lib/ai/explain.ts";
import { readStored, type Stored } from "../lib/analyses/stored.ts";
import { createAdminClient } from "../lib/supabase/admin.ts";

// What the eval scripts share: where datasets come from, and reading back what
// LangSmith hands a target, which arrives untyped.

/**
 * Evals measure the model, so they never read a stored answer. The read still
 * happens inside each trace, a miss every time, so an eval run has the shape
 * an app run has.
 */
export const noCache: Cache = { get: async () => null, put: async () => {} };

/**
 * The latest complete analysis of each repository, across every organization:
 * the secret key, because a script has no signed-in user. Newest first.
 */
export async function latestAnalyses(): Promise<Stored[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("analyses")
    .select("id, finished_at, project:projects!inner(repo_owner, repo_name)")
    .eq("status", "complete")
    .not("commit_sha", "is", null)
    .order("finished_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Could not list analyses: ${error.message}`);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of data) {
    const repo = `${row.project.repo_owner}/${row.project.repo_name}`.toLowerCase();
    if (seen.has(repo)) continue;
    seen.add(repo);
    ids.push(row.id);
  }
  const stored: Stored[] = [];
  for (const id of ids) stored.push(await readStored(db, id));
  return stored;
}

/** Builds a dataset only when asked to or when it isn't there, so experiments compare over the same examples. */
export async function ensureDataset(
  name: string,
  description: string,
  rebuild: boolean,
  build: () => Promise<{ inputs: Record<string, unknown>; outputs?: Record<string, unknown>; metadata: Record<string, unknown> }[]>,
): Promise<void> {
  const { client } = evalClient();
  if (await client.hasDataset({ datasetName: name })) {
    if (!rebuild) return;
    await client.deleteDataset({ datasetName: name });
  }
  const examples = await build();
  const dataset = await client.createDataset(name, { description });
  await client.createExamples(examples.map((e) => ({ ...e, dataset_id: dataset.id })));
  console.log(`built dataset ${name}: ${examples.length} examples`);
}

/** Evenly spaced picks, so a dataset spans a repository rather than its first folder. */
export function spread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  return Array.from({ length: count }, (_, i) => items[Math.floor((i * items.length) / count)]);
}

/** Consumes a command-line flag and reports whether it was present. */
export function flag(name: string): boolean {
  const at = process.argv.indexOf(name);
  if (at !== -1) process.argv.splice(at, 1);
  return at !== -1;
}

/** Consumes a named command-line option and its value; exits if a present option has no value. */
export function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  if (at === -1) return undefined;
  const value = process.argv[at + 1];
  // A bare flag running the default instead looks like the flag worked.
  if (value === undefined || value.startsWith("--")) {
    console.error(`${name} needs a value`);
    process.exit(1);
  }
  process.argv.splice(at, 2);
  return value;
}

/** Prints "label n/total" as each call finishes, so a long run on a rate-limited tier visibly moves. */
export function counter(label: string, total: number): () => void {
  let done = 0;
  return () => console.log(`${label} ${++done}/${total}`);
}

/** Returns the arithmetic mean, or NaN when there are no scores. */
export function mean(scores: readonly number[]): number {
  return scores.length === 0 ? NaN : scores.reduce((a, b) => a + b, 0) / scores.length;
}

// Reading untyped values back: checked, never cast. A value that isn't what
// was stored throws, rather than being scored as something it isn't.

type Fields = Record<string, unknown>;

/** Narrows a value to a non-null object, excluding arrays. */
export function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a string or throws an error identifying the malformed field. */
export function str(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`${what} isn't a string`);
  return value;
}

/** Reads a number or throws an error identifying the malformed field. */
export function num(value: unknown, what: string): number {
  if (typeof value !== "number") throw new Error(`${what} isn't a number`);
  return value;
}

/** Reads a list of strings, identifying a malformed element by its index. */
export function strings(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${what} isn't a list`);
  return value.map((v, i) => str(v, `${what}[${i}]`));
}

/** Reads a non-array object or throws an error identifying the malformed field. */
function record(value: unknown, what: string): Fields {
  if (!isRecord(value)) throw new Error(`${what} isn't an object`);
  return value;
}

/** Validates a stored file description, including its nullable role and attribution. */
function described(value: unknown, what: string): Described {
  const d = record(value, what);
  const kind = d.kind === null ? null : str(d.kind, `${what}.kind`);
  const by = d.by;
  if (by !== null && by !== "convention" && by !== "model") throw new Error(`${what}.by isn't a source`);
  return { path: str(d.path, `${what}.path`), kind, by };
}

/** Reconstructs file facts from untyped trace or dataset input; throws on malformed fields. */
export function readFacts(value: unknown): FileFacts {
  const f = record(value, "facts");
  const file = record(f.file, "facts.file");
  const list = (v: unknown, what: string) => {
    if (!Array.isArray(v)) throw new Error(`${what} isn't a list`);
    return v.map((d, i) => described(d, `${what}[${i}]`));
  };
  return {
    repository: str(f.repository, "facts.repository"),
    commit: str(f.commit, "facts.commit"),
    framework: f.framework === null ? null : str(f.framework, "facts.framework"),
    file: { ...described(file, "facts.file"), lines: num(file.lines, "facts.file.lines"), hash: str(file.hash, "facts.file.hash") },
    imports: list(f.imports, "facts.imports"),
    importedBy: list(f.importedBy, "facts.importedBy"),
  };
}

/** Reconstructs folder facts and boundary edges from untyped trace input; throws on malformed fields. */
export function readFolderFacts(value: unknown): FolderFacts {
  const f = record(value, "facts");
  const files = f.files;
  if (!Array.isArray(files)) throw new Error("facts.files isn't a list");
  const pairs = (v: unknown, what: string) => {
    if (!Array.isArray(v)) throw new Error(`${what} isn't a list`);
    return v.map((e, i) => {
      const edge = record(e, `${what}[${i}]`);
      return { from: str(edge.from, `${what}[${i}].from`), to: str(edge.to, `${what}[${i}].to`) };
    });
  };
  return {
    repository: str(f.repository, "facts.repository"),
    commit: str(f.commit, "facts.commit"),
    framework: f.framework === null ? null : str(f.framework, "facts.framework"),
    folder: str(f.folder, "facts.folder"),
    files: files.map((d, i) => ({
      ...described(d, `facts.files[${i}]`),
      lines: num(record(d, `facts.files[${i}]`).lines, `facts.files[${i}].lines`),
    })),
    incoming: pairs(f.incoming, "facts.incoming"),
    outgoing: pairs(f.outgoing, "facts.outgoing"),
    internal: num(f.internal, "facts.internal"),
  };
}
