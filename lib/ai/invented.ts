import { CANDIDATE, LEADING, TRAILING } from "../map/prose.ts";

// The invented-path check: every path-shaped token in an explanation, tested
// against the exact set of paths the model was shown. Plain code, not a model
// grading a model. Whether a path is in a list has an exact answer, and a
// hallucination detector that can itself hallucinate is worth nothing.

/** The feedback key, live and in experiments. 1 when every path named was shown. */
export const ONLY_SHOWN_PATHS = "only_shown_paths";

// A last segment with a name and an extension starting with a letter:
// `page.tsx`, `.eslintrc.cjs`. Not `3.5`, and not `.env` on its own.
const FILENAME = /(?:^|\/)[^/]+\.[A-Za-z][A-Za-z0-9]*$/;
// What the parser reads.
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
// How a model refers to a file it read in source rather than in the lists.
const SPECIFIER = /^(?:\.\.?\/|[@~]\/)+/;

export interface PathCheck {
  /** Every distinct path-shaped token, in order of appearance. */
  named: string[];
  /** Those that aren't a path the model was shown. */
  invented: string[];
}

/**
 * A token is path-shaped when it ends in a file name and either has a `/` in
 * it, or is a bare source file name in code formatting. Outside code, a bare
 * name is left alone: `Next.js` and `res.json` have the same shape as a file
 * name, and flagging them would make every failure need a second look.
 *
 * A token names a shown file when it is that path, or ends one at a `/`: a
 * bare `route.ts`, or `./db.ts` copied from an import, names a shown file
 * without being invented. `src/lib/db.ts` when `lib/db.ts` was shown is a path
 * that doesn't exist, and is invented.
 */
export function checkPaths(text: string, shown: Iterable<string>): PathCheck {
  const paths = [...shown];
  const named = new Set<string>();
  for (const { text: segment, code } of segments(text)) {
    for (const match of segment.matchAll(CANDIDATE)) {
      const token = trim(match[0]);
      if (pathShaped(token, code)) named.add(token);
    }
  }
  const invented = [...named].filter((token) => {
    const rest = token.replace(SPECIFIER, "");
    return !paths.some((p) => p === rest || p.endsWith(`/${rest}`));
  });
  return { named: [...named], invented };
}

export interface NamedFiles {
  /** Repository paths the text names, each once, in order of appearance. */
  files: string[];
  /** Tokens that end more than one path, so name none of them for certain. */
  ambiguous: string[];
  /** Tokens that are no path in the repository: the check's own verdict. */
  invented: string[];
}

/**
 * Which of a repository's files a text names, read with the check above: its
 * tokens, its idea of a match, and its verdict on what's invented. A token
 * that ends exactly one path names that path; one that ends several could be
 * any of them and is set aside rather than guessed at.
 */
export function namedFiles(text: string, paths: readonly string[]): NamedFiles {
  const { named, invented } = checkPaths(text, paths);
  const out = new Set(invented);
  const files = new Set<string>();
  const ambiguous: string[] = [];
  for (const token of named) {
    if (out.has(token)) continue;
    const rest = token.replace(SPECIFIER, "");
    const matches = paths.includes(rest) ? [rest] : paths.filter((p) => p.endsWith(`/${rest}`));
    if (matches.length === 1) files.add(matches[0]);
    else ambiguous.push(token);
  }
  return { files: [...files], ambiguous, invented };
}

/** The check as a score on a run. */
export function pathFeedback(text: string, shown: Iterable<string>) {
  const { named, invented } = checkPaths(text, shown);
  return {
    key: ONLY_SHOWN_PATHS,
    score: invented.length === 0 ? 1 : 0,
    comment:
      invented.length === 0
        ? `All ${named.length} paths named were shown`
        : `Not shown: ${invented.join(", ")}`,
  };
}

/** Recognizes file paths, excluding URL fragments and bare filenames outside source-code formatting. */
function pathShaped(token: string, code: boolean): boolean {
  // What's left of a URL once the colon ends the candidate.
  if (token.startsWith("//")) return false;
  if (!FILENAME.test(token)) return false;
  return token.includes("/") || (code && SOURCE.test(token));
}

/** Removes surrounding prose punctuation before checking a candidate path. */
function trim(word: string): string {
  let start = 0;
  let end = word.length;
  while (start < end && LEADING.includes(word[start])) start++;
  while (end > start && TRAILING.includes(word[end - 1])) end--;
  return word.slice(start, end);
}

/** The text split into what's inside backticks and what isn't. */
function segments(text: string): { text: string; code: boolean }[] {
  const out: { text: string; code: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(/(`+)([\s\S]+?)\1/g)) {
    out.push({ text: text.slice(last, match.index), code: false });
    out.push({ text: match[2], code: true });
    last = match.index + match[0].length;
  }
  out.push({ text: text.slice(last), code: false });
  return out;
}
