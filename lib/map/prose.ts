// Reading a model's explanation. Pure, no React.
//
// The prompt permits three pieces of formatting: inline code, bold and bullet
// lines. Those are rendered. Anything else a model writes anyway is reduced to
// its text, so no backtick, asterisk or heading hash ever reaches the screen
// as a character.

export interface Span {
  text: string;
  code?: boolean;
  bold?: boolean;
}

export interface Block {
  bullet: boolean;
  spans: Span[];
}

/** Converts model prose into paragraph and bullet spans, reducing unsupported Markdown to text. */
export function parseProse(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let fence: string[] | null = null;

  /** Emits the accumulated paragraph before starting a separate block. */
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ bullet: false, spans: inline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      // A code block, though the prompt forbids one: kept as code, never as fences.
      if (fence === null) {
        flush();
        fence = [];
      } else {
        if (fence.length > 0) blocks.push({ bullet: false, spans: [{ text: fence.join("\n"), code: true }] });
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      fence.push(raw);
      continue;
    }

    const line = raw.trim();
    if (line === "" || /^([-*_])(\s*\1){2,}$/.test(line)) {
      flush();
      continue;
    }
    const bullet = /^[-*+•]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push({ bullet: true, spans: inline(bullet[1]) });
      continue;
    }
    const heading = /^#{1,6}\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      // Not permitted; shown as a bold line rather than as hashes.
      flush();
      blocks.push({ bullet: false, spans: inline(heading[1]).map((s) => ({ ...s, bold: true })) });
      continue;
    }
    paragraph.push(line.replace(/^>\s?/, ""));
  }
  if (fence !== null && fence.length > 0) blocks.push({ bullet: false, spans: [{ text: fence.join("\n"), code: true }] });
  flush();
  return blocks;
}

/** Parses code and bold spans, preserving link labels and discarding unsupported inline markers. */
function inline(text: string, bold = false): Span[] {
  const spans: Span[] = [];
  let plain = "";
  /** Emits pending plain text before a formatted span, inheriting the enclosing bold state. */
  const push = (span: Span) => {
    if (plain) spans.push({ text: plain, ...(bold && { bold }) });
    plain = "";
    spans.push(span);
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "`") {
      const run = /^`+/.exec(text.slice(i))![0];
      const close = text.indexOf(run, i + run.length);
      if (close !== -1) {
        const code = text.slice(i + run.length, close).replace(/^ (.*) $/, "$1");
        push({ text: code, code: true, ...(bold && { bold }) });
        i = close + run.length;
      } else {
        // An unmatched backtick is formatting debris, not content.
        i += run.length;
      }
      continue;
    }
    // Only asterisks: underscores are too common in real names (`__tests__`).
    if (text.startsWith("**", i)) {
      const close = text.indexOf("**", i + 2);
      if (close !== -1 && close > i + 2) {
        for (const span of inline(text.slice(i + 2, close), true)) push(span);
        i = close + 2;
      } else {
        i += 2;
      }
      continue;
    }
    if (ch === "*") {
      // Italics aren't permitted; their text is kept and the asterisks dropped.
      i += 1;
      continue;
    }
    const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(text.slice(i));
    if (link) {
      for (const span of inline(link[1], bold)) push(span);
      i += link[0].length;
      continue;
    }
    plain += ch;
    i += 1;
  }
  if (plain) spans.push({ text: plain, ...(bold && { bold }) });
  return spans;
}

export type Target = { kind: "file"; path: string } | { kind: "folder"; id: string };
export interface Piece {
  text: string;
  target?: Target;
}

// Characters a repository path can contain, generously: Next.js route groups
// and dynamic segments put brackets and parentheses in real paths.
const CANDIDATE = /[A-Za-z0-9_@$~+\-.[\]()/]+/g;
const LEADING = "([{'\"";
const TRAILING = ")]}'\".,:;!?";

/**
 * Splits text so every repository path in it is its own piece, carrying where
 * it leads. Only a path `resolve` knows becomes a link; a name that merely
 * looks like a path stays text.
 */
export function linkPaths(text: string, resolve: (path: string) => Target | null): Piece[] {
  const pieces: Piece[] = [];
  let last = 0;
  for (const match of text.matchAll(CANDIDATE)) {
    const word = match[0];
    if (!word.includes("/") && !word.includes(".")) continue;
    const found = trimmed(word, resolve);
    if (!found) continue;
    const start = match.index + found.lead;
    const end = start + found.core.length;
    if (start > last) pieces.push({ text: text.slice(last, start) });
    pieces.push({ text: found.core, target: found.target });
    last = end;
  }
  if (last < text.length) pieces.push({ text: text.slice(last) });
  return pieces;
}

/** Tries the word with the least surrounding punctuation stripped first. */
function trimmed(word: string, resolve: (path: string) => Target | null) {
  let maxLead = 0;
  while (maxLead < word.length && LEADING.includes(word[maxLead])) maxLead++;
  let maxTrail = 0;
  while (maxTrail < word.length - maxLead && TRAILING.includes(word[word.length - 1 - maxTrail])) maxTrail++;

  for (let strip = 0; strip <= maxLead + maxTrail; strip++) {
    for (let lead = Math.min(strip, maxLead); lead >= 0 && strip - lead <= maxTrail; lead--) {
      const core = word.slice(lead, word.length - (strip - lead));
      const target = resolve(core.replace(/^\.\//, "").replace(/\/$/, ""));
      if (target) return { lead, core, target };
    }
  }
  return null;
}
