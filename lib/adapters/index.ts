import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { noFrameworkAdapter, type FrameworkAdapter } from "../parser/adapter.ts";
import { nextAdapter } from "./next.ts";

/**
 * Picks the adapter for a repository from what its root package.json depends
 * on. No package.json, or no framework this knows, means no adapter: files
 * stay unidentified rather than matched against a guessed convention.
 */
export function detectAdapter(directory: string): FrameworkAdapter {
  const manifest = path.join(directory, "package.json");
  if (!existsSync(manifest)) return noFrameworkAdapter;
  const pkg: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  return dependsOn(pkg, "next") ? nextAdapter : noFrameworkAdapter;
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
