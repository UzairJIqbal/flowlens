import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { cookies } from "next/headers";
import Link from "next/link";
import { ThemeControl } from "@/app/_components/theme-control";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

// The shell every signed-in page renders inside. The proxy has already
// guaranteed a signed-in user with an active organization by the time this runs.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-3">
        <span className="font-mono text-xs font-semibold">flowlens</span>
        {/* Switching, creating and inviting (Manage → Members) all live here. */}
        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/analyses"
          afterCreateOrganizationUrl="/analyses"
          afterLeaveOrganizationUrl="/setup"
        />
        <div className="ml-auto flex items-center gap-3">
          <Link href="/settings" className="text-xs text-muted hover:text-foreground">
            Settings
          </Link>
          <ThemeControl initial={theme} />
          <UserButton />
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
