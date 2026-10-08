import Link from "next/link";
import { SiteHeader } from "@/app/_components/site-header";

// Also what an analysis from another organization renders as: row-level
// security returns no row, which is indistinguishable from no such analysis.
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-6 py-[clamp(3rem,10vw,6rem)]">
        <div className="max-w-[46ch]">
          <h1 className="text-[clamp(1.75rem,1.1rem+2.2vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.03em]">
            Nothing here.
          </h1>
          <p className="mt-4 text-[15px] leading-[1.6] text-muted">
            This page doesn&apos;t exist, or it belongs to an organization you&apos;re not in.
          </p>
          {/* Signed out, / is the landing page; signed in, the proxy sends it on to the analyses. */}
          <Link
            href="/"
            className="mt-8 inline-flex h-9 items-center rounded bg-accent px-4 text-[13px] font-medium text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Go to the start
          </Link>
        </div>
      </main>
    </div>
  );
}
