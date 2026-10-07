import path from "node:path";
import { cookies } from "next/headers";
import { MapWorkspace } from "@/app/_components/map-workspace";
import { ThemeControl } from "@/app/_components/theme-control";
import { loadSample } from "@/lib/sample";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

// Scaffolding: the real map interface over checked-in parser output, so it can
// be built without an account, a database or a network. Public in the proxy for
// that reason. Goes away once analyses are stored properly.
export default async function PreviewPage() {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const result = loadSample();

  // Only what the map and pane read crosses to the client; the parser's shape
  // is picked from, not changed.
  const files = result.files.map(({ path, folder, lines, role, fanIn, fanOut }) => ({
    path,
    folder,
    lines,
    role,
    fanIn,
    fanOut,
  }));
  const repo = {
    name: path.basename(result.root),
    adapter: result.adapter,
    coverage: { parsed: result.coverage.files.parsed, skipped: result.coverage.files.skipped },
  };
  const edges = result.edges.map(({ from, to }) => ({ from, to }));

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-3">
        <span className="font-mono text-xs font-semibold">flowlens</span>
        <span className="font-mono text-xs text-muted">{repo.name}</span>
        <span className="text-xs text-muted">
          <span className="tabular-nums text-foreground">{files.length}</span> files ·{" "}
          <span className="tabular-nums text-foreground">{edges.length}</span> edges · preview
        </span>
        <div className="ml-auto">
          <ThemeControl initial={theme} />
        </div>
      </header>
      <MapWorkspace title="Categories" repo={repo} files={files} edges={edges} />
    </div>
  );
}
