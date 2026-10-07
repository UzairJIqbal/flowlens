import { Node, type ClassDeclaration, type Decorator, type SourceFile } from "ts-morph";
import type { FrameworkAdapter, SourceText } from "../parser/adapter.ts";
import type { Route, WithheldRoute } from "../parser/types.ts";
import type { NestjsRole } from "../taxonomy.ts";
import { isRootConfig } from "./conventions.ts";
import { importedNames, literal, literals, withSource } from "./syntax.ts";

// NestJS conventions. Roles come from the filename suffixes the Nest CLI
// writes (users.controller.ts). Routes come from decorators: the controller's
// path and the method's path together, each read only when it is a literal,
// under any prefix main.ts sets for the whole app.

/** The CLI's file suffixes, each naming the role it marks. */
const SUFFIXES: Record<string, NestjsRole> = {
  controller: "controller",
  resolver: "resolver",
  gateway: "gateway",
  service: "service",
  module: "module",
  entity: "entity",
  repository: "repository",
  schema: "schema",
  dto: "dto",
  guard: "guard",
  interceptor: "interceptor",
  pipe: "pipe",
  filter: "filter",
  middleware: "middleware",
  strategy: "strategy",
  decorator: "decorator",
};
const SUFFIX = /\.([a-z]+)\.[cm]?[jt]s$/;
const TEST = /\.(?:spec|e2e-spec|test)\.[cm]?[jt]s$/;
const ENTRY = /(?:^|\/)src\/main\.[cm]?[jt]s$/;

function roleOf(file: SourceText): NestjsRole | null {
  if (TEST.test(file.path)) return "test";
  const suffix = SUFFIX.exec(file.path)?.[1];
  if (suffix !== undefined && Object.hasOwn(SUFFIXES, suffix)) return SUFFIXES[suffix];
  if (ENTRY.test(file.path)) return "entry";
  return isRootConfig(file.path) ? "config" : null;
}

// ---------------------------------------------------------------------------
// Routes.
// ---------------------------------------------------------------------------

/** @nestjs/common's route decorators, by export name, and the method each registers. */
const HTTP_DECORATORS: Record<string, string> = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Delete: "DELETE",
  Patch: "PATCH",
  Options: "OPTIONS",
  Head: "HEAD",
  Search: "SEARCH",
  // Registered for every method; "ALL" is what Nest calls it.
  All: "ALL",
};

const COMPILED = /Object\.defineProperty\(exports,\s*["']__esModule["']/;

/** What main.ts-style setup does to every route's path. */
type AppPrefix = { prefix: string } | { reason: string };

/**
 * Reads the calls that change every route at once. Any of them that can't be
 * read exactly withholds every route, because each one's pattern would be
 * missing the same unknown piece.
 */
function appPrefix(files: readonly SourceText[]): AppPrefix {
  const prefixes: { file: string; value: string | null; options: boolean }[] = [];
  let apps = 0;
  for (const file of files) {
    if (!/setGlobalPrefix|enableVersioning|RouterModule|NestFactory/.test(file.text)) continue;
    // TypeScript's CommonJS output marks itself this way and nobody writes it by
    // hand, so a committed dist/main.js is the same setup as src/main.ts, not a
    // second one. ES module output carries no mark; it's counted, and a second
    // prefix withholds every route, which is wrong in the safe direction.
    if (COMPILED.test(file.text)) continue;
    const reason = withSource(file, (source) => {
      const core = importedNames(source, "@nestjs/core");
      for (const node of source.getDescendants()) {
        if (Node.isIdentifier(node) && core.get(node.getText()) === "RouterModule") {
          return `RouterModule in ${file.path} puts module paths in front of routes`;
        }
        if (!Node.isCallExpression(node)) continue;
        const callee = node.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) continue;
        const name = callee.getName();
        const args = node.getArguments();
        if (name === "create" && core.get(callee.getExpression().getText()) === "NestFactory") apps += 1;
        if (name === "setGlobalPrefix") {
          prefixes.push({ file: file.path, value: literal(args[0]), options: args.length > 1 });
        }
        if (name === "enableVersioning" && changesPaths(args[0])) {
          return `URI versioning, enabled in ${file.path}, puts a version in front of routes`;
        }
      }
      return null;
    });
    if (reason !== null) return { reason };
  }

  if (prefixes.length === 0) return { prefix: "" };
  const [first] = prefixes;
  if (prefixes.length > 1) return { reason: `A global prefix is set ${prefixes.length} times (${first.file} and others)` };
  if (first.value === null) return { reason: `The global prefix in ${first.file} isn't a literal` };
  if (first.options) return { reason: `The global prefix in ${first.file} has options that exclude some routes` };
  if (apps > 1) return { reason: `${first.file} sets a global prefix for one of ${apps} Nest apps` };
  return { prefix: first.value };
}

// Header, media-type and custom versioning read the version from the request,
// not the URL. Anything else, including no options at all, is URI versioning.
function changesPaths(options: Node | undefined): boolean {
  if (options === undefined || !Node.isObjectLiteralExpression(options)) return true;
  const type = options.getProperty("type");
  if (type === undefined || !Node.isPropertyAssignment(type)) return true;
  return !/^VersioningType\.(?:HEADER|MEDIA_TYPE|CUSTOM)$/.test(type.getInitializer()?.getText() ?? "");
}

/** The paths a decorator's argument names; [""] for none, null if any has to be evaluated. */
function paths(arg: Node | undefined): string[] | null {
  if (arg === undefined) return [""];
  if (Node.isObjectLiteralExpression(arg)) {
    // @Controller({ path, host, ... }). Only `path` is part of the URL.
    if (arg.getProperties().some((p) => !Node.isPropertyAssignment(p))) return null;
    const path = arg.getProperty("path");
    if (path === undefined) return [""];
    return Node.isPropertyAssignment(path) ? literals(path.getInitializer()) : null;
  }
  return literals(arg);
}

/**
 * Joins prefix, controller and method paths the way Nest does: each gets a
 * leading slash, and "/" alone adds nothing. A piece ending in a slash is
 * withheld rather than normalised, since what Nest makes of it isn't a
 * rule this can state.
 */
function join(pieces: string[]): string | null {
  let out = "";
  for (const piece of pieces) {
    if (piece === "" || piece === "/") continue;
    if (piece.endsWith("/") || piece.includes("//")) return null;
    out += piece.startsWith("/") || piece.startsWith("{/") ? piece : `/${piece}`;
  }
  return out === "" ? "/" : out;
}

function decoratorName(decorator: Decorator, common: Map<string, string>): string | undefined {
  // `@Get` without a call isn't a route decorator, so only calls count.
  if (!decorator.isDecoratorFactory()) return undefined;
  return common.get(decorator.getName());
}

function classRoutes(
  cls: ClassDeclaration,
  common: Map<string, string>,
  file: string,
  prefix: AppPrefix,
  found: Route[],
  withheld: WithheldRoute[],
): void {
  const controllers = cls.getDecorators().filter((d) => decoratorName(d, common) === "Controller");
  const handlers = cls
    .getMethods()
    .filter((m) => !m.isStatic())
    .flatMap((m) =>
      m.getDecorators().flatMap((d) => {
        const name = decoratorName(d, common);
        return name !== undefined && Object.hasOwn(HTTP_DECORATORS, name) ? [{ decorator: d, method: HTTP_DECORATORS[name] }] : [];
      }),
    );
  if (handlers.length === 0) return;

  const withhold = (reason: string) => {
    for (const h of handlers) withheld.push({ file, line: h.decorator.getStartLineNumber(), reason });
  };
  if (controllers.length === 0) return withhold("On a class without @Controller; routes a controller inherits aren't followed");
  if (controllers.length > 1) return withhold("The class has more than one @Controller");
  if ("reason" in prefix) return withhold(prefix.reason);
  const base = paths(controllers[0].getArguments()[0]);
  if (base === null) return withhold("The @Controller path isn't a literal");

  for (const { decorator, method } of handlers) {
    const line = decorator.getStartLineNumber();
    const own = paths(decorator.getArguments()[0]);
    if (own === null) {
      withheld.push({ file, line, reason: `The @${decorator.getName()} path isn't a literal` });
      continue;
    }
    for (const b of base) {
      for (const o of own) {
        const path = join([prefix.prefix, b, o]);
        if (path === null) withheld.push({ file, line, reason: "A path piece ends in a slash" });
        else found.push({ file, line, method, path });
      }
    }
  }
}

function routes(files: readonly SourceText[]): { routes: Route[]; withheld: WithheldRoute[] } {
  const found: Route[] = [];
  const withheld: WithheldRoute[] = [];
  const prefix = appPrefix(files);
  for (const file of files) {
    if (!file.text.includes("@nestjs/common")) continue;
    withSource(file, (source: SourceFile) => {
      const common = importedNames(source, "@nestjs/common");
      if (common.size === 0) return;
      for (const cls of source.getClasses()) classRoutes(cls, common, file.path, prefix, found, withheld);
    });
  }
  return { routes: found, withheld };
}

export const nestjsAdapter: FrameworkAdapter = { name: "nestjs", roleOf, routes };
