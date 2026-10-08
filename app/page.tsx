import Link from "next/link";
import type { ReactNode } from "react";
import { KindsFigure, MapFigure, ReachFigure, UnresolvedFigure } from "@/app/_components/landing-figures";
import { SITE_COLUMN, SiteHeader } from "@/app/_components/site-header";

// The signed-out front door. The proxy sends anyone signed in to their
// analyses, so everything here is written for someone who hasn't used it.
// Every claim on this page is something the product shows within a click.

const COLUMN = SITE_COLUMN;
const SECTION = "border-t border-border py-[clamp(5rem,11vw,8rem)]";
const H2 = "text-[clamp(1.75rem,1.1rem+2.2vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.03em]";
const BODY = "text-[15px] leading-[1.6] text-muted";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader>
        <Link
          href="/sign-in"
          className={`flex h-6 items-center rounded bg-accent px-2.5 text-xs font-medium text-background ${FOCUS}`}
        >
          Sign in
        </Link>
      </SiteHeader>

      <main>
        <section className={`${COLUMN} flex min-h-[calc(90svh-3rem)] items-center py-16`}>
          <div className="grid w-full items-center gap-x-20 gap-y-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <div>
              <h1 className="text-[clamp(2.4rem,1.4rem+3.8vw,4rem)] font-semibold leading-[1.06] tracking-[-0.035em]">
                A map of the code nobody read.
              </h1>
              <p className={`${BODY} mt-6 max-w-[46ch]`}>
                Paste a public TypeScript or JavaScript repository. Flowlens parses every file and draws
                what imports what: folders as boxes, imports as lines, each one traced to a real file.
              </p>
              <HeroForm />
            </div>
            <MapFigure />
          </div>
        </section>

        <section className={SECTION}>
          <div className={`${COLUMN} grid items-center gap-x-20 gap-y-14 lg:grid-cols-2`}>
            <div>
              <h2 className={H2}>Select a file. The map answers.</h2>
              <p className={`${BODY} mt-5 max-w-[46ch]`}>
                The questions you&apos;d otherwise answer by reading imports one file at a time, and stop
                answering somewhere past thirty files.
              </p>
              <dl className="mt-10 max-w-[46ch] space-y-6">
                <Point term="Folders fold into boxes">
                  A large repository stays legible. Open a folder to see its files and how many depend on
                  each.
                </Point>
                <Point term="What it uses, what uses it">
                  What the selected file imports is drawn in blue. What imports it is drawn in amber.
                </Point>
                <Point term="Two levels out">
                  Everything within two imports in either direction: what breaks if it changes, and what it
                  needs to work.
                </Point>
                <Point term="An explanation from its neighbours">
                  A paragraph written from the file and the files it really touches.
                </Point>
                <Point term="Questions about the whole repository">
                  Ask in plain English and watch each lookup it makes before it answers.
                </Point>
              </dl>
            </div>
            <ReachFigure />
          </div>
        </section>

        <section className={SECTION}>
          <div className={COLUMN}>
            <h2 className={H2}>How it works</h2>
            <p className={`${BODY} mt-5 max-w-[64ch]`}>
              Parsing comes first and decides everything on screen. The model comes last, and only
              explains what the parser already found.
            </p>
            <ol className="mt-14 grid gap-x-20 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              <Step n={1} title="Download">
                The latest commit is fetched from GitHub as one archive. Nothing is cloned and no token is
                asked for.
              </Step>
              <Step n={2} title="Parse">
                Every TypeScript and JavaScript file goes through the TypeScript compiler. Imports,
                re-exports, dynamic imports and <code className="font-mono text-[13px]">require()</code> are
                all read.
              </Step>
              <Step n={3} title="Resolve">
                Each import is followed to the file it names, through path aliases, index files and
                workspace packages. One that can&apos;t be followed isn&apos;t drawn.
              </Step>
              <Step n={4} title="Name">
                A framework adapter says what each file is from where it sits. Files no convention covers
                are labelled by a model, and marked that way.
              </Step>
              <Step n={5} title="Explain">
                Explanations are written from the file and its real neighbours, then cached. Asking again
                reads the answer back rather than writing a new one.
              </Step>
            </ol>
          </div>
        </section>

        <section className={SECTION}>
          <div className={`${COLUMN} grid items-center gap-x-20 gap-y-14 lg:grid-cols-2`}>
            <KindsFigure />
            <div className="lg:order-first">
              <h2 className={H2}>Frameworks it knows</h2>
              <p className={`${BODY} mt-5 max-w-[46ch]`}>
                Every repository is parsed the same way. What each file is called comes from an adapter for
                the framework the repository depends on, and each kind gets its own colour.
              </p>
              <dl className="mt-10 max-w-[46ch] space-y-6">
                <Point term="Next.js">
                  Page routes, API endpoints, server actions, layouts, loading and error UI, middleware.
                </Point>
                <Point term="NestJS">
                  Controllers, services, modules, entities, repositories, guards, pipes, DTOs.
                </Point>
                <Point term="Express">Routers, controllers, middleware, validators, services, models.</Point>
                <Point term="React">Entry point, components, hooks.</Point>
              </dl>
              <p className={`${BODY} mt-8 max-w-[46ch]`}>
                Anything else is still parsed and mapped in full. Its files are labelled by a model instead
                of a convention.
              </p>
            </div>
          </div>
        </section>

        <section className={SECTION}>
          <div className={COLUMN}>
            <div className="grid items-center gap-x-20 gap-y-14 lg:grid-cols-2">
              <div>
                <h2 className={H2}>What it won&apos;t do</h2>
                <p className={`${BODY} mt-5 max-w-[46ch]`}>
                  Each of these would make a better-looking demo. Each would make the map harder to trust.
                </p>
              </div>
              <UnresolvedFigure />
            </div>
            <dl className="mt-16 grid gap-x-20 gap-y-10 md:grid-cols-2">
              <Point term="Guess a connection" wide>
                A line exists because an import resolved to a real file. A map that&apos;s ninety percent
                right can&apos;t tell you which ten percent is wrong.
              </Point>
              <Point term="Grade the code" wide>
                No scores, no severity, no issue counts. It explains a codebase. It doesn&apos;t review one.
              </Point>
              <Point term="Approximate a route" wide>
                A route whose full path can&apos;t be read from the code is left out of the table, and the
                reason is listed instead.
              </Point>
              <Point term="Let the model walk the graph" wide>
                When you ask a question, the model picks a file and a direction. The walk itself is the
                same arithmetic that draws the map.
              </Point>
              <Point term="Read private repositories" wide>
                That needs a GitHub token stored somewhere. Public repositories only.
              </Point>
              <Point term="Read other languages" wide>
                TypeScript and JavaScript only. Getting one language right is the whole point.
              </Point>
              <Point term="Stretch past one run" wide>
                A repository whose archive is over 100 MB is refused, and the analysis says so.
              </Point>
            </dl>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className={`${COLUMN} flex flex-wrap items-center gap-x-6 gap-y-2 py-8 text-xs text-muted`}>
          <span className="font-mono font-semibold text-foreground">flowlens</span>
          <span>Every box and every line comes from parsing the code.</span>
        </div>
      </footer>
    </div>
  );
}

/**
 * A plain GET to the dashboard. Signed out, the proxy carries the URL through
 * sign-in and organization setup; the dashboard then submits it.
 */
function HeroForm() {
  return (
    <form action="/analyses" method="get" className="mt-10 max-w-[46ch]">
      <label htmlFor="hero-url" className="text-xs text-muted">
        Public repository
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="hero-url"
          name="url"
          type="text"
          required
          placeholder="https://github.com/owner/repository"
          spellCheck={false}
          autoComplete="off"
          className="h-9 min-w-0 flex-1 rounded border border-border bg-background px-3 font-mono text-[13px] placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className={`h-9 shrink-0 rounded bg-accent px-4 text-[13px] font-medium text-background ${FOCUS}`}
        >
          Analyse
        </button>
      </div>
      <p className="mt-3 text-xs text-muted">You&apos;ll sign in first. The analysis starts straight after.</p>
    </form>
  );
}

function Point({ term, wide = false, children }: { term: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "max-w-[46ch]" : undefined}>
      <dt className="text-[15px] font-medium">{term}</dt>
      <dd className={`${BODY} mt-1`}>{children}</dd>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="max-w-[46ch]">
      <span className="font-mono text-xs tabular-nums text-muted">{n}</span>
      <h3 className="mt-3 text-[15px] font-medium">{title}</h3>
      <p className={`${BODY} mt-1`}>{children}</p>
    </li>
  );
}
