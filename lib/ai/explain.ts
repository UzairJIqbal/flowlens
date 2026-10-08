import { cached, type Answer, type Cache } from "./cache.ts";
import { complete, recordFeedback } from "./client.ts";
import { pathFeedback } from "./invented.ts";

// Explanations are written from what the parser found and nothing else. The
// model is handed every neighbour; it is never asked to find one, and the
// prompt forbids naming a file it wasn't handed.

/** A file as the model is told about it. `kind` is null when nothing identified it. */
export interface Described {
  path: string;
  kind: string | null;
  /** Who said what kind it is. A model's label is weaker than a convention, and the model is told which. */
  by: "convention" | "model" | null;
}

export interface FileFacts {
  repository: string;
  commit: string;
  framework: string | null;
  file: Described & { lines: number; hash: string };
  imports: Described[];
  importedBy: Described[];
}

export interface FolderFacts {
  repository: string;
  commit: string;
  framework: string | null;
  /** The folded node's directory; "." is the repository root. */
  folder: string;
  files: (Described & { lines: number })[];
  /** Import edges from a file outside the folder to one inside it. */
  incoming: { from: string; to: string }[];
  /** Import edges from a file inside the folder to one outside it. */
  outgoing: { from: string; to: string }[];
  /** How many import edges stay inside the folder. */
  internal: number;
}

// The pane is narrow: headings would cut a few paragraphs into labelled
// fragments. Exactly three kinds of formatting are permitted, and the pane
// renders those three. Forbidding all of it fails, because models don't
// reliably obey that and the leftovers print as raw markdown.
const FORMAT = `Formatting: plain paragraphs. The only formatting you may use is inline code in single backticks, bold in double asterisks, and bullet lines starting with "- ". No headings, numbered lists, code blocks, links, tables or italics.`;

const NAME_ONLY = `- Name only files you were given, as full repository paths in backticks, exactly as written in the lists. Never name, guess or imply any other file or connection`;
const REST = `- Leave out anything that can't be told from what you were given rather than guess.
- Describe, don't judge. No ratings, no review, no suggestions or improvements.
- ${FORMAT}`;

const RULES = `${NAME_ONLY}: the lists are every connection a parser found by resolving real imports.
${REST}`;

// A change's lists are cut past a limit, so unlike a file's or folder's they
// can't be called complete: a connection left off a cut list still exists.
const CHANGE_RULES = `${NAME_ONLY}. The lists are what a parser found by resolving real imports, but one ending in "more not shown here" is cut short: never say a file or connection is absent, and never count one, from a list that was cut.
${REST}`;

export const FILE_SYSTEM = `You explain one file of a codebase to a developer reading its dependency map. You are given its source, every file in the repository it imports, and every file in the repository that imports it.

Say what the file does and what part it plays among those neighbours: what it provides to the files that import it, and what it relies on from the files it imports. Under 180 words: one or two short paragraphs, optionally with a few bullets.

${RULES}`;

const FOLDER_SYSTEM = `You explain one folder of a codebase to a developer reading its dependency map. You are given every file in it with its kind and size, and every import that crosses its boundary. You are not given source code.

Answer two things about the folder as a whole: what it holds, and why files outside it import into it, meaning which of its files they reach for and what that suggests the folder provides. Talk about the folder, not any one file in it. Reason only from the paths, kinds and imports; say nothing that would need the source. Under 180 words: one or two short paragraphs, optionally with a few bullets.

${RULES}`;

const CHANGE_SYSTEM = `You explain one pull request to a developer looking at its dependency map, drawn before and after the change. You are given the files the pull request changes, the imports between files that it adds and removes, and the files that import a changed file within two steps, all found by a parser reading both commits. You are not given source code.

Say what the change does to how the codebase's files connect: which files it adds, removes or renames, which connections appear or disappear and what that suggests moved where, and which parts of the codebase sit within reach of it. Reason only from the paths, statuses and imports; say nothing that would need the source. Under 180 words: one or two short paragraphs, optionally with a few bullets.

${CHANGE_RULES}
- Never say whether the change is safe, risky, large, good or bad.`;

export interface ChangeFacts {
  repository: string;
  pullRequest: number;
  /** The merge base and the head, the two commits parsed. */
  base: string;
  head: string;
  framework: string | null;
  changed: { path: string; status: string; previousPath: string | null }[];
  addedImports: { from: string; to: string; kind: string }[];
  removedImports: { from: string; to: string; kind: string }[];
  affected: { path: string; depth: number }[];
  /** How many of each list were left out of the lists above, so the model is never told a cut list is whole. */
  omitted: { changed: number; addedImports: number; removedImports: number; affected: number };
  /** Which of the two parses' coverage shares differ enough to put imports in the diff on their own. */
  coverageDiffers: string[];
}

/** Explains a pull request's structural change from the computed diff alone. */
export async function explainChange(facts: ChangeFacts, cache: Cache): Promise<Answer> {
  const answer = await cached("explain-change", cache, { system: CHANGE_SYSTEM, facts }, facts, (f) =>
    complete({ system: CHANGE_SYSTEM, user: changeMessage(f) }),
  );
  await scorePaths(answer, shownForChange(facts));
  return answer;
}

/** Every path the change message lists. */
export function shownForChange(f: ChangeFacts): string[] {
  return [
    ...f.changed.flatMap((c) => (c.previousPath === null ? [c.path] : [c.path, c.previousPath])),
    ...[...f.addedImports, ...f.removedImports].flatMap((e) => [e.from, e.to]),
    ...f.affected.map((a) => a.path),
  ];
}

function changeMessage(f: ChangeFacts): string {
  const more = (n: number) => (n > 0 ? `\n- …and ${n} more not shown here.` : "");
  const imports = (title: string, empty: string, list: ChangeFacts["addedImports"], omitted: number) =>
    list.length === 0
      ? empty
      : `${title}:\n${list.map((e) => `- \`${e.from}\` ${KIND_VERB[e.kind] ?? e.kind} \`${e.to}\``).join("\n")}${more(omitted)}`;
  return [
    `Repository: ${f.repository}, pull request #${f.pullRequest}, comparing its merge base ${f.base.slice(0, 7)} with its head ${f.head.slice(0, 7)}. Framework: ${f.framework ?? "none detected"}.`,
    `Changed files, as GitHub lists them:\n${f.changed
      .map((c) => `- \`${c.path}\`, ${c.status}${c.previousPath === null ? "" : ` from \`${c.previousPath}\``}`)
      .join("\n")}${more(f.omitted.changed)}`,
    imports("Imports the change adds", "The change adds no import between files.", f.addedImports, f.omitted.addedImports),
    imports("Imports the change removes", "The change removes no import between files.", f.removedImports, f.omitted.removedImports),
    f.affected.length === 0
      ? "No file imports a changed file, directly or through one other file."
      : `Files that import a changed file, after the change (1 means directly, 2 through one other file):\n${f.affected
          .map((a) => `- \`${a.path}\` (${a.depth})`)
          .join("\n")}${more(f.omitted.affected)}`,
    ...(f.coverageDiffers.length === 0
      ? []
      : [
          `The parser covered the two commits differently (${f.coverageDiffers.join(" and ")}), so some added or removed imports may come from what it could read on one side rather than from the change. Say so.`,
        ]),
  ].join("\n\n");
}

const KIND_VERB: Record<string, string> = {
  import: "imports",
  reexport: "re-exports from",
  dynamic: "dynamically imports",
  require: "requires",
};

/**
 * Past this the source is cut, and the model is told where. A file the parser
 * read whole is still explained, but never as though all of it was seen.
 */
const SOURCE_LIMIT = 60_000;

/** `source` is fetched only on a cache miss; the key stands in the file's hash for it. */
export async function explainFile(facts: FileFacts, cache: Cache, source: () => Promise<string>): Promise<Answer> {
  const answer = await cached("explain-file", cache, { system: FILE_SYSTEM, facts }, facts, async (f) =>
    complete({ system: FILE_SYSTEM, user: fileMessage(f, await source()) }),
  );
  await scorePaths(answer, shownForFile(facts));
  return answer;
}

/** Explains a folder from stored facts, using the cache and scoring the returned answer for invented paths. */
export async function explainFolder(facts: FolderFacts, cache: Cache): Promise<Answer> {
  const answer = await cached("explain-folder", cache, { system: FOLDER_SYSTEM, facts }, facts, (f) =>
    complete({ system: FOLDER_SYSTEM, user: folderMessage(f) }),
  );
  await scorePaths(answer, shownForFolder(facts));
  return answer;
}

/**
 * Scores each traced answer for invented paths, including cache hits, so the
 * dashboard reflects what people were shown. Skips answers without a run ID.
 */
async function scorePaths(answer: Answer, shown: string[]): Promise<void> {
  if (answer.runId !== null) await recordFeedback(answer.runId, pathFeedback(answer.output, shown));
}

/** Every path the file's message lists. The source isn't counted: the prompt allows only the lists. */
export function shownForFile(f: FileFacts): string[] {
  return [f.file.path, ...f.imports.map((d) => d.path), ...f.importedBy.map((d) => d.path)];
}

/** Lists paths shown in the folder message, including both endpoints of boundary imports. */
export function shownForFolder(f: FolderFacts): string[] {
  return [...f.files.map((d) => d.path), ...[...f.incoming, ...f.outgoing].flatMap((e) => [e.from, e.to])];
}

/** Builds the file explanation prompt, marking source text truncated to the character limit. */
export function fileMessage(f: FileFacts, source: string): string {
  const cut = source.length > SOURCE_LIMIT;
  return [
    header(f),
    `File: \`${f.file.path}\`, ${kindOf(f.file)}, ${f.file.lines} lines.`,
    list(`It imports these ${f.imports.length} files`, "It imports no file in this repository.", f.imports),
    list(
      `These ${f.importedBy.length} files import it`,
      "No file in this repository imports it.",
      f.importedBy,
    ),
    cut
      ? `Its source, cut off after the first ${SOURCE_LIMIT} of ${source.length} characters:`
      : "Its source:",
    `<source>\n${cut ? source.slice(0, SOURCE_LIMIT) : source}\n</source>`,
  ].join("\n\n");
}

function folderMessage(f: FolderFacts): string {
  const name = f.folder === "." ? "the repository root" : `\`${f.folder}/\``;
  return [
    header(f),
    // A folded node also holds the small subfolders merged into it.
    `Folder: ${name}. It stands for these ${f.files.length} files, including any in small subfolders shown with it:`,
    f.files.map((d) => `- \`${d.path}\`, ${kindOf(d)}, ${d.lines} lines`).join("\n"),
    edges(`Imported from outside: ${f.incoming.length} imports`, "Nothing outside it imports any of its files.", f.incoming),
    edges(`Importing outside: ${f.outgoing.length} imports`, "None of its files imports anything outside it.", f.outgoing),
    `Imports between its own files: ${f.internal}.`,
  ].join("\n\n");
}

function header(f: { repository: string; commit: string; framework: string | null }): string {
  return `Repository: ${f.repository} at commit ${f.commit.slice(0, 7)}. Framework: ${f.framework ?? "none detected"}.`;
}

function kindOf(d: Described): string {
  if (d.kind === null) return "not identified by any convention";
  return d.by === "model" ? `labelled ${d.kind} by a model, not by convention` : d.kind;
}

function list(title: string, empty: string, files: Described[]): string {
  if (files.length === 0) return empty;
  return `${title}:\n${files.map((d) => `- \`${d.path}\` (${kindOf(d)})`).join("\n")}`;
}

function edges(title: string, empty: string, pairs: { from: string; to: string }[]): string {
  if (pairs.length === 0) return empty;
  return `${title}:\n${pairs.map((e) => `- \`${e.from}\` imports \`${e.to}\``).join("\n")}`;
}
