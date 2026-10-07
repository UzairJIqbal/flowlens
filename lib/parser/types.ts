// The shape the parser writes. Everything after phase 3 reads this, so a
// change here is a change to a contract: bump RESULT_VERSION when it breaks.

export const RESULT_VERSION = 1;

export const EDGE_KINDS = ["import", "reexport", "dynamic"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export interface FileNode {
  /** Repository-relative, forward slashes. */
  path: string;
  /** The file's directory, repository-relative. "." for files at the root. */
  folder: string;
  lines: number;
  /** sha256 of the raw bytes, hex. */
  hash: string;
  /** What the framework adapter says this file is; null when it has no opinion. */
  role: string | null;
  fanIn: number;
  fanOut: number;
}

/** One file-to-file connection after duplicate imports between the pair are merged. */
export interface Edge {
  from: string;
  to: string;
  kinds: EdgeKind[];
  /** True only when every import behind this edge is type-only. */
  typeOnly: boolean;
}

export const EXTERNAL_REASONS = ["package", "node-builtin", "outside-repository"] as const;
export type ExternalReason = (typeof EXTERNAL_REASONS)[number];

export const EXCLUDED_REASONS = ["declaration-file", "non-code-file", "skipped-file", "excluded-directory"] as const;
export type ExcludedReason = (typeof EXCLUDED_REASONS)[number];

export const UNRESOLVED_REASONS = [
  "file-not-found",
  "alias-target-not-found",
  "subpath-import-not-found",
  "workspace-package-not-resolved",
  "non-literal-dynamic-import",
] as const;
export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];

export type ImportOutcome =
  | { status: "internal"; to: string }
  | { status: "external"; reason: ExternalReason; target: string }
  | { status: "excluded"; reason: ExcludedReason; target: string }
  | { status: "unresolved"; reason: UnresolvedReason; detail: string };

/** Every import statement the parser saw, whatever became of it. */
export interface ImportRecord {
  from: string;
  /** The module specifier as written, or the expression text for a non-literal dynamic import. */
  specifier: string;
  line: number;
  kind: EdgeKind;
  typeOnly: boolean;
  outcome: ImportOutcome;
}

export const SKIP_REASONS = ["not-js-or-ts", "declaration-file", "too-large", "symbolic-link"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export interface SkippedFile {
  path: string;
  reason: SkipReason;
  detail: string;
}

export const EXCLUDED_DIR_REASONS = ["dependencies", "hidden-directory"] as const;
export type ExcludedDirReason = (typeof EXCLUDED_DIR_REASONS)[number];

export interface ExcludedDirectory {
  path: string;
  reason: ExcludedDirReason;
}

export type OutcomeStatus = ImportOutcome["status"];

export interface OutcomeCounts {
  seen: number;
  internal: number;
  external: number;
  excluded: number;
  unresolved: number;
}

export interface Coverage {
  files: { found: number; parsed: number; skipped: number };
  imports: OutcomeCounts;
  byKind: Record<EdgeKind, OutcomeCounts>;
  unresolvedByReason: Partial<Record<UnresolvedReason, number>>;
  excludedByReason: Partial<Record<ExcludedReason, number>>;
}

export interface ParseResult {
  version: typeof RESULT_VERSION;
  /** Absolute path that was parsed. */
  root: string;
  adapter: string;
  files: FileNode[];
  edges: Edge[];
  imports: ImportRecord[];
  skipped: SkippedFile[];
  excludedDirectories: ExcludedDirectory[];
  /** Config problems that changed how imports resolve, e.g. a tsconfig whose `extends` is missing. */
  warnings: string[];
  coverage: Coverage;
}
