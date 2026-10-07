import type { Route, WithheldRoute } from "./types.ts";

export interface SourceText {
  /** Repository-relative, forward slashes. */
  path: string;
  text: string;
}

// Framework knowledge lives behind this interface and nowhere else in the
// parser. The parser hands each file over and records the answer; it never
// asks which framework it is looking at.
export interface FrameworkAdapter {
  name: string;
  /** What the file is by the framework's convention, or null when convention says nothing. */
  roleOf(file: SourceText): string | null;
  /**
   * Every route whose method and full pattern can both be read from the code,
   * and every route declaration that can't, with why. Given the whole
   * repository at once, because some frameworks set a prefix in one file that
   * changes every route in the others.
   */
  routes(files: readonly SourceText[]): { routes: Route[]; withheld: WithheldRoute[] };
}

/** Assumes no framework, so it never claims to know what a file is or where it's served. */
export const noFrameworkAdapter: FrameworkAdapter = {
  name: "none",
  roleOf: () => null,
  routes: () => ({ routes: [], withheld: [] }),
};
