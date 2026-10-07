import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExcludedDirectory, SkippedFile } from "./types.ts";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const DECLARATION = /\.d\.[mc]?ts$/;
// Above this a file is almost always generated or vendored, and parsing it
// would dominate the run for no structural information.
const MAX_BYTES = 1_000_000;

export interface WalkedFile {
  path: string;
  absolute: string;
  folder: string;
  text: string;
  lines: number;
  hash: string;
}

export interface WalkResult {
  files: WalkedFile[];
  skipped: SkippedFile[];
  excludedDirectories: ExcludedDirectory[];
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function folderOf(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  return dir === "" ? "." : dir;
}

export function isSourceFile(relPath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(relPath)) && !DECLARATION.test(relPath);
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

// Whole directories are kept, never a top-N cut: keeping a file while dropping
// the leaf it imports produces edges to nodes that don't exist. The only
// directories left out are ones that are never the repository's own source.
export function walk(root: string): WalkResult {
  const result: WalkResult = { files: [], skipped: [], excludedDirectories: [] };

  const visit = (absDir: string): void => {
    const entries = readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const absolute = path.join(absDir, entry.name);
      const rel = toPosix(path.relative(root, absolute));

      if (entry.isSymbolicLink()) {
        // Following links can leave the repository or loop; say so instead.
        result.skipped.push({ path: rel, reason: "symbolic-link", detail: "not followed" });
        continue;
      }

      if (entry.isDirectory()) {
        if (entry.name === "node_modules") {
          result.excludedDirectories.push({ path: rel, reason: "dependencies" });
        } else if (entry.name.startsWith(".")) {
          result.excludedDirectories.push({ path: rel, reason: "hidden-directory" });
        } else {
          visit(absolute);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      if (DECLARATION.test(entry.name)) {
        result.skipped.push({ path: rel, reason: "declaration-file", detail: "types only, no runtime imports" });
        continue;
      }
      const ext = path.extname(entry.name);
      if (!SOURCE_EXTENSIONS.has(ext)) {
        result.skipped.push({ path: rel, reason: "not-js-or-ts", detail: ext === "" ? "no extension" : ext });
        continue;
      }

      const bytes = readFileSync(absolute);
      if (bytes.length > MAX_BYTES) {
        result.skipped.push({ path: rel, reason: "too-large", detail: `${bytes.length} bytes, limit ${MAX_BYTES}` });
        continue;
      }

      const text = bytes.toString("utf8");
      result.files.push({
        path: rel,
        absolute,
        folder: folderOf(rel),
        text,
        lines: countLines(text),
        hash: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  };

  visit(root);
  return result;
}
