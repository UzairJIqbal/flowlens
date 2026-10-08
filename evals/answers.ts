// The answer check: how often the chat agent gets structure right, with the
// parser as the answer key.
//
//   pnpm eval:answers <dir>
//
// <dir> is a clone of one of REPOSITORIES at its pinned commit. The web app
// must be stopped and the agent running (`pnpm --dir agent dev`): this script
// answers the agent's lookups itself, on the port the agent calls, from a
// parse it holds in memory. It writes a report and a results file under
// evals/answers/, to be committed so the next run has something to compare to.
//
// The results file is written after every attempt. Stopped partway, the same
// command continues it, re-asking attempts that errored; the report comes
// once every attempt has been made. A per-minute rate limit isn't an error:
// the attempt waits it out and is asked again, a few times at most.
//
// No model is called here. Questions are fixed templates, the key is the graph
// functions, and scoring is set comparison. The only model is the agent's.

import "../scripts/load-env.ts";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseEnv } from "node:util";
import { detectAdapter } from "../lib/adapters/index.ts";
import { namedFiles } from "../lib/ai/invented.ts";
import { isRecord, readSse, translate } from "../lib/agent/ask.ts";
import { openThread, startRun } from "../lib/agent/server.ts";
import { answerLookup, hasLookup } from "../lib/agent/surface.ts";
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
/** Past this, an attempt is abandoned and counted as errored; disconnecting cancels the run. */
const ATTEMPT_MS = 10 * 60_000;
/** Errors in a row that mean the agent is down, not unlucky. */
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

// ── Where the agent is, and that it's traced ─────────────────────────────────

const agentUrl = process.env.AGENT_URL?.trim() || fail("AGENT_URL is not set in .env.local, so there is no agent to ask.");

// The agent's own settings, read from the file its dev server loads: where it
// sends lookups, and whether its runs are traced. An untraced run can't be
// opened answer by answer, so it isn't worth a number.
const agentEnvPath = path.join(ROOT, "agent", ".env");
if (!existsSync(agentEnvPath)) fail("agent/.env is missing, so where the agent sends its lookups is unknown.");
const agentEnv = parseEnv(readFileSync(agentEnvPath, "utf8"));
if (agentEnv.LANGSMITH_TRACING !== "true" || !agentEnv.LANGSMITH_API_KEY) {
  fail("The agent isn't traced: set LANGSMITH_TRACING=true and LANGSMITH_API_KEY in agent/.env, then restart it.");
}
if (!agentEnv.FLOWLENS_URL) fail("FLOWLENS_URL is not set in agent/.env, so the agent's lookups go nowhere.");
const surfaceUrl = new URL(agentEnv.FLOWLENS_URL);
const tracedIn = agentEnv.LANGSMITH_PROJECT ?? "default";

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

// ── The agent's lookups, answered from the parse ─────────────────────────────

// The credential the agent passes back on every lookup. Minted per run, so
// nothing else on the machine can read the map through this server.
const credential = randomBytes(32).toString("hex");

function serveSurface(): Promise<Server> {
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", surfaceUrl);
    const tool = /^\/api\/agent\/([^/]+)$/.exec(url.pathname)?.[1];
    // The same order of checks as the app's route.
    if (req.method !== "GET" || tool === undefined || !hasLookup(tool)) return send(404, { error: "No such lookup" });
    if (req.headers.authorization !== `Bearer ${credential}`) return send(401, { error: "Not signed in" });
    try {
      const { status, body } = answerLookup(map, tool, url.searchParams);
      send(status, body);
    } catch (e) {
      send(500, { error: e instanceof Error ? e.message : String(e) });
    }
  });
  return new Promise((resolve) => {
    server.once("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE") {
        fail(`Something is already listening on ${surfaceUrl.host}. Stop the web app: the answer check answers the agent's lookups there itself.`);
      }
      fail(`Could not listen on ${surfaceUrl.host}: ${e.message}`);
    });
    // Every interface, not just the one `localhost` resolves to here: bound to
    // 127.0.0.1 next to a web app on ::, both listen, and the agent's lookups
    // could reach the app instead. The credential is what keeps others out.
    server.listen(Number(surfaceUrl.port || 80), () => resolve(server));
  });
}

// ── Asking ───────────────────────────────────────────────────────────────────

/**
 * One attempt, asked again on a fresh thread after each per-minute rate limit
 * it hits. The traces of the abandoned tries stay in LangSmith; the one kept
 * is the last, tagged with how many tries came before it.
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
  try {
    // A fresh thread every time: nothing an earlier attempt said carries over.
    attempt.threadId = await openThread(agentUrl, { answer_check: checkId });
    const stream = await startRun(agentUrl, attempt.threadId, {
      message: q.text,
      credential,
      metadata: {
        answer_check: checkId,
        question: q.id,
        round: String(round),
        ...(retry > 0 ? { retry: String(retry) } : {}),
        // Said on every trace rather than assumed: the agent path stores no
        // answers, so every answer here is the model's own.
        answer_cache: "none on the agent path",
      },
      signal: AbortSignal.timeout(ATTEMPT_MS),
    });
    const calls = new Map<string, Lookup>();
    let order = 0;
    let firstResult = -1;
    let lastText = -1;
    for await (const message of readSse(stream)) {
      if (message.event === "metadata") {
        attempt.agentRunId ??= runIdOf(message.data);
        continue;
      }
      for (const e of translate(message)) {
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
          attempt.text += e.delta;
          lastText = order;
        } else if (e.type === "error") {
          attempt.error = e.message;
        }
      }
    }
    attempt.lookedUp = firstResult !== -1 && (lastText === -1 || firstResult < lastText);
  } catch (e) {
    attempt.error = e instanceof Error ? e.message : String(e);
  }
  if (attempt.error === null) {
    const { files, ambiguous, invented } = namedFiles(attempt.text, paths);
    // An answer about a file names it; that isn't a claim about its neighbours.
    const named = files.filter((p) => p !== q.subject || q.expected.includes(p));
    attempt.scored = { named, ambiguous, invented, score: scoreAnswer(q.expected, named) };
  }
  return attempt;
}

function runIdOf(data: string): string | null {
  try {
    const body: unknown = JSON.parse(data);
    return isRecord(body) && typeof body.run_id === "string" ? body.run_id : null;
  } catch {
    return null;
  }
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

// First, so a web app still running is caught before any file is written.
const server = await serveSurface();
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
let reachedOnce = false;
const stopped = await runPending(
  file,
  results,
  (q, round) => askWithRetries(results.answerCheck, q, round),
  (a, made, of) => {
    const outcome = a.error !== null ? `error: ${a.error}` : `F1 ${a.scored!.score.f1.toFixed(2)}`;
    console.log(`${made}/${of} · round ${a.round} · ${a.question} · ${outcome}`);
    if (a.threadId !== null) reachedOnce = true;
    if (!reachedOnce && a.error !== null) {
      return `The agent isn't reachable at ${agentUrl}: ${a.error}\nStart it with \`pnpm --dir agent dev\`.`;
    }
    errorsInARow = a.error === null ? 0 : errorsInARow + 1;
    if (errorsInARow === MAX_ERRORS_IN_A_ROW) return `${MAX_ERRORS_IN_A_ROW} attempts in a row errored, the last with: ${a.error}`;
    return null;
  },
);
server.close();
if (stopped !== null) {
  // Stopped is not finished: the file holds what was made, and running again
  // makes the rest, errored attempts included.
  fail(`${stopped}\nStopped with ${pending(results).length} attempts still to make. Run the same command again to continue.`);
}

writeReport(file, results);
