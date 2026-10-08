// How close an answer's files came to the parser's: set comparison between the
// files the edge list says and the files an answer named. Pure, and nothing
// in it has an opinion; a file is either in both sets or it isn't.

export interface Score {
  /** Named and expected. */
  correct: string[];
  /** Expected, never named. */
  missed: string[];
  /** Named, not expected. */
  wrong: string[];
  /** Share of the expected files named. 1 when nothing was expected. */
  recall: number;
  /** Share of the named files expected. 1 when nothing was named. */
  precision: number;
  /**
   * Both at once, the harmonic mean of the two. 1 only for an exact answer,
   * including "none" when none was expected.
   */
  f1: number;
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function scoreAnswer(expected: Iterable<string>, named: Iterable<string>): Score {
  const want = new Set(expected);
  const said = new Set(named);
  const correct = [...said].filter((p) => want.has(p)).sort(byPath);
  const missed = [...want].filter((p) => !said.has(p)).sort(byPath);
  const wrong = [...said].filter((p) => !want.has(p)).sort(byPath);
  const recall = want.size === 0 ? 1 : correct.length / want.size;
  const precision = said.size === 0 ? 1 : correct.length / said.size;
  const f1 = recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
  return { correct, missed, wrong, recall, precision, f1 };
}
