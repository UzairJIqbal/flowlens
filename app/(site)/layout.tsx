import { SiteHeader } from "@/app/_components/site-header";

// Sign-in, sign-up and setup: the landing page's header over one centred
// thing, so the way in looks like the page it was reached from.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-6 py-[clamp(3rem,10vw,6rem)]">{children}</main>
    </div>
  );
}
