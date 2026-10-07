import { statSync } from "node:fs";
import path from "node:path";
import { noFrameworkAdapter, type FrameworkAdapter } from "./adapter.ts";
import { summarize } from "./coverage.ts";
import { extractImports } from "./extract.ts";
import { buildEdges, fanInOut } from "./graph.ts";
import { createResolver } from "./resolve.ts";
import { RESULT_VERSION, type ImportOutcome, type ImportRecord, type ParseResult } from "./types.ts";
import { walk } from "./walk.ts";

export type { FrameworkAdapter } from "./adapter.ts";
export { noFrameworkAdapter } from "./adapter.ts";
export * from "./types.ts";

/** Path in, data out. Reads the disk under `directory` and nothing else. */
export function parseRepository(directory: string, adapter: FrameworkAdapter = noFrameworkAdapter): ParseResult {
  const root = path.resolve(directory);
  if (!statSync(root).isDirectory()) throw new Error(`${root} is not a directory`);

  const walked = walk(root);
  const nodePaths = new Set(walked.files.map((f) => f.path));
  const resolver = createResolver(root, nodePaths, walked.skipped, walked.excludedDirectories);

  const imports: ImportRecord[] = [];
  for (const file of walked.files) {
    for (const raw of extractImports(`/${file.path}`, file.text)) {
      const outcome: ImportOutcome =
        raw.specifier === null
          ? { status: "unresolved", reason: "non-literal-dynamic-import", detail: `import(${raw.text})` }
          : resolver.resolve(file.absolute, raw.specifier);
      imports.push({
        from: file.path,
        specifier: raw.specifier ?? raw.text,
        line: raw.line,
        kind: raw.kind,
        typeOnly: raw.typeOnly,
        outcome,
      });
    }
  }

  const edges = buildEdges(imports);
  const fan = fanInOut([...nodePaths], edges);
  const files = walked.files.map((f) => ({
    path: f.path,
    folder: f.folder,
    lines: f.lines,
    hash: f.hash,
    role: adapter.roleOf({ path: f.path, text: f.text }),
    fanIn: fan.get(f.path)?.fanIn ?? 0,
    fanOut: fan.get(f.path)?.fanOut ?? 0,
  }));

  const counts = {
    found: walked.files.length + walked.skipped.length,
    parsed: walked.files.length,
    skipped: walked.skipped.length,
  };

  return {
    version: RESULT_VERSION,
    root,
    adapter: adapter.name,
    files,
    edges,
    imports,
    skipped: walked.skipped,
    excludedDirectories: walked.excludedDirectories,
    warnings: resolver.warnings,
    coverage: summarize(counts, imports),
  };
}
