import type { Metadata } from "next";
import Link from "next/link";
import { SITE_COLUMN, SiteHeader } from "@/app/_components/site-header";

export const metadata: Metadata = { title: "Not found" };

// Also what an analysis from another organization renders as: row-level
// security returns no row, which is indistinguishable from no such analysis.
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className={`${SITE_COLUMN} flex-1 py-10`}>
        <h1 className="text-base font-semibold">Nothing here.</h1>
        <p className="mt-1 max-w-[62ch] leading-relaxed text-muted">
          This page doesn&apos;t exist, or it belongs to an organization you&apos;re not in.
        </p>
        {/* Signed out, / is the landing page; signed in, the proxy sends it on to the analyses. */}
        <Link
          href="/"
          className="mt-4 inline-flex h-7 items-center rounded bg-accent px-3 text-xs font-medium text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Go to the start
        </Link>
      </main>
    </div>
  );
}
