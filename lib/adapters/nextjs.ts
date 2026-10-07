import { Node, type SourceFile } from "ts-morph";
import type { FrameworkAdapter, SourceText } from "../parser/adapter.ts";
import type { Route, WithheldRoute } from "../parser/types.ts";
import type { NextjsRole } from "../taxonomy.ts";
import { CODE, directives, isRootConfig, reactRoleOf } from "./conventions.ts";
import { literal, withSource } from "./syntax.ts";

// Next.js conventions, read from a file's path, plus the directive that makes a
// file a set of server actions. Routes come from the same paths: Next serves
// a file at the URL its folders spell, so the pattern is the path with the
// folders Next leaves out of URLs removed.
//
// Only the repository root and `src/` count as the project. A Next app nested
// in a monorepo package isn't recognised: its files stay unidentified rather
// than being matched by a pattern that would also catch unrelated folders.

/** Special files inside the app router, by file name without extension. */
const APP_FILES: Record<string, NextjsRole> = {
  page: "page",
  layout: "layout",
  template: "layout",
  loading: "boundary",
  error: "boundary",
  "global-error": "boundary",
  "not-found": "boundary",
  forbidden: "boundary",
  unauthorized: "boundary",
  // A parallel route's fallback, rendered when a slot has nothing to show.
  default: "boundary",
  route: "endpoint",
  sitemap: "metadata",
  robots: "metadata",
  manifest: "metadata",
  icon: "metadata",
  "apple-icon": "metadata",
  "opengraph-image": "metadata",
  "twitter-image": "metadata",
};

/** Pages router files that aren't pages, by path inside `pages/` without extension. */
const PAGES_FILES: Record<string, NextjsRole> = {
  _app: "layout",
  _document: "layout",
  _error: "boundary",
  "404": "boundary",
  "500": "boundary",
};

const APP = new RegExp(String.raw`^(src/)?app/(?:(.*)/)?([^/]+)${CODE}$`);
const PAGES = new RegExp(String.raw`^(src/)?pages/(.+)${CODE}$`);
const TOP_LEVEL = new RegExp(String.raw`^(?:src/)?(middleware|proxy|instrumentation|instrumentation-client)${CODE}$`);
const CONFIG_FILE = /^next\.config\.(?:[cm]?js|[cm]?ts)$/;

// The verbs a route handler may export. Any other export is not a handler.
const HANDLER_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]);

// next.config options that change the URL a file is served at, or which files
// are routes at all. With any of them set, no pattern read from a path is
// the whole pattern.
const URL_OPTIONS = ["basePath", "i18n", "pageExtensions", "trailingSlash"];

type Located =
  | { router: "app"; src: boolean; dirs: string[]; name: string }
  | { router: "pages"; src: boolean; inside: string };

function locate(path: string): Located | null {
  const app = APP.exec(path);
  if (app) {
    const [, src, dirs, name] = app;
    return { router: "app", src: src !== undefined, dirs: dirs === undefined ? [] : dirs.split("/"), name };
  }
  const pages = PAGES.exec(path);
  if (pages) return { router: "pages", src: pages[1] !== undefined, inside: pages[2] };
  return null;
}

function conventionRole(at: Located | null, path: string): NextjsRole | null {
  if (at?.router === "app") {
    // A folder starting with "_" is private: Next leaves everything under it out of routing.
    const routed = !at.dirs.some((d) => d.startsWith("_"));
    if (routed && Object.hasOwn(APP_FILES, at.name)) return APP_FILES[at.name];
  }
  if (at?.router === "pages") {
    if (at.inside === "api" || at.inside.startsWith("api/")) return "endpoint";
    return Object.hasOwn(PAGES_FILES, at.inside) ? PAGES_FILES[at.inside] : "page";
  }
  const top = TOP_LEVEL.exec(path);
  if (top) return top[1].startsWith("instrumentation") ? "instrumentation" : "middleware";
  return isRootConfig(path) ? "config" : null;
}

function roleOf(file: SourceText): NextjsRole | null {
  const role = conventionRole(locate(file.path), file.path);
  if (role !== null) return role;
  if (directives(file.text).includes("use server")) return "action";
  return reactRoleOf(file.path);
}

// ---------------------------------------------------------------------------
// Routes.
// ---------------------------------------------------------------------------

/** The URL a routed file is served at, or why it can't be written down exactly. */
function patternOf(at: Located): { path: string } | { reason: string } {
  if (at.router === "pages") {
    const segments = at.inside.split("/");
    if (segments[segments.length - 1] === "index") segments.pop();
    return { path: `/${segments.join("/")}` };
  }
  const kept: string[] = [];
  for (const dir of at.dirs) {
    // (.)photo, (..)photo, (...)photo: the URL it shows under depends on where navigation came from.
    if (/^\(\.{1,3}\)/.test(dir)) return { reason: "Intercepting route: the URL it renders under depends on navigation" };
    // (group) organises files and @slot fills part of a layout; neither is in the URL.
    if (/^\(.+\)$/.test(dir) || dir.startsWith("@")) continue;
    if (dir.includes("%")) return { reason: "Folder name is URL-encoded" };
    kept.push(dir);
  }
  return { path: `/${kept.join("/")}` };
}

/** Each handler a route file exports, by the name it's exported under, with where. */
function exportedHandlers(source: SourceFile): { methods: { name: string; line: number }[]; reexportsAll: number | null } {
  const methods: { name: string; line: number }[] = [];
  let reexportsAll: number | null = null;
  const add = (name: string, node: Node) => {
    if (HANDLER_METHODS.has(name)) methods.push({ name, line: node.getStartLineNumber() });
  };
  const bindings = (name: Node): void => {
    if (Node.isIdentifier(name)) return add(name.getText(), name);
    if (Node.isObjectBindingPattern(name) || Node.isArrayBindingPattern(name)) {
      for (const el of name.getElements()) if (Node.isBindingElement(el)) bindings(el.getNameNode());
    }
  };

  for (const statement of source.getStatements()) {
    if (Node.isFunctionDeclaration(statement) && statement.isExported() && !statement.isDefaultExport()) {
      const name = statement.getNameNode();
      if (name) add(name.getText(), statement);
    } else if (Node.isVariableStatement(statement) && statement.isExported()) {
      for (const decl of statement.getDeclarations()) bindings(decl.getNameNode());
    } else if (Node.isExportDeclaration(statement)) {
      if (!statement.hasNamedExports()) {
        if (!statement.isNamespaceExport()) reexportsAll ??= statement.getStartLineNumber();
        continue;
      }
      for (const spec of statement.getNamedExports()) {
        add(spec.getAliasNode()?.getText() ?? spec.getName(), spec);
      }
    }
  }
  return { methods, reexportsAll };
}

/** The URL-changing options a next.config sets, read from its object literals. */
function urlOptions(config: SourceText): string[] {
  return withSource(config, (source) => {
    const set = new Set<string>();
    source.forEachDescendant((node) => {
      if (!Node.isPropertyAssignment(node) && !Node.isShorthandPropertyAssignment(node)) return;
      const key = node.getNameNode();
      const name = Node.isIdentifier(key) ? key.getText() : literal(key);
      if (name === null || !URL_OPTIONS.includes(name)) return;
      // The default, written out, changes nothing.
      if (name === "trailingSlash" && Node.isPropertyAssignment(node) && node.getInitializer()?.getText() === "false") return;
      set.add(name);
    });
    return [...set];
  });
}

function routes(files: readonly SourceText[]): { routes: Route[]; withheld: WithheldRoute[] } {
  const found: Route[] = [];
  const withheld: WithheldRoute[] = [];

  const config = files.find((f) => CONFIG_FILE.test(f.path));
  const options = config === undefined ? [] : urlOptions(config);
  const configReason =
    options.length === 0 ? null : `${config?.path} sets ${options.join(", ")}, which changes the URL`;

  // Next ignores src/app and src/pages when app/ or pages/ is at the root.
  const rootRouter = files.some((f) => f.path.startsWith("app/") || f.path.startsWith("pages/"));

  for (const file of files) {
    const at = locate(file.path);
    if (at === null) continue;
    const role = conventionRole(at, file.path);
    if (role !== "page" && role !== "endpoint" && role !== "metadata") continue;

    const withhold = (reason: string, line = 1) => withheld.push({ file: file.path, line, reason });
    if (configReason !== null) {
      withhold(configReason);
      continue;
    }
    if (at.src && rootRouter) {
      withhold("Not served: Next ignores src/ when app/ or pages/ is at the root");
      continue;
    }
    if (role === "metadata") {
      withhold("Next generates this file's URL, with an extension and sometimes an id");
      continue;
    }
    if (at.router === "pages" && role === "endpoint") {
      withhold("One default export answers every method; which ones it handles is decided at runtime");
      continue;
    }

    const pattern = patternOf(at);
    if ("reason" in pattern) {
      withhold(pattern.reason);
      continue;
    }

    if (role === "page") {
      // Next serves a page on GET by definition; nothing in the file decides it.
      found.push({ file: file.path, line: 1, method: "GET", path: pattern.path });
      continue;
    }

    const { methods, reexportsAll } = withSource(file, exportedHandlers);
    for (const m of methods) found.push({ file: file.path, line: m.line, method: m.name, path: pattern.path });
    if (reexportsAll !== null) {
      withhold("Re-exports everything from another module; handlers there aren't followed", reexportsAll);
    } else if (methods.length === 0) {
      withhold("Exports no GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS handler");
    }
  }

  return { routes: found, withheld };
}

export const nextjsAdapter: FrameworkAdapter = { name: "nextjs", roleOf, routes };
