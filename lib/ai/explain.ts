import { cached, type Answer, type Cache } from "./cache.ts";
import { complete } from "./client.ts";

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

const RULES = `- Name only files you were given, as full repository paths in backticks, exactly as written in the lists. Never name, guess or imply any other file or connection: the lists are every connection a parser found by resolving real imports.
- Leave out anything that can't be told from what you were given rather than guess.
- Describe, don't judge. No ratings, no review, no suggestions or improvements.
- ${FORMAT}`;

const FILE_SYSTEM = `You explain one file of a codebase to a developer reading its dependency map. You are given its source, every file in the repository it imports, and every file in the repository that imports it.

Say what the file does and what part it plays among those neighbours: what it provides to the files that import it, and what it relies on from the files it imports. Under 180 words: one or two short paragraphs, optionally with a few bullets.

${RULES}`;

const FOLDER_SYSTEM = `You explain one folder of a codebase to a developer reading its dependency map. You are given every file in it with its kind and size, and every import that crosses its boundary. You are not given source code.

Answer two things about the folder as a whole: what it holds, and why files outside it import into it, meaning which of its files they reach for and what that suggests the folder provides. Talk about the folder, not any one file in it. Reason only from the paths, kinds and imports; say nothing that would need the source. Under 180 words: one or two short paragraphs, optionally with a few bullets.

${RULES}`;

/**
 * Past this the source is cut, and the model is told where. A file the parser
 * read whole is still explained, but never as though all of it was seen.
 */
const SOURCE_LIMIT = 60_000;

/** `source` is fetched only on a cache miss; the key stands in the file's hash for it. */
export function explainFile(facts: FileFacts, cache: Cache, source: () => Promise<string>): Promise<Answer> {
  return cached("explain-file", cache, { system: FILE_SYSTEM, facts }, facts, async (f) =>
    complete({ system: FILE_SYSTEM, user: fileMessage(f, await source()) }),
  );
}

/** Returns a cached or generated folder explanation based on its files and import edges. */
export function explainFolder(facts: FolderFacts, cache: Cache): Promise<Answer> {
  return cached("explain-folder", cache, { system: FOLDER_SYSTEM, facts }, facts, (f) =>
    complete({ system: FOLDER_SYSTEM, user: folderMessage(f) }),
  );
}

/** Builds the file prompt with all neighbours and a notice when source exceeds the limit. */
function fileMessage(f: FileFacts, source: string): string {
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

/** Describes the folded folder's files and boundary imports without assuming access to source. */
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

/** Identifies the repository, analysed commit and detected framework in a prompt. */
function header(f: { repository: string; commit: string; framework: string | null }): string {
  return `Repository: ${f.repository} at commit ${f.commit.slice(0, 7)}. Framework: ${f.framework ?? "none detected"}.`;
}

/** Formats a file's role while making labels assigned by a model explicit. */
function kindOf(d: Described): string {
  if (d.kind === null) return "not identified by any convention";
  return d.by === "model" ? `labelled ${d.kind} by a model, not by convention` : d.kind;
}

/** Lists neighbouring paths and their roles, using the supplied message when none exist. */
function list(title: string, empty: string, files: Described[]): string {
  if (files.length === 0) return empty;
  return `${title}:\n${files.map((d) => `- \`${d.path}\` (${kindOf(d)})`).join("\n")}`;
}

/** Lists directed imports for a prompt, using the supplied message when none exist. */
function edges(title: string, empty: string, pairs: { from: string; to: string }[]): string {
  if (pairs.length === 0) return empty;
  return `${title}:\n${pairs.map((e) => `- \`${e.from}\` imports \`${e.to}\``).join("\n")}`;
}
