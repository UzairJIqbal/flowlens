"use client";

import "./globals.css";

// Replaces the root layout when the layout itself fails, so it carries its own
// document. The theme cookie isn't readable here; the stylesheet's system
// scheme applies instead.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="font-sans text-[13px]">
        <title>Error · Flowlens</title>
        <main className="mx-auto w-full max-w-[1140px] px-6 py-10">
          <p className="font-mono text-xs font-semibold">flowlens</p>
          <h1 className="mt-6 text-base font-semibold">Flowlens failed to load.</h1>
          <p className="mt-1 max-w-[62ch] leading-relaxed text-muted">
            Something went wrong on the server before any page could be built. Trying again often works.
          </p>
          {error.digest && (
            <p className="mt-3 text-xs text-muted">
              Reference <span className="font-mono text-foreground">{error.digest}</span>
            </p>
          )}
          <button
            type="button"
            onClick={() => retry()}
            className="mt-4 flex h-7 items-center rounded bg-accent px-3 text-xs font-medium text-background"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
