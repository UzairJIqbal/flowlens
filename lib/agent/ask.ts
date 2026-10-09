// What the ask route streams to the browser, one event per line, in the order
// it happened: a lookup the moment the model asks for it, its result the
// moment it's read, and the answer's text as it's written. Pure: no Next, no
// React, no database.

/** One line of the stream. */
export type AskEvent =
  | { type: "call"; id: string; name: string; args: Record<string, unknown> }
  /** `note` says what came back, in a few words, when the shape is known. */
  | { type: "result"; id: string; found: boolean; note: string | null }
  | { type: "text"; delta: string }
  /** The answer finished without a single lookup behind it. */
  | { type: "unchecked" }
  | { type: "error"; message: string }
  | { type: "done" };

/**
 * What a lookup returned, in a few words, from the surface's own response.
 * The counts are the lookups' own totals, not a recount of what was listed.
 */
export function describeResult(name: string, content: string): { found: boolean; note: string | null } {
  // The surface's 400 and 404, as they're handed to the model.
  if (content.startsWith("Not found:")) return { found: false, note: "not found" };
  let body: unknown;
  try {
    body = JSON.parse(content);
  } catch {
    return { found: true, note: null };
  }
  if (!isRecord(body)) return { found: true, note: null };

  switch (name) {
    case "analysis_summary":
      return { found: true, note: isRecord(body.files) && typeof body.files.parsed === "number" ? count(body.files.parsed, "file") : null };
    case "find_files":
    case "files_by_role":
    case "walk_graph":
      return { found: true, note: typeof body.total === "number" ? count(body.total, "file") : null };
    case "file_neighbours":
      return {
        found: true,
        note:
          Array.isArray(body.imports) && Array.isArray(body.importedBy)
            ? `imports ${body.imports.length} · imported by ${body.importedBy.length}`
            : null,
      };
    case "route_table":
      return { found: true, note: Array.isArray(body.routes) ? count(body.routes.length, "route") : null };
    default:
      return { found: true, note: null };
  }
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
