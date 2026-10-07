import type { FrameworkAdapter } from "../parser/adapter.ts";

// Next.js conventions, read from a file's path alone. Each role here is a file
// the framework reaches on its own, without anything importing it.
//
// Only the repository root and `src/` count as the project. A Next app nested
// in a monorepo package isn't recognised: its files stay unidentified rather
// than being matched by a pattern that would also catch unrelated folders.

export const NEXT_ROLES = ["page", "layout", "boundary", "route", "middleware", "instrumentation", "config"] as const;
export type NextRole = (typeof NEXT_ROLES)[number];

const CODE = String.raw`\.(?:[cm]?[jt]s|[jt]sx)`;

/** Special files inside the app router, by file name without extension. */
const APP_FILES: Record<string, NextRole> = {
  page: "page",
  // A parallel route's fallback renders in place of a page.
  default: "page",
  layout: "layout",
  template: "layout",
  loading: "boundary",
  error: "boundary",
  "global-error": "boundary",
  "not-found": "boundary",
  forbidden: "boundary",
  unauthorized: "boundary",
  route: "route",
  // Metadata files are served at their own URL, as route handlers.
  sitemap: "route",
  robots: "route",
  manifest: "route",
  icon: "route",
  "apple-icon": "route",
  "opengraph-image": "route",
  "twitter-image": "route",
};

/** Pages router files that aren't pages, by path inside `pages/` without extension. */
const PAGES_FILES: Record<string, NextRole> = {
  _app: "layout",
  _document: "layout",
  _error: "boundary",
  "404": "boundary",
  "500": "boundary",
};

const APP = new RegExp(String.raw`^(?:src/)?app/(?:(.*)/)?([^/]+)${CODE}$`);
const PAGES = new RegExp(String.raw`^(?:src/)?pages/(.+)${CODE}$`);
const TOP_LEVEL = new RegExp(String.raw`^(?:src/)?(middleware|proxy|instrumentation|instrumentation-client)${CODE}$`);
// Tool configuration at the repository root: next.config.js, tailwind.config.ts, .eslintrc.cjs.
const CONFIG = new RegExp(String.raw`^(?:[^/]+\.config|\.[^/]+rc)${CODE}$`);

function roleOf(path: string): NextRole | null {
  const app = APP.exec(path);
  if (app) {
    const [, dirs = "", name] = app;
    // A folder starting with "_" is private: Next leaves everything under it out of routing.
    if (dirs.split("/").some((d) => d.startsWith("_"))) return null;
    return APP_FILES[name] ?? null;
  }

  const pages = PAGES.exec(path);
  if (pages) {
    const [, inside] = pages;
    if (inside === "api" || inside.startsWith("api/")) return "route";
    return PAGES_FILES[inside] ?? "page";
  }

  const top = TOP_LEVEL.exec(path);
  if (top) return top[1].startsWith("instrumentation") ? "instrumentation" : "middleware";

  return CONFIG.test(path) ? "config" : null;
}

export const nextAdapter: FrameworkAdapter = {
  name: "next",
  roleOf: (file) => roleOf(file.path),
};
