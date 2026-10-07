// Framework knowledge lives behind this interface and nowhere else in the
// parser. The parser hands each file over and records the answer; it never
// asks which framework it is looking at.
export interface FrameworkAdapter {
  name: string;
  /** What the file is by the framework's convention, or null when convention says nothing. */
  roleOf(file: { path: string; text: string }): string | null;
}

/** Assumes no framework, so it never claims to know what a file is. */
export const noFrameworkAdapter: FrameworkAdapter = {
  name: "none",
  roleOf: () => null,
};
