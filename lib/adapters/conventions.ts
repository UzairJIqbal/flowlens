// Conventions more than one adapter reads. Each is a fact about a file's name
// or its first lines, never a guess from what the code seems to do.

/** Any extension the parser reads. */
export const CODE = String.raw`\.(?:[cm]?[jt]s|[jt]sx)`;

// Tool configuration at the repository root: next.config.js, tailwind.config.ts, .eslintrc.cjs.
const CONFIG = new RegExp(String.raw`^(?:[^/]+\.config|\.[^/]+rc)${CODE}$`);

export const isRootConfig = (path: string): boolean => CONFIG.test(path);

// React's own naming rules: a component is named in PascalCase so JSX can tell
// it from an HTML tag, and a hook's name starts with "use" so the linter can
// find it. A file named that way is following them. A kebab-case component
// file says nothing, so it stays unidentified.
const COMPONENT = /(?:^|\/)[A-Z][A-Za-z0-9]*\.[jt]sx$/;
const HOOK = new RegExp(String.raw`(?:^|/)use(?:[A-Z][A-Za-z0-9]*|-[a-z0-9-]+)${CODE}$`);

export function reactRoleOf(path: string): "component" | "hook" | null {
  if (HOOK.test(path)) return "hook";
  if (COMPONENT.test(path)) return "component";
  return null;
}

// Whitespace, comments, or a string-literal statement, read from where the
// last one stopped. A string followed by anything but `;`, a line break or
// the end of the file is an expression, not a directive.
const PROLOGUE = /[\s]+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(["'])((?:(?!\1)[^\\\n])*)\1(?=[ \t]*(?:;|\n|\r|$|\/\/|\/\*))[ \t]*;?/y;

/** The directives at the top of a file ("use client", "use server"), in order. */
export function directives(text: string): string[] {
  const found: string[] = [];
  PROLOGUE.lastIndex = text.startsWith("#!") ? text.indexOf("\n") + 1 || text.length : 0;
  for (let m = PROLOGUE.exec(text); m !== null && m[0] !== ""; m = PROLOGUE.exec(text)) {
    if (m[2] !== undefined) found.push(m[2]);
  }
  return found;
}
