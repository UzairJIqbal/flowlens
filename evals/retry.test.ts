import assert from "node:assert/strict";
import { test } from "node:test";
import { perMinuteWait } from "./retry.ts";

// The free tier's error as the agent passed it on in a real run.
const perMinute =
  "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \n" +
  "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-3.5-flash-lite\n" +
  "Please retry in 9.011063405s.";

test("a per-minute limit waits what it asks plus a second", () => {
  assert.equal(perMinuteWait(perMinute), 10.011063405);
});

test("a wait longer than a minute is not a per-minute limit", () => {
  assert.equal(perMinuteWait(perMinute.replace("9.011063405s", "3600s")), null);
});

test("a quota error with no wait, or another error that mentions one, is not retried", () => {
  assert.equal(perMinuteWait(perMinute.replace(/Please retry in .*$/, "")), null);
  assert.equal(perMinuteWait("Flowlens answered HTTP 500; retry in 5s"), null);
});
