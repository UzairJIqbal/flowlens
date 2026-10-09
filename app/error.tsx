"use client";

import Link from "next/link";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

// Anything a page throws that it didn't turn into a message of its own. In
// production the message is withheld, so the reference is what links this
// screen to the server's log line.
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-12 w-full max-w-[1140px] items-center px-6">
          <Link href="/" className={`font-mono text-xs font-semibold ${FOCUS}`}>
            flowlens
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1140px] flex-1 px-6 py-10">
        <h1 className="text-base font-semibold">This page failed to load.</h1>
        <p className="mt-1 max-w-[62ch] leading-relaxed text-muted">
          Something went wrong on the server while building it. Trying again often works; if it keeps failing, the
          reference below matches the entry in the server log.
        </p>
        {error.digest && (
          <p className="mt-3 text-xs text-muted">
            Reference <span className="font-mono text-foreground">{error.digest}</span>
          </p>
        )}
        <div className="mt-4 flex items-center gap-4 text-xs">
          <button
            type="button"
            onClick={() => retry()}
            className={`flex h-7 items-center rounded bg-accent px-3 font-medium text-background ${FOCUS}`}
          >
            Try again
          </button>
          <Link href="/" className={`text-accent hover:underline ${FOCUS}`}>
            Go to the start
          </Link>
        </div>
      </main>
    </div>
  );
}
