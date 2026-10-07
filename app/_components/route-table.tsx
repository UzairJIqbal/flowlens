"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { StoredRoute, StoredWithheldRoute } from "@/lib/analyses/map";
import type { Kinds } from "@/lib/map/categories";
import type { MapActions } from "./map-state";

/**
 * Every route an adapter read exactly, by pattern. Clicking one selects the
 * file that declares it. Below them, the declarations it couldn't read
 * exactly, grouped by why, so the table never looks more complete than it is.
 */
export function RouteTable({
  kinds,
  routes,
  withheld,
  selected,
  actions,
}: {
  kinds: Kinds;
  routes: StoredRoute[];
  withheld: StoredWithheldRoute[];
  /** The selected file's path, if a file is selected. */
  selected: string | null;
  actions: MapActions;
}) {
  // Stored order is insertion order, which means nothing to a reader; by
  // pattern, routes under one prefix sit together.
  const sorted = useMemo(
    () =>
      [...routes].sort(
        (a, b) => cmp(a.path, b.path) || cmp(a.method, b.method) || cmp(a.file, b.file) || a.line - b.line,
      ),
    [routes],
  );

  if (kinds.framework === null) return <Empty>No framework detected, so nothing here knows what a route looks like.</Empty>;
  if (!kinds.routed) return <Empty>{kinds.framework} has no route convention to read routes from.</Empty>;

  return (
    <div className="h-full overflow-y-auto text-xs">
      {sorted.length === 0 ? (
        <p className="px-3 py-3 text-muted">No {kinds.framework} routes were read from this repository.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-background">
            <tr className="h-6 border-b border-border text-left text-muted">
              <th className="w-20 px-3 font-normal">Method</th>
              <th className="px-3 font-normal">Pattern</th>
              <th className="px-3 font-normal">Declared in</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={`${r.file}:${r.line}:${r.method}:${r.path}`}
                onClick={() => actions.revealFile(r.file)}
                className={`h-5 cursor-pointer font-mono text-[11px] hover:bg-surface ${
                  r.file === selected ? "bg-surface font-semibold" : ""
                }`}
              >
                <td className="px-3">{r.method}</td>
                <td className="max-w-0 truncate px-3" title={r.path}>
                  {r.path}
                </td>
                <td className="max-w-0 truncate px-3 text-muted" title={`${r.file}:${r.line}`}>
                  {r.file}:{r.line}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {withheld.length > 0 && <Withheld withheld={withheld} selected={selected} actions={actions} />}
    </div>
  );
}

function Withheld({
  withheld,
  selected,
  actions,
}: {
  withheld: StoredWithheldRoute[];
  selected: string | null;
  actions: MapActions;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => {
    const byReason = new Map<string, StoredWithheldRoute[]>();
    for (const w of withheld) byReason.set(w.reason, [...(byReason.get(w.reason) ?? []), w]);
    return [...byReason]
      .map(([reason, entries]) => ({
        reason,
        entries: entries.sort((a, b) => cmp(a.file, b.file) || a.line - b.line),
      }))
      .sort((a, b) => b.entries.length - a.entries.length || cmp(a.reason, b.reason));
  }, [withheld]);

  return (
    <section className="mt-3 border-t border-border">
      <h3 className="flex h-6 items-center bg-surface px-3 font-semibold">
        Not read exactly
        <span className="ml-auto font-normal tabular-nums text-muted">{withheld.length}</span>
      </h3>
      <ul className="py-1">
        {groups.map(({ reason, entries }) => (
          <li key={reason}>
            <button
              type="button"
              aria-expanded={open === reason}
              onClick={() => setOpen((o) => (o === reason ? null : reason))}
              className="flex min-h-5 w-full items-center gap-2 px-3 text-left hover:bg-surface"
            >
              <span className="w-3 shrink-0 text-muted">{open === reason ? "▾" : "▸"}</span>
              <span className="min-w-0 flex-1">{reason}</span>
              <span className="shrink-0 tabular-nums text-muted">{entries.length}</span>
            </button>
            {open === reason && (
              <ul className="pb-1">
                {entries.map((w) => (
                  <li key={`${w.file}:${w.line}`}>
                    <button
                      type="button"
                      onClick={() => actions.revealFile(w.file)}
                      title={`${w.file}:${w.line}`}
                      className={`flex h-5 w-full items-center truncate pl-8 pr-3 text-left font-mono text-[11px] hover:bg-surface ${
                        w.file === selected ? "bg-surface font-semibold" : ""
                      }`}
                    >
                      {w.file}:{w.line}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-3 text-xs text-muted">{children}</p>;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
