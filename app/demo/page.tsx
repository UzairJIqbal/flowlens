import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { MapWorkspace } from "@/app/_components/map-workspace";
import { ThemeControl } from "@/app/_components/theme-control";
import { tracing } from "@/lib/ai/client";
import { demo } from "@/lib/demo/snapshot";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

export const metadata: Metadata = {
  title: `Demo: ${demo.repoOwner}/${demo.repoName}`,
  description: `A real Flowlens analysis of ${demo.repoOwner}/${demo.repoName}, viewable without signing in.`,
};

/**
 * The public demo: the map page over a stored analysis frozen into the
 * repository, so it reads nothing from the database and a paused project
 * can't take it down. Everything that is arithmetic over the edge list works;
 * explaining and asking need an analysis of your own.
 */
export default async function DemoPage() {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const repo = {
    name: `${demo.repoOwner}/${demo.repoName}`,
    adapter: demo.adapter,
    coverage: { parsed: demo.coverage.files.parsed, skipped: demo.coverage.files.skipped },
    routes: { found: demo.routes.length, withheld: demo.withheldRoutes.length },
  };
  // The date the analysis finished, so nobody mistakes the snapshot for today's code.
  const analysed = demo.finishedAt?.slice(0, 10);

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
        <Link href="/" className="font-mono font-semibold">
          flowlens
        </Link>
        <span className="text-muted">/</span>
        <span className="text-muted">demo</span>
        <span className="text-muted">/</span>
        <h1 className="truncate font-mono">
          <span className="text-muted">{demo.repoOwner}/</span>
          {demo.repoName}
        </h1>
        <a
          href={`https://github.com/${demo.repoOwner}/${demo.repoName}/tree/${demo.commitSha}`}
          className="font-mono text-muted hover:text-foreground"
        >
          {demo.commitSha.slice(0, 7)}
        </a>
        <span className="hidden text-muted sm:inline">
          <span className="tabular-nums text-foreground">{demo.files.length}</span> files ·{" "}
          <span className="tabular-nums text-foreground">{demo.edges.length}</span> edges · analysed {analysed} · read-only
        </span>
        <div className="ml-auto flex items-center gap-3">
          <ThemeControl initial={theme} />
          <Link href="/sign-in" className="flex h-6 items-center rounded bg-accent px-2.5 font-medium text-background">
            Map your own
          </Link>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        <MapWorkspace
          analysisId={null}
          askUnavailable="Questions are answered for analyses of your own. Sign in to map a repository and ask about it."
          tracing={tracing}
          title="Categories"
          repo={repo}
          files={demo.files}
          edges={demo.edges}
          routes={demo.routes}
          withheldRoutes={demo.withheldRoutes}
        />
      </main>
    </div>
  );
}
