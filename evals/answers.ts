// The answer check: how often the chat agent gets structure right, with the
// parser as the answer key.
//
//   pnpm eval:answers <dir>
//
// <dir> is a clone of one of REPOSITORIES at its pinned commit. Each question
// is answered by the same code the Ask panel runs, with its lookups read from
// a parse this script holds in memory; no server is involved. It writes a
// report and a results file under evals/answers/, to be committed so the next
// run has something to compare to.
//
// The results file is written after every attempt. Stopped partway, the same
// command continues it, re-asking attempts that errored; the report comes
// once every attempt has been made. A per-minute rate limit isn't an error:
// the attempt waits it out and is asked again, a few times at most.
//
// No model is called here. Questions are fixed templates, the key is the graph
// functions, and scoring is set comparison. The only model is the one answering.

import "../scripts/load-env.ts";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { detectAdapter } from "../lib/adapters/index.ts";
import { flushTraces, tracing } from "../lib/ai/client.ts";
import { namedFiles } from "../lib/ai/invented.ts";
import { answer } from "../lib/agent/answer.ts";
import type { AskEvent } from "../lib/agent/ask.ts";
import { scoreAnswer } from "../lib/graph/score.ts";
import { parseRepository } from "../lib/parser/index.ts";
import { mapOf, pickQuestions, type Question } from "./questions.ts";
import { render } from "./report.ts";
import { finishedUnreported, openRun, pending, previousRun, runPending, type Attempt, type Fresh, type Lookup, type Results } from "./results.ts";
import { perMinuteWait } from "./retry.ts";

/**
 * The repositories the check runs against, pinned, so a change in the number
 * is a change in the agent and not in the code it read.
 */
const REPOSITORIES: readonly { repo: string; commit: string; why: string }[] = [
  {
    repo: "shadcn-ui/taxonomy",
    commit: "298a8857c7128a0d121e7f699dfd729f23b3966d",
    why: "a Next.js app whose imports go through `@/` path aliases",
  },
  {
    repo: "immerjs/immer",
    commit: "8848a5b16938e5681a890d73de7bda24b5080498",
    why: "built on barrel files: modules reach each other through `src/internal.ts`",
  },
  {
    repo: "alan2207/bulletproof-react",
    commit: "9506629ed003a561c6627735480cce4994244bb4",
    why: "three apps side by side, each with `@/` aliases and `index.ts` barrels",
  },
];

/** Each question is asked this many times, on fresh threads, so the noise has a size. */
const ROUNDS = 3;
/** Past this, an attempt is abandoned and counted as errored. */
const ATTEMPT_MS = 10 * 60_000;
/** Errors in a row that mean something is broken, not unlucky. */
const MAX_ERRORS_IN_A_ROW = 3;
/** Per-minute rate limits waited out for one attempt before it counts as errored. */
const MAX_RETRIES = 5;

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "evals", "answers");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

// ── Which repository ─────────────────────────────────────────────────────────

const cloneHelp = REPOSITORIES.map(
  (r) => `  git clone https://github.com/${r.repo}.git && git -C ${r.repo.split("/")[1]} checkout ${r.commit}\n    ${r.why}`,
).join("\n");

const dirArg = process.argv[2];
if (dirArg === undefined || process.argv.length > 3) {
  fail(`usage: pnpm eval:answers <dir>\n\n<dir> is a clone of one of these, at its pinned commit:\n${cloneHelp}`);
}
const dir = path.resolve(dirArg);
if (!existsSync(path.join(dir, ".git"))) fail(`${dir} isn't a git clone. Clone one of these:\n${cloneHelp}`);

const origin = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(git(dir, "remote", "get-url", "origin"));
const pinned = origin && REPOSITORIES.find((r) => r.repo.toLowerCase() === `${origin[1]}/${origin[2]}`.toLowerCase());
if (!origin || !pinned) fail(`${dir} isn't one of the answer check's repositories. They are:\n${cloneHelp}`);
const commit = git(dir, "rev-parse", "HEAD");
if (commit !== pinned.commit) {
  fail(`${pinned.repo} is at ${commit.slice(0, 7)}, not the pinned ${pinned.commit.slice(0, 7)}. Check it out first:\n  git -C ${dir} checkout ${pinned.commit}`);
}
// The key is computed from the files on disk; edited files would make it a key to some other code.
if (git(dir, "status", "--porcelain") !== "") fail(`${dir} has local changes. The key has to come from the pinned commit as it is.`);

// ── That it's traced ────────────────────────────────────────────────────────

// An untraced run can't be opened answer by answer, so it isn't worth a number.
if (!tracing.enabled) fail(`The answer check needs LangSmith, and tracing is off: ${tracing.reason}.`);
const tracedIn = tracing.project;

// ── The key ──────────────────────────────────────────────────────────────────

const [owner, name] = pinned.repo.split("/");
console.log(`parsing ${pinned.repo} at ${commit.slice(0, 7)}…`);
const parsed = parseRepository(dir, detectAdapter(dir));
const map = mapOf(parsed, { owner, name, commit });
const paths = map.files.map((f) => f.path);
const { questions, empty } = pickQuestions(parsed);
if (questions.length === 0) fail("No file in this repository fits any pick, so there's nothing to ask.");
console.log(
  `${parsed.files.length} files, ${parsed.edges.length} edges, ${questions.length} questions × ${ROUNDS} rounds` +
    (empty.length > 0 ? ` (no file for: ${empty.join(", ")})` : ""),
);

// ── Asking ───────────────────────────────────────────────────────────────────

/**
 * One attempt, asked again from the start after each per-minute rate limit
 * that outlasted the model client's own waiting. The traces of the abandoned
 * tries stay in LangSmith; the one kept is the last, tagged with how many tries
 * came before it.
 */
async function askWithRetries(checkId: string, q: Question, round: number): Promise<Attempt> {
  for (let retry = 0; ; retry++) {
    const attempt = await ask(checkId, q, round, retry);
    const wait = attempt.error === null ? null : perMinuteWait(attempt.error);
    if (wait === null || retry === MAX_RETRIES) return attempt;
    console.log(
      `rate limited · round ${round} · ${q.id} · waiting ${Math.ceil(wait)}s, then retry ${retry + 1} of ${MAX_RETRIES}`,
    );
    await sleep(wait * 1000);
  }
}

async function ask(checkId: string, q: Question, round: number, retry: number): Promise<Attempt> {
  const attempt: Attempt = {
    question: q.id,
    round,
    threadId: null,
    agentRunId: null,
    lookups: [],
    text: "",
    lookedUp: false,
    scored: null,
    error: null,
  };
  const calls = new Map<string, Lookup>();
  let order = 0;
  let firstResult = -1;
  let lastText = -1;
  const emit = (e: AskEvent) => {
    order++;
    if (e.type === "call") {
      const lookup: Lookup = { name: e.name, args: e.args, found: null, note: null };
      calls.set(e.id, lookup);
      attempt.lookups.push(lookup);
    } else if (e.type === "result") {
      const lookup = calls.get(e.id);
      if (lookup) Object.assign(lookup, { found: e.found, note: e.note });
      if (firstResult === -1) firstResult = order;
    } else if (e.type === "text") {
      lastText = order;
    } else if (e.type === "error") {
      attempt.error = e.message;
    }
  };
  // No conversation before it: nothing an earlier attempt said carries over.
  const answered = await answer({
    map,
    history: [],
    message: q.text,
    // A script has no organization to count against a daily limit.
    spend: async () => {},
    deadline: Date.now() + ATTEMPT_MS,
    metadata: {
      answer_check: checkId,
      question: q.id,
      round: String(round),
      ...(retry > 0 ? { retry: String(retry) } : {}),
    },
    emit,
  });
  attempt.agentRunId = answered.runId;
  attempt.text = answered.text;
  attempt.lookedUp = firstResult !== -1 && (lastText === -1 || firstResult < lastText);
  if (attempt.error === null) {
    const { files, ambiguous, invented } = namedFiles(attempt.text, paths);
    // An answer about a file names it; that isn't a claim about its neighbours.
    const named = files.filter((p) => p !== q.subject || q.expected.includes(p));
    attempt.scored = { named, ambiguous, invented, score: scoreAnswer(q.expected, named) };
  }
  return attempt;
}

// ── Running, or continuing a stopped run ─────────────────────────────────────

const repoDir = path.join(OUT, pinned.repo.replace("/", "__"));
const now = new Date().toISOString();
const fresh: Fresh = {
  answerCheck: randomUUID(),
  startedAt: now,
  repo: pinned.repo,
  commit,
  tracedIn,
  rounds: ROUNDS,
  parse: { adapter: parsed.adapter, files: parsed.files.length, edges: parsed.edges.length, skipped: parsed.coverage.files.skipped },
  empty,
  questions,
};

/** The report beside a finished results file, printed too. */
function writeReport(file: string, results: Results): void {
  const stem = file.slice(0, -".json".length);
  const report = render(results, previousRun(repoDir, results));
  writeFileSync(`${stem}.txt`, report);
  console.log(`\n${report}`);
  console.log(`wrote ${path.relative(ROOT, stem)}.txt`);
}

// Every attempt made but the report never written (the script died at the
// end): write it, rather than ask all the questions again.
const unreported = finishedUnreported(repoDir, fresh);
if (unreported !== null) {
  console.log(`${path.relative(ROOT, unreported.file)} is finished but has no report; writing it, nothing asked`);
  writeReport(unreported.file, unreported.results);
  process.exit(0);
}

const opened = openRun(repoDir, fresh, {
  startedAt: now,
  // Its own results aren't a change to what's measured, and would mark every
  // sitting after the first as a different build.
  flowlens: { commit: git(ROOT, "rev-parse", "HEAD"), localChanges: git(ROOT, "status", "--porcelain", "--", ".", ":!evals/answers") !== "" },
});
const { file, results } = opened;
for (const other of opened.leftAlone) {
  console.log(`left unfinished: ${path.relative(ROOT, other)}, its questions aren't this run's`);
}
const todo = pending(results).length;
console.log(
  opened.continued
    ? `continuing ${path.relative(ROOT, file)}: ${todo} of ${questions.length * ROUNDS} attempts still to make`
    : `writing ${path.relative(ROOT, file)} after every attempt`,
);

let errorsInARow = 0;
const stopped = await runPending(
  file,
  results,
  (q, round) => askWithRetries(results.answerCheck, q, round),
  (a, made, of) => {
    const outcome = a.error !== null ? `error: ${a.error}` : `F1 ${a.scored!.score.f1.toFixed(2)}`;
    console.log(`${made}/${of} · round ${a.round} · ${a.question} · ${outcome}`);
    errorsInARow = a.error === null ? 0 : errorsInARow + 1;
    if (errorsInARow === MAX_ERRORS_IN_A_ROW) return `${MAX_ERRORS_IN_A_ROW} attempts in a row errored, the last with: ${a.error}`;
    return null;
  },
);
await flushTraces();
if (stopped !== null) {
  // Stopped is not finished: the file holds what was made, and running again
  // makes the rest, errored attempts included.
  fail(`${stopped}\nStopped with ${pending(results).length} attempts still to make. Run the same command again to continue.`);
}

writeReport(file, results);
