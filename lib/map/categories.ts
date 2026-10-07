import { NEXT_ROLES } from "../adapters/next.ts";

// The rail's categories: the roles the framework adapter gave files. Pure.

export interface CategoryCount {
  /** null is the files no convention identified. */
  role: string | null;
  count: number;
}

/** Most common first, with unidentified files last: they are a category by absence, not by kind. */
export function categoryCounts(files: readonly { role: string | null }[]): CategoryCount[] {
  const counts = new Map<string | null, number>();
  for (const f of files) counts.set(f.role, (counts.get(f.role) ?? 0) + 1);
  return [...counts]
    .map(([role, count]) => ({ role, count }))
    .sort(
      (a, b) =>
        Number(a.role === null) - Number(b.role === null) ||
        b.count - a.count ||
        ((a.role ?? "") < (b.role ?? "") ? -1 : 1),
    );
}

/** The files in a category, for dimming everything else. */
export function inCategory(files: readonly { path: string; role: string | null }[], role: string | null): Set<string> {
  return new Set(files.filter((f) => f.role === role).map((f) => f.path));
}

const COLOURED: ReadonlySet<string> = new Set(NEXT_ROLES);

/**
 * A role's colour token, defined in globals.css. Unidentified files and any
 * role without a token get none: colour says what kind a file is, and those
 * have no kind to say.
 */
export const roleColor = (role: string | null): string | null =>
  role !== null && COLOURED.has(role) ? `var(--role-${role})` : null;
