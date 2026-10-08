import { MODEL_ROLES, type ModelRole } from "../taxonomy.ts";
import { cached, type Cache } from "./cache.ts";
import { complete } from "./client.ts";

// Labels for files no convention identified. The model may only pick a role
// from MODEL_ROLES, none of them structural, or say it can't tell. Checked
// here, constrained by the response schema, and refused by the database.

export interface Unidentified {
  path: string;
  hash: string;
  lines: number;
  imports: string[];
  importedBy: string[];
  source: string;
}

/** Each file's source is cut past this, and the model is told so. */
const SOURCE_LIMIT = 4_000;

const SYSTEM = `You label source files that no framework convention identified, so a developer reading the codebase's map knows what kind of file each is. For each file pick the single role that describes the file itself:

- service: business logic, or the code that talks to an external system
- repository: reads or writes a data store
- model: data shapes, types, schemas or entities
- util: small general-purpose helpers
- config: configuration, or constants that set behaviour
- component: renders UI
- hook: a React hook

Answer null when none of these fits, or when the source and neighbours don't make it clear. Never guess. A file's neighbours are the files it imports and the files importing it, found by a parser resolving real imports.`;

/** One model call for a batch of files; every path in the batch gets an answer, a role or null. */
export async function classifyBatch(
  framework: string | null,
  files: Unidentified[],
  cache: Cache,
): Promise<Map<string, ModelRole | null>> {
  const paths = files.map((f) => f.path);
  // Source is represented by its hash; it is cut the same way every time.
  const keyed = {
    system: SYSTEM,
    framework,
    files: files.map(({ path, hash, lines, imports, importedBy }) => ({ path, hash, lines, imports, importedBy })),
  };
  const answer = await cached("classify", cache, keyed, keyed.files, async () => {
    const output = await complete({ system: SYSTEM, user: message(framework, files), schema: schemaFor(paths) });
    // Checked before it is cached, so a bad answer is refused rather than kept.
    read(output, paths);
    return output;
  });
  return read(answer.output, paths);
}

/** Builds classification context from each file's neighbours and explicitly truncated source. */
function message(framework: string | null, files: Unidentified[]): string {
  const blocks = files.map((f) => {
    const cut = f.source.length > SOURCE_LIMIT;
    return [
      `File: ${f.path} (${f.lines} lines)`,
      `Imports: ${f.imports.length === 0 ? "nothing in this repository" : f.imports.join(", ")}`,
      `Imported by: ${f.importedBy.length === 0 ? "nothing in this repository" : f.importedBy.join(", ")}`,
      cut ? `Source, cut off after the first ${SOURCE_LIMIT} of ${f.source.length} characters:` : "Source:",
      `<source>\n${cut ? f.source.slice(0, SOURCE_LIMIT) : f.source}\n</source>`,
    ].join("\n");
  });
  return [`Framework: ${framework ?? "none detected"}.`, ...blocks].join("\n\n");
}

/** Restricts model output to supplied paths and permitted nonstructural roles or null. */
function schemaFor(paths: string[]) {
  return {
    name: "file_roles",
    schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string", enum: paths },
              role: { type: ["string", "null"], enum: [...MODEL_ROLES, null] },
            },
            required: ["path", "role"],
            additionalProperties: false,
          },
        },
      },
      required: ["files"],
      additionalProperties: false,
    },
  };
}

/** Narrows an untrusted label to a role the model is allowed to assign. */
const isModelRole = (value: unknown): value is ModelRole => MODEL_ROLES.some((r) => r === value);

/** Exactly one answer per path, each a permitted role or null; anything else throws. */
function read(output: string, paths: string[]): Map<string, ModelRole | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("The model's labels weren't JSON");
  }
  const entries = typeof parsed === "object" && parsed !== null && "files" in parsed ? parsed.files : undefined;
  if (!Array.isArray(entries)) throw new Error("The model's labels had no list of files");

  const wanted = new Set(paths);
  const roles = new Map<string, ModelRole | null>();
  for (const entry of entries) {
    const path = typeof entry === "object" && entry !== null && "path" in entry ? entry.path : undefined;
    const role = typeof entry === "object" && entry !== null && "role" in entry ? entry.role : undefined;
    if (typeof path !== "string" || !wanted.has(path)) throw new Error("The model labelled a file it wasn't given");
    if (roles.has(path)) throw new Error(`The model labelled ${path} twice`);
    if (role !== null && !isModelRole(role)) throw new Error(`The model gave ${path} a role it may not: ${String(role)}`);
    roles.set(path, role);
  }
  if (roles.size !== wanted.size) throw new Error(`The model labelled ${roles.size} of ${wanted.size} files`);
  return roles;
}
