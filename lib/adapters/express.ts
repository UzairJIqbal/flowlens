import type { FrameworkAdapter, SourceText } from "../parser/adapter.ts";
import type { ExpressRole } from "../taxonomy.ts";
import { isRootConfig } from "./conventions.ts";

// Express itself names no files. Its apps are laid out by folder instead, and
// a file's role is the innermost folder on its path that names one. Real
// repositories spell those folders both ways, so each role takes either.
//
// A config/ folder gets no role: it's the app's own settings, imported like
// any module, where "config" everywhere else means a tool's config file.
//
// No routes. Express assembles them at runtime from routers mounted on
// prefixes held in variables and passed through middleware, so no single
// place in the syntax holds a full pattern.

const FOLDERS: Record<string, Exclude<ExpressRole, "config" | "test">> = {
  route: "router",
  routes: "router",
  router: "router",
  routers: "router",
  controller: "controller",
  controllers: "controller",
  middleware: "middleware",
  middlewares: "middleware",
  validation: "validator",
  validations: "validator",
  validator: "validator",
  validators: "validator",
  service: "service",
  services: "service",
  model: "model",
  models: "model",
};

const TEST_FOLDERS = new Set(["test", "tests", "__tests__"]);
// Jest's and Mocha's default test file names.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

function roleOf(file: SourceText): ExpressRole | null {
  const folders = file.path.split("/").slice(0, -1);
  // A test of a middleware sits in tests/middlewares; it's still a test.
  if (TEST_FILE.test(file.path) || folders.some((f) => TEST_FOLDERS.has(f))) return "test";
  for (let i = folders.length - 1; i >= 0; i -= 1) {
    if (Object.hasOwn(FOLDERS, folders[i])) return FOLDERS[folders[i]];
  }
  return isRootConfig(file.path) ? "config" : null;
}

export const expressAdapter: FrameworkAdapter = {
  name: "express",
  roleOf,
  routes: () => ({ routes: [], withheld: [] }),
};
