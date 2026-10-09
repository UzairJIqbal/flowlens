import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Score } from "../lib/graph/score.ts";
import type { Pick, Question } from "./questions.ts";

// The answer check's results file, written after every attempt so a run
// stopped partway (a quota, a crash, Ctrl-C) loses at most the attempt in
// flight. Running the same check again continues the file rather than
// starting over. Nothing here calls the model: asking is passed in.

export interface Lookup {
  name: string;
  args: Record<string, unknown>;
  /** Null when no result came back for the call. */
  found: boolean | null;
  note: string | null;
}

export interface Attempt {
  question: string;
  round: number;
  /** The separate agent service's thread. Null since answers run in the app. */
  threadId: string | null;
  /** The answer's run id, which is its trace's id. */
  agentRunId: string | null;
  lookups: Lookup[];
  text: string;
  /** A lookup came back before the answer finished. */
  lookedUp: boolean;
  /** Null when the attempt errored: an error is counted, never scored as a wrong answer. */
  scored: { named: string[]; ambiguous: string[]; invented: string[]; score: Score } | null;
  error: string | null;
}

/** One stretch of asking. A run continued after a stop has more than one. */
export interface Sitting {
  startedAt: string;
  flowlens: { commit: string; localChanges: boolean };
}

export interface Results {
  /** Groups every trace of the run in LangSmith, across sittings. */
  answerCheck: string;
  startedAt: string;
  /** Null until every attempt has been made. Only a finished run is reported or compared with. */
  finishedAt: string | null;
  sittings: Sitting[];
  repo: string;
  commit: string;
  tracedIn: string;
  rounds: number;
  parse: { adapter: string; files: number; edges: number; skipped: number };
  empty: Pick[];
  questions: Question[];
  attempts: Attempt[];
}

/** What a run is before any attempt: everything that has to match for one to be continued. */
export type Fresh = Omit<Results, "finishedAt" | "sittings" | "attempts">;

export interface Opened {
  file: string;
  results: Results;
  continued: boolean;
  /** Unfinished runs left as they are, because their questions aren't these. */
  leftAlone: string[];
}

/**
 * The newest unfinished run of the same questions, continued, or a new one.
 * Continuing an unfinished run of different questions would mix two keys in
 * one number, so those stay where they are, unfinished.
 */
export function openRun(folder: string, fresh: Fresh, sitting: Sitting): Opened {
  const leftAlone: string[] = [];
  for (const file of runFiles(folder).reverse()) {
    const held = readRun(file);
    if (held.finishedAt !== null) continue;
    if (sameQuestions(held, fresh)) {
      held.sittings.push(sitting);
      writeRun(file, held);
      return { file, results: held, continued: true, leftAlone };
    }
    leftAlone.push(file);
  }
  const results: Results = { ...fresh, finishedAt: null, sittings: [sitting], attempts: [] };
  const file = path.join(folder, `${fresh.startedAt.replace(/[:.]/g, "-")}.json`);
  writeRun(file, results);
  return { file, results, continued: false, leftAlone };
}

function sameQuestions(a: Fresh, b: Fresh): boolean {
  return (
    a.repo === b.repo &&
    a.commit === b.commit &&
    a.rounds === b.rounds &&
    JSON.stringify(a.questions) === JSON.stringify(b.questions)
  );
}

/**
 * The newest run of the same questions, when it is finished but has no report
 * beside it: every attempt made, and the script stopped before writing it.
 */
export function finishedUnreported(folder: string, fresh: Fresh): { file: string; results: Results } | null {
  for (const file of runFiles(folder).reverse()) {
    const held = readRun(file);
    if (!sameQuestions(held, fresh)) continue;
    if (held.finishedAt === null || existsSync(`${file.slice(0, -".json".length)}.txt`)) return null;
    return { file, results: held };
  }
  return null;
}

/** Every attempt still to make, round by round: never made, or made and errored. */
export function pending(results: Results): { question: Question; round: number }[] {
  const done = new Set(results.attempts.filter((a) => a.error === null).map((a) => slot(a.question, a.round)));
  const out: { question: Question; round: number }[] = [];
  for (let round = 1; round <= results.rounds; round++) {
    for (const question of results.questions) {
      if (!done.has(slot(question.id, round))) out.push({ question, round });
    }
  }
  return out;
}

const slot = (question: string, round: number) => `${round}\u0000${question}`;

/**
 * Asks every pending attempt, writing the file after each one. `check` sees
 * each attempt as it lands and returns a reason to stop, or null. Returns that
 * reason, or null once every attempt has been made and the run is finished.
 * Whatever `ask` throws stops the run too, with the file as last written.
 */
export async function runPending(
  file: string,
  results: Results,
  ask: (question: Question, round: number) => Promise<Attempt>,
  check: (attempt: Attempt, made: number, of: number) => string | null,
): Promise<string | null> {
  const todo = pending(results);
  for (const [i, { question, round }] of todo.entries()) {
    const attempt = await ask(question, round);
    record(results, attempt);
    writeRun(file, results);
    const stop = check(attempt, i + 1, todo.length);
    if (stop !== null) return stop;
  }
  results.finishedAt = new Date().toISOString();
  writeRun(file, results);
  return null;
}

/** An attempt in its slot, replacing an earlier errored one, in round and question order. */
function record(results: Results, attempt: Attempt): void {
  const order = new Map(results.questions.map((q, i) => [q.id, i]));
  results.attempts = results.attempts.filter((a) => slot(a.question, a.round) !== slot(attempt.question, attempt.round));
  results.attempts.push(attempt);
  results.attempts.sort((a, b) => a.round - b.round || order.get(a.question)! - order.get(b.question)!);
}

/** The newest finished run of the same repository at the same commit, other than this one. */
export function previousRun(folder: string, current: Results): Results | null {
  for (const file of runFiles(folder).reverse()) {
    const held = readRun(file);
    if (held.finishedAt !== null && held.commit === current.commit && held.answerCheck !== current.answerCheck) return held;
  }
  return null;
}

/** Oldest first: names are start times. */
function runFiles(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(folder, f));
}

function readRun(file: string): Results {
  // Written by this module, in this shape.
  const body: Results = JSON.parse(readFileSync(file, "utf8"));
  return body;
}

/** Whole or not at all: a stop in the middle of a write leaves the last good file. */
function writeRun(file: string, results: Results): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  writeFileSync(partial, `${JSON.stringify(results, null, 2)}\n`);
  renameSync(partial, file);
}
