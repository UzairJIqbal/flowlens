"use client";

import { roleColor, type CategoryCount } from "@/lib/map/categories";
import type { Category } from "./map-state";

/**
 * The kinds of file in the repository. Clicking one dims everything outside it
 * on the map, so you see where it lives without losing the shape of the whole.
 */
export function CategoryRail({
  categories,
  category,
  onToggle,
}: {
  categories: CategoryCount[];
  category: Category | null;
  onToggle: (role: string | null) => void;
}) {
  return (
    <ul className="py-1 text-xs">
      {categories.map(({ role, count }) => {
        const active = category !== null && category.role === role;
        return (
          <li key={role ?? ""}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(role)}
              title={active ? "Click to clear" : role === null ? "Files no convention identified" : undefined}
              className={`flex h-6 w-full items-center gap-2 border-l-2 px-3 text-left ${
                active ? "border-accent bg-surface font-semibold" : "border-transparent hover:bg-surface"
              }`}
            >
              <Swatch role={role} />
              <span className={`truncate ${role === null ? "text-muted" : ""}`}>{role ?? "unidentified"}</span>
              <span className="ml-auto tabular-nums text-muted">{count}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A role's colour; an empty outline for a role with none, so absence reads as absence. */
export function Swatch({ role }: { role: string | null }) {
  const color = roleColor(role);
  return (
    <span
      aria-hidden
      className={`inline-block size-2 shrink-0 rounded-[2px] ${color === null ? "border border-muted" : ""}`}
      style={color === null ? undefined : { background: color }}
    />
  );
}
