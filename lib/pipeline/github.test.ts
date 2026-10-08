import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { MAX_CHANGED_FILES, readPullRequest } from "./github.ts";

// GitHub stands in as a fetch that answers the two calls a preview makes.

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers the pull request call with `changedFiles`, and the compare call with `listed` files. Returns the URLs asked for. */
function github(changedFiles: number, listed: number): string[] {
  const asked: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    asked.push(url);
    if (url.includes("/pulls/")) {
      return Response.json({
        title: "A change",
        base: { sha: SHA_A, repo: { size: 1024 } },
        head: { sha: SHA_B },
        changed_files: changedFiles,
      });
    }
    return Response.json({
      merge_base_commit: { sha: SHA_C },
      files: Array.from({ length: listed }, (_, i) => ({ filename: `f${i}.ts`, status: "modified" })),
    });
  };
  return asked;
}

const PR = { owner: "o", name: "r", number: 1 };

test("a pull request of exactly 300 files is refused before comparing", async () => {
  const asked = github(MAX_CHANGED_FILES, 0);
  await assert.rejects(readPullRequest(PR), /300 or more files/);
  assert.equal(asked.length, 1);
});

test("a comparison listing exactly 300 files is refused, since it may be cut short", async () => {
  github(MAX_CHANGED_FILES - 1, MAX_CHANGED_FILES);
  await assert.rejects(readPullRequest(PR), /300 or more files/);
});

test("299 files are read in full, against the merge base", async () => {
  github(MAX_CHANGED_FILES - 1, MAX_CHANGED_FILES - 1);
  const pr = await readPullRequest(PR);
  assert.equal(pr.changed.length, MAX_CHANGED_FILES - 1);
  assert.equal(pr.baseSha, SHA_C);
});
