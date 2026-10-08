import type { SideCoverage } from "../graph/diff.ts";
import { EDGE_KINDS, EXCLUDED_DIR_REASONS, SKIP_REASONS, type EdgeKind, type ParseResult } from "../parser/types.ts";
import type { ChangedFile } from "../pipeline/github.ts";
import type { Json } from "../supabase/database.types.ts";

// One side of a preview as it is stored: the parser's result cut down to what
// the diff, the map and the side list read. Relative imports, so the pipeline
// can run from a plain script.
//
// Type aliases rather than interfaces, so a side is accepted as Json without a cast.

export type PreviewFile = { path: string; folder: string; lines: number; role: string | null };
export type PreviewEdge = { from: string; to: string; kinds: EdgeKind[]; typeOnly: boolean };

/** Why a changed file that exists on this side wasn't parsed, in the parser's own words. */
export type Unparsed = {
  path: string;
  reason: (typeof SKIP_REASONS)[number] | (typeof EXCLUDED_DIR_REASONS)[number];
  detail: string;
};

export type PreviewCoverage = {
  /** Every file the walk found, code or not. */
  found: number;
  parsed: number;
  /** Code files the parser refused to read: too large, or a symbolic link. */
  unparsed: number;
  internal: number;
  external: number;
  excluded: number;
  unresolved: number;
};

export type PreviewSide = {
  adapter: string;
  files: PreviewFile[];
  edges: PreviewEdge[];
  coverage: PreviewCoverage;
  warnings: string[];
  /** Changed paths present on this side that weren't parsed. Absent from both lists means not on this side. */
  unparsed: Unparsed[];
};

/** Cuts a parse down to a stored side, recording why each changed path that exists here wasn't parsed. */
export function sideFromParse(result: ParseResult, changed: readonly ChangedFile[]): PreviewSide {
  const parsed = new Set(result.files.map((f) => f.path));
  const skipped = new Map(result.skipped.map((s) => [s.path, s]));
  const candidates = new Set(changed.flatMap((c) => (c.previousPath === null ? [c.path] : [c.path, c.previousPath])));

  const unparsed: Unparsed[] = [];
  for (const path of [...candidates].sort()) {
    if (parsed.has(path)) continue;
    const skip = skipped.get(path);
    if (skip) {
      unparsed.push({ path, reason: skip.reason, detail: skip.detail });
      continue;
    }
    const inside = result.excludedDirectories.find((d) => path.startsWith(`${d.path}/`));
    if (inside) unparsed.push({ path, reason: inside.reason, detail: inside.path });
    // Otherwise the walk never saw it: it isn't on this side.
  }

  const refused = result.skipped.filter((s) => s.reason === "too-large" || s.reason === "symbolic-link").length;
  const { internal, external, excluded, unresolved } = result.coverage.imports;
  return {
    adapter: result.adapter,
    files: result.files.map(({ path, folder, lines, role }) => ({ path, folder, lines, role })),
    edges: result.edges.map(({ from, to, kinds, typeOnly }) => ({ from, to, kinds: [...kinds], typeOnly })),
    coverage: {
      found: result.coverage.files.found,
      parsed: result.coverage.files.parsed,
      unparsed: refused,
      internal,
      external,
      excluded,
      unresolved,
    },
    warnings: [...result.warnings],
    unparsed,
  };
}

/** What the coverage comparison reads from a stored side. */
export function sideCoverage({ coverage }: PreviewSide): SideCoverage {
  return {
    files: { parsed: coverage.parsed, unparsed: coverage.unparsed },
    imports: { internal: coverage.internal, unresolved: coverage.unresolved },
  };
}

// ---------------------------------------------------------------------------
// Reading back. Stored JSON is checked rather than assumed: a side that
// doesn't have the expected shape stops the page instead of drawing part of it.
// ---------------------------------------------------------------------------

const CHANGE_STATUSES: readonly ChangedFile["status"][] = [
  "added",
  "removed",
  "modified",
  "renamed",
  "copied",
  "changed",
  "unchanged",
];
const UNPARSED_REASONS: readonly Unparsed["reason"][] = [...SKIP_REASONS, ...EXCLUDED_DIR_REASONS];

export function readChanged(value: Json): ChangedFile[] {
  return list(value, "changed files").map((entry) => {
    const path = text(field(entry, "path"), "changed file path");
    const status = CHANGE_STATUSES.find((s) => s === field(entry, "status"));
    const previous = field(entry, "previousPath");
    if (status === undefined) throw new Error(`The stored change to ${path} has no known status`);
    if (previous !== null && typeof previous !== "string") throw new Error(`The stored change to ${path} has a malformed previous path`);
    return { path, status, previousPath: previous };
  });
}

export function readSide(value: Json | null, which: string): PreviewSide {
  if (value === null) throw new Error(`The ${which} side hasn't been stored`);
  const coverage = field(value, "coverage");
  const count = (name: keyof PreviewCoverage) => {
    const n = field(coverage, name);
    if (typeof n !== "number") throw new Error(`The ${which} side's coverage has no ${name} count`);
    return n;
  };
  return {
    adapter: text(field(value, "adapter"), `${which} adapter`),
    files: list(field(value, "files"), `${which} files`).map((f) => {
      const lines = field(f, "lines");
      const role = field(f, "role");
      if (typeof lines !== "number") throw new Error(`A stored ${which} file has no line count`);
      if (role !== null && typeof role !== "string") throw new Error(`A stored ${which} file has a malformed role`);
      return { path: text(field(f, "path"), `${which} file path`), folder: text(field(f, "folder"), `${which} folder`), lines, role };
    }),
    edges: list(field(value, "edges"), `${which} edges`).map((e) => {
      const kinds = list(field(e, "kinds"), `${which} edge kinds`).map((k) => {
        const kind = EDGE_KINDS.find((known) => known === k);
        if (kind === undefined) throw new Error(`A stored ${which} edge has an unknown kind`);
        return kind;
      });
      const typeOnly = field(e, "typeOnly");
      if (typeof typeOnly !== "boolean") throw new Error(`A stored ${which} edge has no type-only flag`);
      return { from: text(field(e, "from"), `${which} edge source`), to: text(field(e, "to"), `${which} edge target`), kinds, typeOnly };
    }),
    coverage: {
      found: count("found"),
      parsed: count("parsed"),
      unparsed: count("unparsed"),
      internal: count("internal"),
      external: count("external"),
      excluded: count("excluded"),
      unresolved: count("unresolved"),
    },
    warnings: list(field(value, "warnings"), `${which} warnings`).map((w) => text(w, `${which} warning`)),
    unparsed: list(field(value, "unparsed"), `${which} unparsed files`).map((u) => {
      const reason = UNPARSED_REASONS.find((r) => r === field(u, "reason"));
      if (reason === undefined) throw new Error(`A stored ${which} unparsed file has no known reason`);
      return { path: text(field(u, "path"), `${which} unparsed path`), reason, detail: text(field(u, "detail"), `${which} unparsed detail`) };
    }),
  };
}

function field(value: Json | undefined, key: string): Json | undefined {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value[key];
}

function list(value: Json | undefined, what: string): Json[] {
  if (!Array.isArray(value)) throw new Error(`The stored ${what} aren't a list`);
  return value;
}

function text(value: Json | undefined, what: string): string {
  if (typeof value !== "string") throw new Error(`The stored ${what} is missing`);
  return value;
}
