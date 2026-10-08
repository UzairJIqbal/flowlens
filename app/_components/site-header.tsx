import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { ThemeControl } from "./theme-control";

/** The landing page's column, shared so every page outside the tool lines up with it. */
export const SITE_COLUMN = "mx-auto w-full max-w-[1140px] px-6";

/**
 * The header for every page outside the signed-in tool: the landing page,
 * sign-in, sign-up, setup and the 404. One header, so they read as one site.
 */
export async function SiteHeader({ children }: { children?: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background">
      <div className={`${SITE_COLUMN} flex h-12 items-center gap-3`}>
        <Link
          href="/"
          className="font-mono text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          flowlens
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <ThemeControl initial={theme} />
          {children}
        </div>
      </div>
    </header>
  );
}
