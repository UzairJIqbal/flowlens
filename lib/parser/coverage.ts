import type { Coverage, EdgeKind, ImportRecord, OutcomeCounts } from "./types.ts";

const empty = (): OutcomeCounts => ({ seen: 0, internal: 0, external: 0, excluded: 0, unresolved: 0 });

export function summarize(
  files: { found: number; parsed: number; skipped: number },
  imports: readonly ImportRecord[],
): Coverage {
  const total = empty();
  const byKind: Record<EdgeKind, OutcomeCounts> = {
    import: empty(),
    reexport: empty(),
    dynamic: empty(),
    require: empty(),
  };
  const unresolvedByReason: Coverage["unresolvedByReason"] = {};
  const excludedByReason: Coverage["excludedByReason"] = {};

  for (const record of imports) {
    const { outcome } = record;
    for (const counts of [total, byKind[record.kind]]) {
      counts.seen += 1;
      counts[outcome.status] += 1;
    }
    if (outcome.status === "unresolved") {
      unresolvedByReason[outcome.reason] = (unresolvedByReason[outcome.reason] ?? 0) + 1;
    } else if (outcome.status === "excluded") {
      excludedByReason[outcome.reason] = (excludedByReason[outcome.reason] ?? 0) + 1;
    }
  }

  return { files, imports: total, byKind, unresolvedByReason, excludedByReason };
}
