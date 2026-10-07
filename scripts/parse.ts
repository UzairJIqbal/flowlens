// Runs the parser against a directory and prints what it found.
//
//   pnpm parse <dir> [--out result.json] [--skipped]
//   pnpm parse --read result.json
//
// --skipped lists every skipped file instead of grouping them.
// --read loads a written result, checks it against the contract, and prints it.

import path from "node:path";
import { detectAdapter } from "../lib/adapters/index.ts";
import { parseRepository, type ParseResult } from "../lib/parser/index.ts";
import { readResult, writeResult } from "../lib/parser/io.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  args.splice(i, 2);
  return value;
};
const toggle = (name: string): boolean => {
  const i = args.indexOf(name);
  if (i !== -1) args.splice(i, 1);
  return i !== -1;
};

const readPath = flag("--read");
const outPath = flag("--out");
const listSkipped = toggle("--skipped");

let result: ParseResult;
if (readPath !== null) {
  result = readResult(path.resolve(readPath));
  console.log(`read ${readPath}: shape matches the contract (version ${result.version})\n`);
} else {
  const dir = args[0];
  if (dir === undefined) {
    console.error("usage: pnpm parse <dir> [--out result.json] [--skipped] | pnpm parse --read result.json");
    process.exit(1);
  }
  const started = performance.now();
  result = parseRepository(dir, detectAdapter(dir));
  console.log(`parsed in ${((performance.now() - started) / 1000).toFixed(1)}s\n`);
}

print(result, listSkipped);

if (outPath !== null) {
  writeResult(path.resolve(outPath), result);
  console.log(`\nwrote ${outPath}`);
}

function print(r: ParseResult, everySkip: boolean): void {
  const c = r.coverage;
  const pad = (s: string | number, n: number) => String(s).padStart(n);

  console.log(`root     ${r.root}`);
  console.log(`adapter  ${r.adapter}`);
  console.log(`files    found ${c.files.found}  parsed ${c.files.parsed}  skipped ${c.files.skipped}`);

  if (everySkip) {
    for (const s of r.skipped) console.log(`  skip  ${s.path}  ${s.reason} (${s.detail})`);
  } else {
    const groups = new Map<string, number>();
    for (const s of r.skipped) {
      // Group extensions together, but keep size details per file out of the key.
      const key = s.reason === "not-js-or-ts" ? `${s.reason} ${s.detail}` : s.reason;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    for (const [key, n] of [...groups].sort((a, b) => b[1] - a[1])) console.log(`  skip  ${pad(n, 5)}  ${key}`);
  }
  for (const d of r.excludedDirectories) console.log(`  dir   ${d.path}/  not walked: ${d.reason}`);

  const roles = new Map<string, number>();
  for (const f of r.files) roles.set(f.role ?? "unidentified", (roles.get(f.role ?? "unidentified") ?? 0) + 1);
  console.log(`roles    ${[...roles].sort((a, b) => b[1] - a[1]).map(([role, n]) => `${role} ${n}`).join("  ")}`);

  const folders = new Set(r.files.map((f) => f.folder));
  console.log(`folders  ${folders.size} distinct`);
  console.log(`edges    ${r.edges.length} (duplicate imports between a pair merged)`);

  console.log(`\nimports      seen  internal  external  excluded  unresolved`);
  const row = (label: string, k: typeof c.imports) =>
    console.log(
      `  ${label.padEnd(9)}${pad(k.seen, 6)}${pad(k.internal, 10)}${pad(k.external, 10)}${pad(k.excluded, 10)}${pad(k.unresolved, 12)}`,
    );
  row("import", c.byKind.import);
  row("reexport", c.byKind.reexport);
  row("dynamic", c.byKind.dynamic);
  row("total", c.imports);

  const excluded = Object.entries(c.excludedByReason);
  if (excluded.length > 0) {
    console.log(`\nexcluded imports`);
    for (const [reason, n] of excluded) console.log(`  ${pad(n, 5)}  ${reason}`);
  }

  const unresolved = r.imports.filter((i) => i.outcome.status === "unresolved");
  console.log(`\nunresolved imports (${unresolved.length})`);
  for (const i of unresolved) {
    if (i.outcome.status !== "unresolved") continue;
    console.log(`  ${i.from}:${i.line}  ${i.kind} "${i.specifier}"  ${i.outcome.reason}: ${i.outcome.detail}`);
  }

  console.log(`\nroutes (${r.routes.length})`);
  for (const route of r.routes) console.log(`  ${route.method.padEnd(7)} ${route.path}  ${route.file}:${route.line}`);
  if (r.withheldRoutes.length > 0) {
    console.log(`\nroutes withheld (${r.withheldRoutes.length})`);
    for (const w of r.withheldRoutes) console.log(`  ${w.file}:${w.line}  ${w.reason}`);
  }

  if (r.warnings.length > 0) {
    console.log(`\nconfig warnings`);
    for (const w of r.warnings) console.log(`  ${w}`);
  }
}
