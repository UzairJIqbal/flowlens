import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { SITE_COLUMN, SiteHeader } from "@/app/_components/site-header";
import { demo } from "@/lib/demo/snapshot";
import mapShot from "@/public/landing/map.png";
import folderShot from "@/public/landing/folder.png";
import reachShot from "@/public/landing/blast-radius.png";

// The signed-out front door. The proxy sends anyone signed in to their
// analyses, so everything here is written for someone who hasn't used it.
// Every picture is a screenshot of a real analysis; the counts are read from
// the same snapshot the demo shows, so they can't drift from it.

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const SHOT = "w-full rounded border border-border";
const DEMO = `${demo.repoOwner}/${demo.repoName}`;

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader>
        <Link href="/demo" className={`text-xs text-muted hover:text-foreground ${FOCUS}`}>
          Demo
        </Link>
      </SiteHeader>

      <main className={`${SITE_COLUMN} flex-1 py-10`}>
        <section>
          <h1 className="max-w-[62ch] text-base font-semibold leading-snug">
            Flowlens parses a public TypeScript or JavaScript repository and draws what imports what, with every
            line traced to an import that resolved to a real file.
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <Link
              href="/sign-in"
              className={`flex h-7 items-center rounded bg-accent px-3 font-medium text-background ${FOCUS}`}
            >
              Sign in to map a repository
            </Link>
            <Link href="/demo" className={`text-accent hover:underline ${FOCUS}`}>
              Open the demo without signing in
            </Link>
          </div>
          <figure className="mt-6">
            <Link href="/demo" className={`block ${FOCUS}`}>
              <Image
                src={mapShot}
                alt={`The Flowlens map of ${DEMO}: folders as boxes, imports as lines, categories on the left, the most depended-on files on the right.`}
                className={SHOT}
                sizes="(min-width: 1140px) 1092px, 100vw"
                priority
              />
            </Link>
            <figcaption className="mt-1.5 text-xs text-muted">
              <span className="font-mono">{DEMO}</span> at{" "}
              <span className="font-mono">{demo.commitSha.slice(0, 7)}</span>:{" "}
              <span className="tabular-nums text-foreground">{demo.files.length}</span> files,{" "}
              <span className="tabular-nums text-foreground">{demo.edges.length}</span> import edges. This is the
              demo, live.
            </figcaption>
          </figure>
        </section>

        <div className="mt-10 grid gap-x-8 gap-y-10 border-t border-border pt-8 md:grid-cols-3">
          <Feature
            title="The map"
            shot={folderShot}
            alt="A folder opened on the map, its files coloured by kind, with the imports into and out of it."
          >
            Folders are boxes and imports are lines. Each line is an import the TypeScript compiler followed to a
            file in the repository. An import that can&apos;t be followed isn&apos;t drawn. It&apos;s counted, with
            the reason.
          </Feature>
          <Feature
            title="Blast radius"
            shot={reachShot}
            alt="A selected file with every file that depends on it, up to two imports away, listed beside the map."
          >
            Select a file to see everything that breaks if it changes, up to two imports away, or everything it
            needs. The walk is arithmetic over the parsed edges, so it&apos;s the same every time.
          </Feature>
          <Feature
            title="Questions that show their lookups"
            shot={null}
            alt=""
          >
            Ask in plain English. The model picks which file to look up and in which direction, and the parsed map
            answers. Each lookup is listed as it runs, before the answer. The live site doesn&apos;t host the agent,
            so asking works when you run Flowlens yourself.
          </Feature>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className={`${SITE_COLUMN} flex flex-wrap items-center gap-x-6 gap-y-2 py-4 text-xs text-muted`}>
          <span className="font-mono font-semibold text-foreground">flowlens</span>
          <span>Public repositories only. TypeScript and JavaScript only. Archives over 100 MB are refused.</span>
          <a href="https://github.com/UzairJIqbal/flowlens" className={`ml-auto hover:text-foreground ${FOCUS}`}>
            Source
          </a>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  title,
  shot,
  alt,
  children,
}: {
  title: string;
  /** Null where no real screenshot exists yet: absent beats a mockup. */
  shot: typeof mapShot | null;
  alt: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[13px] font-semibold">{title}</h2>
      <p className="mt-1 leading-relaxed text-muted">{children}</p>
      {shot && <Image src={shot} alt={alt} className={`${SHOT} mt-3`} sizes="(min-width: 768px) 360px, 100vw" />}
    </section>
  );
}
