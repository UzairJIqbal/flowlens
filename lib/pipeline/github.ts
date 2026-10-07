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

const API_HEADERS = {
  "User-Agent": "flowlens",
  "X-GitHub-Api-Version": "2022-11-28",
};

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
  if (response.status === 404) {
    throw new Error(`github.com/${owner}/${name} doesn't exist or isn't public`);
  }
  if (response.status === 409) {
    throw new Error(`github.com/${owner}/${name} has no commits`);
  }
  if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const at = Number.isFinite(reset) ? ` until ${new Date(reset * 1000).toISOString().slice(11, 16)} UTC` : "";
    throw new Error(`GitHub's limit for unauthenticated requests is used up${at}`);
  }
  throw new Error(`GitHub answered ${response.status} when asked for the latest commit`);
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
