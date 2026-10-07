import { readFileSync, writeFileSync } from "node:fs";
import {
  EDGE_KINDS,
  EXCLUDED_DIR_REASONS,
  EXCLUDED_REASONS,
  EXTERNAL_REASONS,
  RESULT_VERSION,
  SKIP_REASONS,
  UNRESOLVED_REASONS,
  type ParseResult,
} from "./types.ts";

export function writeResult(file: string, result: ParseResult): void {
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
}

/**
 * Reads a written result back and checks every field against the contract.
 * A file that doesn't match throws with the path of the first bad field,
 * rather than being cast and failing somewhere downstream.
 */
export function readResult(file: string): ParseResult {
  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  assertParseResult(data);
  return data;
}

type Check = (value: unknown, at: string) => void;

const fail = (at: string, expected: string): never => {
  throw new Error(`${at}: expected ${expected}`);
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str: Check = (v, at) => void (typeof v === "string" || fail(at, "string"));
const int: Check = (v, at) =>
  void ((typeof v === "number" && Number.isInteger(v) && v >= 0) || fail(at, "non-negative integer"));
const bool: Check = (v, at) => void (typeof v === "boolean" || fail(at, "boolean"));
const nullableStr: Check = (v, at) => void (v === null || typeof v === "string" || fail(at, "string or null"));
const oneOf =
  (values: readonly string[]): Check =>
  (v, at) =>
    void ((typeof v === "string" && values.includes(v)) || fail(at, values.join(" | ")));
const array =
  (item: Check): Check =>
  (v, at) => {
    if (!Array.isArray(v)) fail(at, "array");
    (v as unknown[]).forEach((x, i) => item(x, `${at}[${i}]`));
  };
const object =
  (fields: Record<string, Check>): Check =>
  (v, at) => {
    if (!isRecord(v)) return fail(at, "object");
    for (const [key, check] of Object.entries(fields)) check(v[key], `${at}.${key}`);
  };
const partialMap =
  (keys: Check, value: Check): Check =>
  (v, at) => {
    if (!isRecord(v)) return fail(at, "object");
    for (const [k, x] of Object.entries(v)) {
      keys(k, `${at} key`);
      value(x, `${at}.${k}`);
    }
  };

const edgeKind = oneOf(EDGE_KINDS);
const unresolvedReason = oneOf(UNRESOLVED_REASONS);
const excludedReason = oneOf(EXCLUDED_REASONS);

const outcome: Check = (v, at) => {
  if (!isRecord(v)) return fail(at, "object");
  switch (v.status) {
    case "internal":
      return object({ to: str })(v, at);
    case "external":
      return object({ reason: oneOf(EXTERNAL_REASONS), target: str })(v, at);
    case "excluded":
      return object({ reason: excludedReason, target: str })(v, at);
    case "unresolved":
      return object({ reason: unresolvedReason, detail: str })(v, at);
    default:
      return fail(`${at}.status`, "internal | external | excluded | unresolved");
  }
};

const counts = object({ seen: int, internal: int, external: int, excluded: int, unresolved: int });

const parseResult = object({
  version: (v, at) => void (v === RESULT_VERSION || fail(at, `version ${RESULT_VERSION}`)),
  root: str,
  adapter: str,
  files: array(
    object({ path: str, folder: str, lines: int, hash: str, role: nullableStr, fanIn: int, fanOut: int }),
  ),
  edges: array(object({ from: str, to: str, kinds: array(edgeKind), typeOnly: bool })),
  imports: array(object({ from: str, specifier: str, line: int, kind: edgeKind, typeOnly: bool, outcome })),
  skipped: array(
    object({
      path: str,
      reason: oneOf(SKIP_REASONS),
      detail: str,
    }),
  ),
  excludedDirectories: array(object({ path: str, reason: oneOf(EXCLUDED_DIR_REASONS) })),
  warnings: array(str),
  coverage: object({
    files: object({ found: int, parsed: int, skipped: int }),
    imports: counts,
    byKind: object({ import: counts, reexport: counts, dynamic: counts }),
    unresolvedByReason: partialMap(unresolvedReason, int),
    excludedByReason: partialMap(excludedReason, int),
  }),
});

export function assertParseResult(value: unknown): asserts value is ParseResult {
  parseResult(value, "result");
}
