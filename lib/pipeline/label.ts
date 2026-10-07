import { readFile } from "node:fs/promises";
import path from "node:path";
import { classifyBatch, type Unidentified } from "../ai/classify.ts";
import { pipelineCache } from "../ai/cache.ts";
import { neighbours } from "../map/detail.ts";
import type { ParseResult } from "../parser/index.ts";
import type { ModelRole } from "../taxonomy.ts";

// Batches keep the number of model calls small; a fixed order keeps the same
// files in the same batches, so an unchanged repository hits the cache.
const BATCH_FILES = 20;
const CONCURRENT_BATCHES = 4;

export interface Labelled {
  roles: Map<string, ModelRole>;
  /** Files sent to the model. */
  asked: number;
  /** Batches that failed, with why; their files stay unlabelled. */
  failures: { files: number; reason: string }[];
}

/**
 * Labels every file the adapter left unidentified. A batch that fails leaves
 * its files unlabelled and is reported, rather than failing the analysis: the
 * map is complete without labels, and a label is never guessed in.
 */
export async function labelUnidentified(
  organizationId: string,
  framework: string | null,
  result: ParseResult,
): Promise<Labelled> {
  const cache = pipelineCache(organizationId);
  const around = neighbours(
    result.files.map((f) => f.path),
    result.edges,
  );
  const unidentified = result.files.filter((f) => f.role === null);

  const batches: (typeof unidentified)[] = [];
  for (let i = 0; i < unidentified.length; i += BATCH_FILES) batches.push(unidentified.slice(i, i + BATCH_FILES));

  const roles = new Map<string, ModelRole>();
  const failures: Labelled["failures"] = [];
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      try {
        const files: Unidentified[] = await Promise.all(
          batch.map(async (f) => ({
            path: f.path,
            hash: f.hash,
            lines: f.lines,
            ...around.get(f.path)!,
            // Read whole, so the model can be told how much of it was cut.
            source: await readFile(path.join(result.root, f.path), "utf8"),
          })),
        );
        for (const [file, role] of await classifyBatch(framework, files, cache)) if (role !== null) roles.set(file, role);
      } catch (error) {
        failures.push({ files: batch.length, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENT_BATCHES, batches.length) }, worker));
  return { roles, asked: unidentified.length, failures };
}
