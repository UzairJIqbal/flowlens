import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { Writable } from "node:stream";
import { promisify } from "node:util";

export interface RepositoryRef {
  owner: string;
  name: string;
}

// GitHub names are case-insensitive, so they're stored lowercased: pasting
// Vercel/Next.js and vercel/next.js must land on the same analysis.
const OWNER = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
const NAME = /^[a-z0-9._-]{1,100}$/;

/**
 * Accepts https://github.com/owner/repo, with or without the scheme, www, a
 * trailing slash or .git. Anything pointing deeper — a branch, a folder — is
 * refused rather than trimmed, because the run analyses the default branch and
 * quietly ignoring the rest would map something other than what was asked for.
 */
export function parseRepositoryUrl(input: string): RepositoryRef {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error(`"${trimmed}" is not a URL`);
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    throw new Error(`Only github.com repositories can be analysed, not ${url.hostname}`);
  }
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length !== 2) {
    throw new Error("Expected a repository URL of the form github.com/owner/repository");
  }
  const owner = parts[0].toLowerCase();
  const name = parts[1].replace(/\.git$/i, "").toLowerCase();
  if (!OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..") {
    throw new Error(`"${parts[0]}/${parts[1]}" is not a valid GitHub repository name`);
  }
  return { owner, name };
}

export interface PullRequestRef extends RepositoryRef {
  number: number;
}

/**
 * Accepts https://github.com/owner/repo/pull/N, optionally followed by one of
 * the pull request's own tabs. Anything else is refused, the same as a
 * repository URL that points deeper than the repository.
 */
export function parsePullRequestUrl(input: string): PullRequestRef {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error(`"${trimmed}" is not a URL`);
  }
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const tab = parts.length === 5 && ["files", "commits", "checks"].includes(parts[4]);
  if (parts.length < 4 || parts[2] !== "pull" || !/^[1-9][0-9]{0,9}$/.test(parts[3]) || (parts.length > 4 && !tab)) {
    throw new Error("Expected a pull request URL of the form github.com/owner/repository/pull/number");
  }
  const repo = parseRepositoryUrl(`https://${url.hostname}/${parts[0]}/${parts[1]}`);
  return { ...repo, number: Number(parts[3]) };
}

/** True for a URL pointing at a pull request rather than a repository. */
export function isPullRequestUrl(input: string): boolean {
  return /\/pull\/[0-9]+/.test(input);
}

const API_HEADERS = {
  "User-Agent": "flowlens",
  "X-GitHub-Api-Version": "2022-11-28",
};

/** Turns a failed API response into the reason a person should read. */
function apiError(response: Response, asked: string, notFound: string): Error {
  if (response.status === 404) return new Error(notFound);
  if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const at = Number.isFinite(reset) ? ` until ${new Date(reset * 1000).toISOString().slice(11, 16)} UTC` : "";
    return new Error(`GitHub's limit for unauthenticated requests is used up${at}`);
  }
  return new Error(`GitHub answered ${response.status} when asked for ${asked}`);
}

/**
 * A file GitHub lists as changed by a pull request, exactly as it reports it.
 * A type alias so it is stored as JSON without a cast.
 */
export type ChangedFile = {
  path: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  /** Set only when GitHub itself reports a rename or copy. Recorded fact, not a match this app made. */
  previousPath: string | null;
};

export interface PullRequest {
  title: string;
  /** Where the branch left its base: the commit GitHub's own changed-file list is measured against. */
  baseSha: string;
  headSha: string;
  changed: ChangedFile[];
}

/**
 * GitHub's compare API lists at most 300 files and says nothing about the
 * rest. A change list cut short would leave its blast radius cut short too, so
 * past this the pull request is refused rather than half-shown.
 */
export const MAX_CHANGED_FILES = 300;

/**
 * A preview downloads and parses the repository twice inside one request. The
 * size is GitHub's own figure for the repository, read before anything is
 * downloaded. It counts history too, so it overstates the checkout; the
 * per-archive cap below still applies to each side.
 */
export const MAX_PREVIEW_REPOSITORY_MB = 100;

const CHANGE_STATUSES = ["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"] as const;
const SHA = /^[0-9a-f]{40}$/;

/**
 * The two commits and the changed-file list of a public pull request, in two
 * unauthenticated calls. "Before" is the merge base rather than the base
 * branch's tip: commits that landed on the base branch after the pull request
 * branched aren't part of it, and comparing against the tip would show them as
 * its changes.
 */
export async function readPullRequest({ owner, name, number }: PullRequestRef): Promise<PullRequest> {
  const label = `${owner}/${name}#${number}`;
  const pr = await fetch(`https://api.github.com/repos/${owner}/${name}/pulls/${number}`, {
    headers: { ...API_HEADERS, Accept: "application/vnd.github+json" },
  });
  if (!pr.ok) throw apiError(pr, `pull request ${label}`, `${label} doesn't exist, or the repository isn't public`);
  const body: unknown = await pr.json();
  const title = field(body, "title");
  const base = field(body, "base");
  const head = field(body, "head");
  const baseTip = field(base, "sha");
  const headSha = field(head, "sha");
  const changedCount = field(body, "changed_files");
  const sizeKb = field(field(base, "repo"), "size");
  if (typeof title !== "string" || typeof baseTip !== "string" || typeof headSha !== "string" || !SHA.test(baseTip) || !SHA.test(headSha)) {
    throw new Error(`GitHub's answer for ${label} is missing its title or commits`);
  }
  if (typeof changedCount !== "number" || typeof sizeKb !== "number") {
    throw new Error(`GitHub's answer for ${label} is missing its changed-file count or repository size`);
  }

  // Both limits are checked before anything is downloaded.
  const sizeMb = sizeKb / 1024;
  if (sizeMb > MAX_PREVIEW_REPOSITORY_MB) {
    throw new Error(
      `GitHub reports ${owner}/${name} at ${Math.round(sizeMb)} MB. A preview parses the repository twice in one request, so it is limited to repositories of ${MAX_PREVIEW_REPOSITORY_MB} MB or less.`,
    );
  }
  if (changedCount > MAX_CHANGED_FILES) {
    throw new Error(
      `${label} changes ${changedCount} files. Previews are limited to ${MAX_CHANGED_FILES}, the most GitHub lists for one comparison.`,
    );
  }

  const compare = await fetch(`https://api.github.com/repos/${owner}/${name}/compare/${baseTip}...${headSha}`, {
    headers: { ...API_HEADERS, Accept: "application/vnd.github+json" },
  });
  if (!compare.ok) throw apiError(compare, `the comparison for ${label}`, `GitHub could not compare the commits of ${label}`);
  const compared: unknown = await compare.json();
  const baseSha = field(field(compared, "merge_base_commit"), "sha");
  const files = field(compared, "files");
  if (typeof baseSha !== "string" || !SHA.test(baseSha) || !Array.isArray(files)) {
    throw new Error(`GitHub's comparison for ${label} is missing its merge base or file list`);
  }
  // At the cap the list may have been cut, and nothing in the answer says whether it was.
  if (files.length >= MAX_CHANGED_FILES) {
    throw new Error(
      `GitHub's comparison for ${label} lists ${files.length} files, its limit. Previews are limited to fewer than ${MAX_CHANGED_FILES}.`,
    );
  }

  const changed = files.map((f): ChangedFile => {
    const path = field(f, "filename");
    const status = CHANGE_STATUSES.find((s) => s === field(f, "status"));
    const previous = field(f, "previous_filename");
    if (typeof path !== "string" || status === undefined) {
      throw new Error(`GitHub's comparison for ${label} has a file without a name or a known status`);
    }
    return { path, status, previousPath: typeof previous === "string" ? previous : null };
  });
  changed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { title, baseSha, headSha, changed };
}

/** One property of an unknown JSON value, or undefined when it isn't an object or lacks it. */
function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null && name in value ? (value as Record<string, unknown>)[name] : undefined;
}

/**
 * The commit the default branch points at right now. Unauthenticated, so no
 * token is requested or kept; GitHub answers 404 alike for a repository that
 * doesn't exist and one that is private.
 */
export async function resolveHead({ owner, name }: RepositoryRef): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${name}/commits/HEAD`, {
    headers: { ...API_HEADERS, Accept: "application/vnd.github.sha" },
  });

  if (response.ok) {
    const sha = (await response.text()).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`GitHub returned "${sha.slice(0, 60)}" instead of a commit`);
    return sha;
  }
  if (response.status === 409) {
    throw new Error(`github.com/${owner}/${name} has no commits`);
  }
  throw apiError(response, "the latest commit", `github.com/${owner}/${name} doesn't exist or isn't public`);
}

/**
 * One file's bytes at exactly `sha`, or null when the file isn't there.
 * raw.githubusercontent.com isn't counted against the API's unauthenticated
 * limit, which resolveHead already spends from.
 */
export async function fetchFile({ owner, name }: RepositoryRef, sha: string, file: string): Promise<Buffer | null> {
  const encoded = file.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${sha}/${encoded}`, {
    headers: { "User-Agent": API_HEADERS["User-Agent"] },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub answered ${response.status} when asked for ${file}`);
  return Buffer.from(await response.arrayBuffer());
}

// Parsing happens inside one request. An archive past this size would not
// finish there anyway, so it is refused up front and said so.
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

/** Downloads the archive of exactly `sha` to `file`. */
export async function downloadArchive({ owner, name }: RepositoryRef, sha: string, file: string): Promise<void> {
  const response = await fetch(`https://codeload.github.com/${owner}/${name}/tar.gz/${sha}`, {
    headers: { "User-Agent": API_HEADERS["User-Agent"] },
  });
  if (!response.ok || response.body === null) {
    throw new Error(`GitHub answered ${response.status} when asked for the archive`);
  }

  const tooLarge = () =>
    new Error(`The archive is larger than ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB, which is more than one run can parse`);
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_ARCHIVE_BYTES) throw tooLarge();

  // codeload usually streams without a length, so the cap is counted as it arrives.
  let received = 0;
  const cap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_ARCHIVE_BYTES) controller.error(tooLarge());
      else controller.enqueue(chunk);
    },
  });
  await response.body.pipeThrough(cap).pipeTo(Writable.toWeb(createWriteStream(file)));
}

const run = promisify(execFile);

/**
 * Unpacks with the system tar, dropping GitHub's `owner-repo-sha/` wrapper.
 * Both bsdtar and GNU tar refuse absolute paths and `..`, and won't write
 * through a symlink the archive itself created.
 */
export async function extractArchive(file: string, directory: string): Promise<void> {
  try {
    await run("tar", ["-xzf", file, "-C", directory, "--strip-components=1"]);
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String(error.stderr).trim() : "";
    throw new Error(`Could not unpack the archive${stderr ? `: ${stderr}` : ""}`);
  }
}
