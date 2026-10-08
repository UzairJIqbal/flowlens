import type { StoredMap } from "../lib/analyses/map.ts";
import { DEFAULT_DEPTH, reach } from "../lib/graph/reach.ts";
import { insights } from "../lib/graph/insights.ts";
import { kindsOf } from "../lib/map/categories.ts";
import { neighbours } from "../lib/map/detail.ts";
import type { ParseResult } from "../lib/parser/index.ts";

// The answer check's questions and their answer key, from a parse alone. No
// model writes a question and none decides an answer: each question is a
// fixed template filled with a real path, and each answer is what the graph
// functions that draw the canvas say.

export type Template = "importers" | "imports" | "blast-radius" | "dependencies";

export const TEMPLATES: readonly Template[] = ["importers", "imports", "blast-radius", "dependencies"];

const ASK: Record<Template, (path: string) => string> = {
  importers: (p) => `Which files import \`${p}\`?`,
  imports: (p) => `Which files does \`${p}\` import?`,
  "blast-radius": (p) => `If \`${p}\` changes, what could break? Name the files, up to two levels out.`,
  dependencies: (p) => `What does \`${p}\` need to work? Name the files it imports and what those import, two levels deep.`,
};

/**
 * Why a file was picked. Mostly simple files make a number that looks great
 * and means little, so the picks reach on purpose for the places resolution
 * is hard: barrels and aliases.
 */
export type Pick = "re-export only" | "alias" | "heavily imported" | "rarely imported";

export const PICKS: readonly Pick[] = ["re-export only", "alias", "heavily imported", "rarely imported"];

export const PICK_MEANING: Record<Pick, string> = {
  "re-export only": "every file importing it does so with `export … from`",
  alias: "imported at least once through a tsconfig path, baseUrl, package `imports` or workspace package name",
  "heavily imported": "imported by more files than the repository's far-out fence (as the insights list says)",
  "rarely imported": "imported by exactly one file",
};

/** Files per kind of pick. Each one is asked all four templates. */
const PER_PICK = 2;

export interface Question {
  /** Stable across runs of the same commit, so runs can be compared question by question. */
  id: string;
  template: Template;
  pick: Pick;
  subject: string;
  text: string;
  /** The parser's answer, sorted. */
  expected: string[];
}

export interface Picked {
  questions: Question[];
  /** Kinds of pick this repository has no file for. Said, never filled with something close. */
  empty: Pick[];
}

/**
 * The stored map the app would read for this parse, held in memory: the same
 * files, roles, edges and routes the pipeline stores. A model's label is left
 * out, as the agent's lookups never show one.
 */
export function mapOf(result: ParseResult, repo: { owner: string; name: string; commit: string }): StoredMap {
  return {
    repoOwner: repo.owner,
    repoName: repo.name,
    commitSha: repo.commit,
    adapter: result.adapter,
    status: "complete",
    coverage: { parsed: result.coverage.files.parsed, skipped: result.coverage.files.skipped },
    files: result.files.map((f) => ({
      path: f.path,
      folder: f.folder,
      lines: f.lines,
      role: f.role,
      label: null,
      fanIn: f.fanIn,
      fanOut: f.fanOut,
    })),
    edges: result.edges.map(({ from, to }) => ({ from, to })),
    routes: result.routes.map(({ method, path, file, line }) => ({ method, path, file, line })),
    withheldRoutes: result.withheldRoutes.map(({ file, line, reason }) => ({ file, line, reason })),
  };
}

export function pickQuestions(result: ParseResult): Picked {
  const incoming = new Map<string, string[][]>();
  for (const e of result.edges) {
    const kinds = incoming.get(e.to);
    if (kinds) kinds.push(e.kinds);
    else incoming.set(e.to, [e.kinds]);
  }
  // Whatever resolved without a relative specifier came through a path alias,
  // baseUrl, `#` import or workspace package, the resolver's harder cases.
  const aliased = new Set<string>();
  for (const i of result.imports) {
    if (i.outcome.status !== "internal") continue;
    if (!i.specifier.startsWith(".") && !i.specifier.startsWith("/")) aliased.add(i.outcome.to);
  }
  const kinds = kindsOf(result.adapter);
  const heavy = insights(result.files, result.edges, kinds.importedToBeReached).heavilyImported.map((f) => f.path);

  const sorted = result.files.map((f) => f.path).sort();
  const fanIn = new Map(result.files.map((f) => [f.path, f.fanIn]));
  const candidates: Record<Pick, string[]> = {
    "re-export only": sorted.filter((p) => {
      const into = incoming.get(p);
      return into !== undefined && into.every((k) => k.length === 1 && k[0] === "reexport");
    }),
    alias: sorted.filter((p) => aliased.has(p)),
    // Most imported first, so the spread takes the top and the middle of them.
    "heavily imported": heavy,
    "rarely imported": sorted.filter((p) => fanIn.get(p) === 1),
  };

  const around = neighbours(sorted, result.edges);
  const answer: Record<Template, (p: string) => string[]> = {
    importers: (p) => around.get(p)!.importedBy,
    imports: (p) => around.get(p)!.imports,
    "blast-radius": (p) => reach(result.edges, p, "dependents", DEFAULT_DEPTH).map((r) => r.path).sort(),
    dependencies: (p) => reach(result.edges, p, "dependencies", DEFAULT_DEPTH).map((r) => r.path).sort(),
  };

  // Rarer kinds pick first, and a file is picked once, so a barrel's target
  // isn't spent on "rarely imported".
  const taken = new Set<string>();
  const questions: Question[] = [];
  const empty: Pick[] = [];
  for (const pick of PICKS) {
    const files = spread(
      candidates[pick].filter((p) => !taken.has(p)),
      PER_PICK,
    );
    if (files.length === 0) empty.push(pick);
    for (const subject of files) {
      taken.add(subject);
      for (const template of TEMPLATES) {
        questions.push({
          id: `${template}:${subject}`,
          template,
          pick,
          subject,
          text: ASK[template](subject),
          expected: answer[template](subject),
        });
      }
    }
  }
  return { questions, empty };
}

/** Evenly spaced picks, so they span a list rather than its first folder. */
function spread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  return Array.from({ length: count }, (_, i) => items[Math.floor((i * items.length) / count)]);
}
