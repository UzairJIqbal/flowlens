import type { ReactNode } from "react";

// The layout every map renders inside, fixed from phase 4 on. Later phases put
// things into these columns; they never move or resize them. The detail pane is
// a real column rather than an overlay so opening it never covers the map.
export function MapShell({
  title,
  rail,
  map,
  detailHeader,
  detail,
}: {
  title: ReactNode;
  rail?: ReactNode;
  map?: ReactNode;
  /** A full-height bar replacing the column's title, for when the column has modes. */
  detailHeader?: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)_20rem]">
      <aside className="flex min-h-0 flex-col border-r border-border">
        <ColumnHeader>{title}</ColumnHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{rail}</div>
      </aside>

      <section className="relative min-h-0 overflow-hidden">{map}</section>

      <aside className="flex min-h-0 flex-col border-l border-border">
        {detailHeader ?? <ColumnHeader>Detail</ColumnHeader>}
        {/* Positioned rather than scrolled here: each of the column's modes scrolls itself. */}
        <div className="relative min-h-0 flex-1">{detail}</div>
      </aside>
    </div>
  );
}

function ColumnHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-7 shrink-0 items-center border-b border-border px-3 text-xs font-semibold">
      {children}
    </div>
  );
}
