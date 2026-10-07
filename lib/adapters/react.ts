import type { FrameworkAdapter, SourceText } from "../parser/adapter.ts";
import type { ReactRole } from "../taxonomy.ts";
import { CODE, isRootConfig, reactRoleOf } from "./conventions.ts";

// React alone: the naming rules Next.js apps follow too, plus the file the
// build tool's HTML page loads (Vite's src/main.tsx, Create React App's
// src/index.js), which nothing imports.
//
// No routes. A client-side router assembles its URLs from nested elements at
// runtime, so no single place in the syntax holds a full pattern.

const ENTRY = new RegExp(String.raw`^src/(?:main|index)${CODE}$`);

function roleOf(file: SourceText): ReactRole | null {
  if (ENTRY.test(file.path)) return "entry";
  if (isRootConfig(file.path)) return "config";
  return reactRoleOf(file.path);
}

export const reactAdapter: FrameworkAdapter = {
  name: "react",
  roleOf,
  routes: () => ({ routes: [], withheld: [] }),
};
