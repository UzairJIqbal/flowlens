// When an attempt that failed on a rate limit is worth asking again. Gemini's
// free tier allows a few requests a minute, and an answer takes several, so a
// run hits the limit every few attempts. That says nothing about the agent.
//
// The error says how long to wait. A per-minute window never asks for more
// than a minute, so a longer wait is a daily quota or similar, which waiting
// here won't fix: that one counts as an error like any other.

const QUOTA = /exceeded your current quota|RESOURCE_EXHAUSTED|\b429\b/i;
const RETRY_IN = /retry in (\d+(?:\.\d+)?)s\b/i;
const MINUTE = 60;

/** Seconds to wait before asking again: the error's own wait plus a second. Null when it isn't a per-minute limit. */
export function perMinuteWait(error: string): number | null {
  if (!QUOTA.test(error)) return null;
  const match = RETRY_IN.exec(error);
  if (!match) return null;
  const seconds = Number(match[1]);
  return seconds <= MINUTE ? seconds + 1 : null;
}
