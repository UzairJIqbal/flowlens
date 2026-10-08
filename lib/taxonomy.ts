// What each framework's files are called, in the order the rail lists them.
// Imports nothing, so the browser can read it without pulling in a parser or a
// filesystem. The adapters import their role names from here, never the
// other way round.
//
// Order is reading order and never depends on counts: routable surfaces
// first, then the layers behind them, then plumbing. The same repository
// always puts the same category in the same place.

/** Which kind colour a category gets. A handful per framework; the rest get none. */
export type Hue = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface RoleInfo {
  role: string;
  /** The rail's name: the concrete thing, as the framework's own docs call it. */
  label: string;
  /** One file of this kind, for the detail pane. */
  one: string;
  /**
   * The framework reaches these files without anything importing them, so a
   * file of this kind that nothing imports is not unused.
   */
  reached: boolean;
  hue: Hue | null;
}

const NEXTJS = [
  { role: "page", label: "Page routes", one: "page route", reached: true, hue: 1 },
  { role: "endpoint", label: "API endpoints", one: "API endpoint", reached: true, hue: 2 },
  // Imported by the components that call them, so unused when nothing does.
  { role: "action", label: "Server actions", one: "server actions", reached: false, hue: 3 },
  { role: "metadata", label: "Metadata routes", one: "metadata route", reached: true, hue: null },
  { role: "layout", label: "Layouts", one: "layout", reached: true, hue: 4 },
  { role: "boundary", label: "Loading & error UI", one: "loading or error UI", reached: true, hue: 5 },
  { role: "component", label: "Components", one: "component", reached: false, hue: 6 },
  { role: "hook", label: "Hooks", one: "hook", reached: false, hue: 7 },
  { role: "middleware", label: "Middleware", one: "middleware", reached: true, hue: null },
  { role: "instrumentation", label: "Instrumentation", one: "instrumentation", reached: true, hue: null },
  { role: "config", label: "Config", one: "config", reached: true, hue: null },
] as const satisfies readonly RoleInfo[];

// Everything here but the entry point is wired up by imports from a module,
// so the import graph sees it.
const NESTJS = [
  { role: "controller", label: "Controllers", one: "controller", reached: false, hue: 1 },
  { role: "resolver", label: "Resolvers", one: "resolver", reached: false, hue: null },
  { role: "gateway", label: "Gateways", one: "gateway", reached: false, hue: null },
  { role: "service", label: "Services", one: "service", reached: false, hue: 2 },
  { role: "module", label: "Modules", one: "module", reached: false, hue: 3 },
  { role: "entity", label: "Entities", one: "entity", reached: false, hue: 4 },
  { role: "repository", label: "Repositories", one: "repository", reached: false, hue: 5 },
  { role: "schema", label: "Schemas", one: "schema", reached: false, hue: null },
  { role: "dto", label: "DTOs", one: "DTO", reached: false, hue: 6 },
  { role: "guard", label: "Guards", one: "guard", reached: false, hue: 7 },
  { role: "interceptor", label: "Interceptors", one: "interceptor", reached: false, hue: null },
  { role: "pipe", label: "Pipes", one: "pipe", reached: false, hue: null },
  { role: "filter", label: "Exception filters", one: "exception filter", reached: false, hue: null },
  { role: "middleware", label: "Middleware", one: "middleware", reached: false, hue: null },
  { role: "strategy", label: "Strategies", one: "strategy", reached: false, hue: null },
  { role: "decorator", label: "Decorators", one: "decorator", reached: false, hue: null },
  { role: "entry", label: "Entry point", one: "entry point", reached: true, hue: null },
  { role: "config", label: "Config", one: "config", reached: true, hue: null },
  { role: "test", label: "Tests", one: "test", reached: true, hue: null },
] as const satisfies readonly RoleInfo[];

const REACT = [
  { role: "entry", label: "Entry point", one: "entry point", reached: true, hue: 1 },
  { role: "component", label: "Components", one: "component", reached: false, hue: 6 },
  { role: "hook", label: "Hooks", one: "hook", reached: false, hue: 7 },
  { role: "config", label: "Config", one: "config", reached: true, hue: null },
] as const satisfies readonly RoleInfo[];

// Wired up by imports from the app file, so the import graph sees them.
const EXPRESS = [
  { role: "router", label: "Routers", one: "router", reached: false, hue: 1 },
  { role: "controller", label: "Controllers", one: "controller", reached: false, hue: 2 },
  { role: "middleware", label: "Middleware", one: "middleware", reached: false, hue: 3 },
  { role: "validator", label: "Validators", one: "validator", reached: false, hue: null },
  { role: "service", label: "Services", one: "service", reached: false, hue: 4 },
  { role: "model", label: "Models", one: "model", reached: false, hue: 5 },
  { role: "config", label: "Config", one: "config", reached: true, hue: null },
  { role: "test", label: "Tests", one: "test", reached: true, hue: null },
] as const satisfies readonly RoleInfo[];

export type NextjsRole = (typeof NEXTJS)[number]["role"];
export type NestjsRole = (typeof NESTJS)[number]["role"];
export type ReactRole = (typeof REACT)[number]["role"];
export type ExpressRole = (typeof EXPRESS)[number]["role"];

export interface Framework {
  /** The name people know it by; null for no framework. */
  label: string | null;
  /** Whether the framework has a convention routes can be read from. */
  routes: boolean;
  roles: readonly RoleInfo[];
}

/** Keyed by adapter name. */
const FRAMEWORKS: Record<string, Framework> = {
  nextjs: { label: "Next.js", routes: true, roles: NEXTJS },
  nestjs: { label: "NestJS", routes: true, roles: NESTJS },
  // Routing in a React app belongs to whichever router library it uses.
  react: { label: "React", routes: false, roles: REACT },
  // Routes are assembled at runtime; see the adapter.
  express: { label: "Express", routes: false, roles: EXPRESS },
};

const NONE: Framework = { label: null, routes: false, roles: [] };

/**
 * The only roles a model may give a file no convention identified. None of
 * them is routable: page, route and controller decide the route table and the
 * entry-point colouring, and only convention may say those. The database
 * refuses anything else from the model too.
 */
export const MODEL_ROLES = ["service", "repository", "model", "util", "config", "component", "hook"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/** An adapter name nothing here knows, including "none", gets no categories. */
export const frameworkOf = (adapter: string): Framework => FRAMEWORKS[adapter] ?? NONE;
