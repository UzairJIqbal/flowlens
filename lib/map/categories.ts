import { frameworkOf, type RoleInfo } from "../taxonomy.ts";

// The rail's categories: the roles the framework adapter gave files, named and
// ordered by the taxonomy. Pure.

export interface CategoryCount {
  /** null is the files no convention identified. */
  role: string | null;
  count: number;
}

export interface Kinds {
  /** The framework's name, or null when none was detected. */
  framework: string | null;
  /** Whether the framework has a route convention at all. */
  routed: boolean;
  /** The rail's name for a role. */
  label(role: string | null): string;
  /** One file of a role, for the detail pane. */
  one(role: string | null): string;
  /** A role's colour token, or null for a role that has none. */
  color(role: string | null): string | null;
  /**
   * Whether files of a role are known to be reached through an import. A file
   * whose role says the framework reaches it some other way isn't unused just
   * because nothing imports it.
   */
  importedToBeReached(role: string | null): boolean;
}

/**
 * What a run's roles are called and how they look, for the adapter it ran
 * with. A role the taxonomy doesn't list (from an analysis stored before it
 * changed) keeps its raw id, gets no colour, and is never called unused.
 */
export function kindsOf(adapter: string): Kinds {
  const framework = frameworkOf(adapter);
  const info = new Map<string, RoleInfo>(framework.roles.map((r) => [r.role, r]));
  return {
    framework: framework.label,
    routed: framework.routes,
    label: (role) => (role === null ? "Unidentified" : (info.get(role)?.label ?? role)),
    one: (role) => (role === null ? "unidentified" : (info.get(role)?.one ?? role)),
    // Colour says what kind a file is; a file with no kind, or a kind past the
    // handful that get one, has none to say.
    color: (role) => {
      const hue = role === null ? null : (info.get(role)?.hue ?? null);
      return hue === null ? null : `var(--kind-${hue})`;
    },
    importedToBeReached: (role) => {
      if (role === null) return true;
      const r = info.get(role);
      return r !== undefined && !r.reached;
    },
  };
}

/**
 * Taxonomy order, never count order, so a category is in the same place every
 * time. Roles the taxonomy doesn't list follow it, and unidentified files are
 * last: they are a category by absence, not by kind. Empty categories aren't
 * listed.
 */
export function categoryCounts(files: readonly { role: string | null }[], adapter: string): CategoryCount[] {
  const counts = new Map<string | null, number>();
  for (const f of files) counts.set(f.role, (counts.get(f.role) ?? 0) + 1);
  const order = new Map(frameworkOf(adapter).roles.map((r, i) => [r.role, i]));
  const rank = (role: string | null) => (role === null ? Infinity : (order.get(role) ?? order.size));
  return [...counts]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => rank(a.role) - rank(b.role) || ((a.role ?? "") < (b.role ?? "") ? -1 : 1));
}

/** The files in a category, for dimming everything else. */
export function inCategory(files: readonly { path: string; role: string | null }[], role: string | null): Set<string> {
  return new Set(files.filter((f) => f.role === role).map((f) => f.path));
}
