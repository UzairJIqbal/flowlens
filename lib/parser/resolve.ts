import { existsSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { ts } from "ts-morph";
import type { ExcludedDirectory, ImportOutcome, SkippedFile } from "./types.ts";
import { isSourceFile, toPosix } from "./walk.ts";

const CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"];
// "No inputs were found" — the config still carries valid resolution options.
const IGNORED_CONFIG_ERRORS = new Set([18003]);

// Used where a directory has no config above it inside the repository.
const DEFAULT_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
};

interface ParsedConfig {
  options: ts.CompilerOptions;
  fileNames: Set<string>;
  references: string[];
  cache: ts.ModuleResolutionCache;
}

export interface Resolver {
  /**
   * `require` resolves a `require()` call: the same lookup, but a package's
   * `exports` map is read with Node's "require" condition, as it is at runtime.
   */
  resolve(fromAbsolute: string, specifier: string, via?: "require"): ImportOutcome;
  warnings: string[];
}

export function createResolver(
  root: string,
  nodes: ReadonlySet<string>,
  skipped: readonly SkippedFile[],
  excludedDirectories: readonly ExcludedDirectory[],
): Resolver {
  const warnings: string[] = [];
  const skippedPaths = new Set(skipped.map((s) => s.path));
  const excludedDirs = excludedDirectories.map((d) => d.path);
  const configs = new Map<string, ParsedConfig>();
  const nearestConfig = new Map<string, string | null>();
  const relToRoot = (abs: string) => toPosix(path.relative(root, abs));

  // An install links each workspace package into node_modules. A fresh clone
  // has no install, so this host presents the same links and TypeScript still
  // resolves through each package's own package.json. Nothing is guessed: a
  // package whose exports lead nowhere in the repository stays unresolved.
  const workspaces = findWorkspacePackages(root, skipped, warnings);
  const modulesDir = path.join(root, "node_modules") + path.sep;
  const linked = (p: string): string => {
    if (!p.startsWith(modulesDir) || existsSync(p)) return p;
    const parts = p.slice(modulesDir.length).split(path.sep);
    const nameLength = parts[0].startsWith("@") ? 2 : 1;
    const dir = workspaces.get(parts.slice(0, nameLength).join("/"));
    return dir === undefined ? p : path.join(dir, ...parts.slice(nameLength));
  };
  // TypeScript checks node_modules (and @scope inside it) exist before
  // looking for a package there, so those have to be presented too.
  const virtualDirs = new Set<string>();
  for (const name of workspaces.keys()) {
    virtualDirs.add(path.join(root, "node_modules"));
    if (name.startsWith("@")) virtualDirs.add(path.join(root, "node_modules", name.split("/")[0]));
  }
  const host: ts.ModuleResolutionHost = {
    fileExists: (p) => ts.sys.fileExists(linked(p)),
    readFile: (p) => ts.sys.readFile(linked(p)),
    directoryExists: (p) => ts.sys.directoryExists(linked(p)) || virtualDirs.has(p),
    getDirectories: (p) => ts.sys.getDirectories(linked(p)),
    realpath: (p) => (ts.sys.realpath ? ts.sys.realpath(linked(p)) : linked(p)),
    getCurrentDirectory: () => root,
  };

  const loadConfig = (configPath: string): ParsedConfig => {
    const cached = configs.get(configPath);
    if (cached) return cached;
    const rel = relToRoot(configPath);
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) warnings.push(`${rel}: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`);
    const parsed = ts.parseJsonConfigFileContent(
      read.config ?? {},
      ts.sys,
      path.dirname(configPath),
      undefined,
      configPath,
    );
    for (const err of parsed.errors) {
      if (IGNORED_CONFIG_ERRORS.has(err.code)) continue;
      warnings.push(`${rel}: ${ts.flattenDiagnosticMessageText(err.messageText, " ")}`);
    }
    const options: ts.CompilerOptions = { ...parsed.options, allowJs: true };
    const entry: ParsedConfig = {
      options,
      fileNames: new Set(parsed.fileNames.map((f) => path.resolve(f))),
      references: (parsed.projectReferences ?? []).map((r) => ts.resolveProjectReferencePath(r)),
      cache: ts.createModuleResolutionCache(path.dirname(configPath), (f) => f, options),
    };
    configs.set(configPath, entry);
    return entry;
  };

  const findNearest = (dir: string): string | null => {
    const known = nearestConfig.get(dir);
    if (known !== undefined) return known;
    let found: string | null = null;
    for (const name of CONFIG_NAMES) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) {
        found = candidate;
        break;
      }
    }
    if (found === null && dir !== root) found = findNearest(path.dirname(dir));
    nearestConfig.set(dir, found);
    return found;
  };

  const defaultConfig: ParsedConfig = {
    options: DEFAULT_OPTIONS,
    fileNames: new Set(),
    references: [],
    cache: ts.createModuleResolutionCache(root, (f) => f, DEFAULT_OPTIONS),
  };

  // A solution-style tsconfig (`files: []` plus `references`) keeps its paths
  // in the referenced configs, so the governing config is whichever one
  // actually includes the file. Falls back to the nearest one.
  const configFor = (fromAbsolute: string): ParsedConfig => {
    const nearestPath = findNearest(path.dirname(fromAbsolute));
    if (nearestPath === null) return defaultConfig;
    const nearest = loadConfig(nearestPath);
    if (nearest.references.length === 0) return nearest;
    for (const candidate of [nearest, ...nearest.references.filter(existsSync).map(loadConfig)]) {
      if (candidate.fileNames.has(fromAbsolute)) return candidate;
    }
    return nearest;
  };

  // A real file on disk inside the repository: either a node, or a file we
  // deliberately left out, and if so which way.
  const classifyRepoFile = (abs: string): ImportOutcome => {
    const rel = relToRoot(abs);
    if (rel.startsWith("../") || path.isAbsolute(rel)) {
      return { status: "external", reason: "outside-repository", target: rel };
    }
    if (rel.split("/").includes("node_modules")) {
      return { status: "external", reason: "package", target: rel };
    }
    if (nodes.has(rel)) return { status: "internal", to: rel };
    const declaration = /\.d\.([mc]?)ts$/.exec(rel);
    if (declaration) {
      // TypeScript prefers foo.d.ts over foo.js, but what runs is foo.js.
      const runtime = `${rel.slice(0, declaration.index)}.${declaration[1]}js`;
      if (nodes.has(runtime)) return { status: "internal", to: runtime };
      return { status: "excluded", reason: "declaration-file", target: rel };
    }
    if (excludedDirs.some((d) => rel.startsWith(`${d}/`))) {
      return { status: "excluded", reason: "excluded-directory", target: rel };
    }
    if (!isSourceFile(rel)) return { status: "excluded", reason: "non-code-file", target: rel };
    if (skippedPaths.has(rel)) return { status: "excluded", reason: "skipped-file", target: rel };
    // Every source file under the root was either walked or skipped with a
    // reason, so reaching here is a parser bug, not an import outcome.
    throw new Error(`Resolved to ${rel}, which the walk neither kept nor skipped`);
  };

  const existingFile = (abs: string): boolean => existsSync(abs) && statSync(abs).isFile();

  const resolve = (fromAbsolute: string, specifier: string, via?: "require"): ImportOutcome => {
    const config = configFor(fromAbsolute);
    const mode = via === "require" ? ts.ModuleKind.CommonJS : undefined;
    const resolved = ts.resolveModuleName(specifier, fromAbsolute, config.options, host, config.cache, undefined, mode)
      .resolvedModule;

    if (resolved) {
      const file = path.resolve(resolved.resolvedFileName);
      const rel = relToRoot(file);
      // Reached through node_modules but landing in the repository's own
      // source means a workspace package: that's an internal edge.
      if (resolved.isExternalLibraryImport && (rel.startsWith("../") || rel.split("/").includes("node_modules"))) {
        return { status: "external", reason: "package", target: packageName(specifier) };
      }
      return classifyRepoFile(file);
    }

    if (specifier.startsWith("node:") || builtinModules.includes(specifier)) {
      return { status: "external", reason: "node-builtin", target: specifier };
    }

    // TypeScript only resolves code. A specifier naming an existing file
    // exactly (a stylesheet, an image) is real, just not a node.
    if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
      const target = path.resolve(path.dirname(fromAbsolute), specifier);
      if (existingFile(target)) return classifyRepoFile(target);
      return { status: "unresolved", reason: "file-not-found", detail: `no file at ${relToRoot(target)}` };
    }

    if (specifier.startsWith("#")) {
      return {
        status: "unresolved",
        reason: "subpath-import-not-found",
        detail: `no package.json "imports" entry resolves ${specifier}`,
      };
    }

    const alias = matchPaths(specifier, config.options);
    if (alias !== null) {
      for (const candidate of alias.candidates) {
        if (existingFile(candidate)) return classifyRepoFile(candidate);
      }
      const tried = alias.candidates.map(relToRoot).join(", ");
      return {
        status: "unresolved",
        reason: "alias-target-not-found",
        detail: `matches paths "${alias.pattern}" but no file at ${tried}`,
      };
    }

    const pkg = packageName(specifier);
    const workspace = workspaces.get(pkg);
    if (workspace !== undefined) {
      return {
        status: "unresolved",
        reason: "workspace-package-not-resolved",
        detail: `${pkg} is the package at ${relToRoot(workspace)}, but its package.json leads to no file in the repository`,
      };
    }
    return { status: "external", reason: "package", target: pkg };
  };

  return { resolve, warnings };
}

/** Package name to directory, for every named package.json in the repository. */
function findWorkspacePackages(
  root: string,
  skipped: readonly SkippedFile[],
  warnings: string[],
): Map<string, string> {
  const dirsByName = new Map<string, string[]>();
  for (const file of skipped) {
    if (path.posix.basename(file.path) !== "package.json") continue;
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(path.join(root, file.path), "utf8"));
    } catch {
      warnings.push(`${file.path}: not valid JSON, not used as a workspace package`);
      continue;
    }
    if (typeof data !== "object" || data === null || !("name" in data) || typeof data.name !== "string") continue;
    const dirs = dirsByName.get(data.name) ?? [];
    dirs.push(path.join(root, path.posix.dirname(file.path)));
    dirsByName.set(data.name, dirs);
  }
  const result = new Map<string, string>();
  for (const [name, dirs] of dirsByName) {
    if (dirs.length === 1) {
      result.set(name, dirs[0]);
    } else {
      // Picking one would be a guess about which the import means.
      warnings.push(`package name ${name} is declared ${dirs.length} times, not linked`);
    }
  }
  return result;
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function matchPaths(
  specifier: string,
  options: ts.CompilerOptions,
): { pattern: string; candidates: string[] } | null {
  const paths = options.paths;
  if (!paths) return null;
  const base =
    typeof options.pathsBasePath === "string"
      ? options.pathsBasePath
      : typeof options.baseUrl === "string"
        ? options.baseUrl
        : null;
  if (base === null) return null;

  for (const [pattern, targets] of Object.entries(paths)) {
    const star = pattern.indexOf("*");
    let captured: string | null = null;
    if (star === -1) {
      if (pattern === specifier) captured = "";
    } else {
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (
        specifier.length >= prefix.length + suffix.length &&
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix)
      ) {
        captured = specifier.slice(prefix.length, specifier.length - suffix.length);
      }
    }
    if (captured === null) continue;
    const value = captured;
    return {
      pattern,
      candidates: targets.map((t) => path.resolve(base, t.replace("*", value))),
    };
  }
  return null;
}
