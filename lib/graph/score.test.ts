import assert from "node:assert/strict";
import { test } from "node:test";
import { namedFiles } from "../ai/invented.ts";
import { scoreAnswer } from "./score.ts";

// The answer check's scoring, from an answer's text to its score, over a
// repository small enough to check by eye.

const repo = ["src/a.ts", "src/b.ts", "src/c.ts", "lib/index.ts", "src/index.ts"];

function scored(text: string, expected: string[]) {
  const named = namedFiles(text, repo);
  return { named, score: scoreAnswer(expected, named.files) };
}

test("an exact answer names every expected file and nothing else", () => {
  const { named, score } = scored("It is imported by `src/b.ts` and `src/c.ts`.", ["src/b.ts", "src/c.ts"]);
  assert.deepEqual(named.invented, []);
  assert.deepEqual(score, {
    correct: ["src/b.ts", "src/c.ts"],
    missed: [],
    wrong: [],
    recall: 1,
    precision: 1,
    f1: 1,
  });
});

test("a partial answer counts what it got, what it missed and what it got wrong", () => {
  const { score } = scored("Only `src/b.ts` and `lib/index.ts` import it.", ["src/b.ts", "src/c.ts"]);
  assert.deepEqual(score.correct, ["src/b.ts"]);
  assert.deepEqual(score.missed, ["src/c.ts"]);
  assert.deepEqual(score.wrong, ["lib/index.ts"]);
  assert.equal(score.recall, 0.5);
  assert.equal(score.precision, 0.5);
  assert.equal(score.f1, 0.5);
});

test("an empty answer misses everything, and is exact only when nothing was expected", () => {
  const { score } = scored("Nothing imports it.", ["src/b.ts"]);
  assert.deepEqual(score.missed, ["src/b.ts"]);
  assert.equal(score.recall, 0);
  assert.equal(score.f1, 0);

  const none = scored("Nothing imports it.", []).score;
  assert.equal(none.f1, 1);
});

test("a file that doesn't exist is invented, not a wrong file, and never correct", () => {
  const { named, score } = scored("It is imported by `src/b.ts` and `src/made-up.ts`.", ["src/b.ts", "src/c.ts"]);
  assert.deepEqual(named.invented, ["src/made-up.ts"]);
  assert.deepEqual(named.files, ["src/b.ts"]);
  assert.deepEqual(score.correct, ["src/b.ts"]);
  assert.deepEqual(score.wrong, []);
  assert.deepEqual(score.missed, ["src/c.ts"]);
});

test("a bare name ending one path names it; one ending several is set aside", () => {
  const named = namedFiles("See `c.ts` and `index.ts`.", repo);
  assert.deepEqual(named.files, ["src/c.ts"]);
  assert.deepEqual(named.ambiguous, ["index.ts"]);
  assert.deepEqual(named.invented, []);
});
