import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { noFrameworkAdapter, type FrameworkAdapter } from "../parser/adapter.ts";
import { expressAdapter } from "./express.ts";
import { nestjsAdapter } from "./nestjs.ts";
import { nextjsAdapter } from "./nextjs.ts";
import { reactAdapter } from "./react.ts";

// Checked in this order and the first match wins. Next.js comes before React
// because every Next app depends on React too, and NestJS before Express
// because Nest runs on it. React comes before Express: a package depending on
// both is a React app with a server, and its components are most of it.
const DETECTION: readonly { dependency: string; adapter: FrameworkAdapter }[] = [
  { dependency: "next", adapter: nextjsAdapter },
  { dependency: "@nestjs/core", adapter: nestjsAdapter },
  { dependency: "react", adapter: reactAdapter },
  { dependency: "express", adapter: expressAdapter },
];

/**
 * Picks the adapter for a repository from what its root package.json depends
 * on. No package.json, or no framework this knows, means no adapter: files
 * stay unidentified rather than matched against a guessed convention.
 */
export function detectAdapter(directory: string): FrameworkAdapter {
  const manifest = path.join(directory, "package.json");
  if (!existsSync(manifest)) return noFrameworkAdapter;
  const pkg: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  return DETECTION.find((d) => dependsOn(pkg, d.dependency))?.adapter ?? noFrameworkAdapter;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function dependsOn(pkg: unknown, name: string): boolean {
  if (!isRecord(pkg)) return false;
  return ["dependencies", "devDependencies"].some((field) => {
    const deps = pkg[field];
    return isRecord(deps) && name in deps;
  });
}
