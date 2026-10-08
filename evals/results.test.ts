import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { scoreAnswer } from "../lib/graph/score.ts";
import type { Question } from "./questions.ts";
import { render } from "./report.ts";
import { finishedUnreported, openRun, pending, runPending, type Attempt, type Fresh, type Results } from "./results.ts";

// Stopping and continuing the answer check, with a stand-in for the agent:
// two questions over two rounds, so four attempts in all.

const questions: Question[] = ["src/a.ts", "src/b.ts"].map((subject) => ({
  id: `importers:${subject}`,
  template: "importers",
  pick: "rarely imported",
  subject,
  text: `Which files import \`${subject}\`?`,
  expected: ["src/c.ts"],
}));

function fresh(startedAt: string, asked = questions): Fresh {
  return {
    answerCheck: `check-${startedAt}`,
    startedAt,
    repo: "owner/name",
    commit: "abc",
    tracedIn: "flowlens",
    rounds: 2,
    parse: { adapter: "none", files: 3, edges: 2, skipped: 0 },
    empty: [],
    questions: asked,
  };
}

const sitting = (startedAt: string) => ({ startedAt, flowlens: { commit: "def", localChanges: false } });

function attempt(q: Question, round: number, error: string | null = null): Attempt {
  return {
    question: q.id,
    round,
    threadId: "thread",
    agentRunId: "run",
    lookups: [],
    text: "`src/c.ts`",
    lookedUp: true,
    scored: error === null ? { named: ["src/c.ts"], ambiguous: [], invented: [], score: scoreAnswer(q.expected, ["src/c.ts"]) } : null,
    error,
  };
}

const slots = (r: Results) => r.attempts.map((a) => `${a.round} ${a.question}`);

test("a run stopped partway is continued in the same file, finished, with each attempt once", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "answer-check-"));
  const first = openRun(folder, fresh("2026-10-09T10:00:00.000Z"), sitting("2026-10-09T10:00:00.000Z"));
  let made = 0;
  await assert.rejects(
    runPending(
      first.file,
      first.results,
      async (q, round) => {
        // The process dying mid-attempt: nothing comes back for the fourth.
        if (made === 3) throw new Error("killed");
        made++;
        return attempt(q, round);
      },
      () => null,
    ),
    /killed/,
  );
  const stopped: Results = JSON.parse(readFileSync(first.file, "utf8"));
  assert.equal(stopped.finishedAt, null);
  assert.equal(stopped.attempts.length, 3);

  const second = openRun(folder, fresh("2026-10-09T11:00:00.000Z"), sitting("2026-10-09T11:00:00.000Z"));
  assert.equal(second.continued, true);
  assert.equal(second.file, first.file);
  const asked: string[] = [];
  const stop = await runPending(
    second.file,
    second.results,
    async (q, round) => {
      asked.push(`${round} ${q.id}`);
      return attempt(q, round);
    },
    () => null,
  );
  assert.equal(stop, null);
  assert.deepEqual(asked, ["2 importers:src/b.ts"]);

  const finished: Results = JSON.parse(readFileSync(first.file, "utf8"));
  assert.notEqual(finished.finishedAt, null);
  assert.equal(finished.answerCheck, first.results.answerCheck);
  assert.equal(finished.sittings.length, 2);
  assert.deepEqual(slots(finished), [
    "1 importers:src/a.ts",
    "1 importers:src/b.ts",
    "2 importers:src/a.ts",
    "2 importers:src/b.ts",
  ]);
  assert.deepEqual(readdirSync(folder), [path.basename(first.file)]);
});

test("continuing re-asks the attempts that errored, and replaces them", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "answer-check-"));
  const first = openRun(folder, fresh("2026-10-09T10:00:00.000Z"), sitting("2026-10-09T10:00:00.000Z"));
  const stop = await runPending(
    first.file,
    first.results,
    async (q, round) => attempt(q, round, q.subject === "src/b.ts" ? "429 quota exceeded" : null),
    (_, made) => (made === 3 ? "quota" : null),
  );
  assert.equal(stop, "quota");
  assert.deepEqual(
    pending(first.results).map((p) => `${p.round} ${p.question.id}`),
    ["1 importers:src/b.ts", "2 importers:src/b.ts"],
  );

  const second = openRun(folder, fresh("2026-10-09T11:00:00.000Z"), sitting("2026-10-09T11:00:00.000Z"));
  assert.equal(second.file, first.file);
  assert.equal(await runPending(second.file, second.results, async (q, round) => attempt(q, round), () => null), null);

  const finished: Results = JSON.parse(readFileSync(first.file, "utf8"));
  assert.notEqual(finished.finishedAt, null);
  assert.equal(finished.attempts.length, 4);
  assert.equal(new Set(slots(finished)).size, 4);
  assert.ok(finished.attempts.every((a) => a.error === null && a.scored !== null));
});

test("an unfinished run of other questions is left alone, and a new run starts", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "answer-check-"));
  const first = openRun(folder, fresh("2026-10-09T10:00:00.000Z"), sitting("2026-10-09T10:00:00.000Z"));
  const second = openRun(folder, fresh("2026-10-09T11:00:00.000Z", questions.slice(0, 1)), sitting("2026-10-09T11:00:00.000Z"));
  assert.equal(second.continued, false);
  assert.notEqual(second.file, first.file);
  assert.deepEqual(second.leftAlone, [first.file]);
});

test("a finished run reports, and is written up rather than asked again when its report is missing", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "answer-check-"));
  const run = openRun(folder, fresh("2026-10-09T10:00:00.000Z"), sitting("2026-10-09T10:00:00.000Z"));
  await runPending(run.file, run.results, async (q, round) => attempt(q, round), () => null);

  const report = render(run.results, null);
  assert.match(report, /^THE 2 WORST ANSWERS$/m);
  assert.match(report, /^INVENTED FILES {6}0 answers named a file that doesn't exist$/m);
  assert.match(report, /^NO LOOKUP {11}0 answers had no lookup behind them$/m);

  assert.equal(finishedUnreported(folder, fresh("2026-10-09T11:00:00.000Z"))?.file, run.file);
  writeFileSync(run.file.replace(/\.json$/, ".txt"), report);
  assert.equal(finishedUnreported(folder, fresh("2026-10-09T11:00:00.000Z")), null);
});
