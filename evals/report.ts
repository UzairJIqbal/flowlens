import { PICK_MEANING, PICKS, TEMPLATES } from "./questions.ts";
import type { Attempt, Lookup, Results } from "./results.ts";

// The answer check's report, from a finished results file. Plain text, worst
// answers first, then the totals. Pure: the same file always reads the same.

const WORST = 10;

type Scored = Attempt & { scored: NonNullable<Attempt["scored"]> };

const isScored = (a: Attempt): a is Scored => a.scored !== null;

const mean = (xs: readonly number[]) => (xs.length === 0 ? NaN : xs.reduce((s, x) => s + x, 0) / xs.length);
const f2 = (x: number) => (Number.isNaN(x) ? "–" : x.toFixed(2));

/** Mean F1 over scored answers, and its range across rounds: the noise. */
function f1Spread(scored: readonly Scored[], rounds: number): { mean: number; low: number; high: number } {
  const perRound = Array.from({ length: rounds }, (_, i) => mean(scored.filter((a) => a.round === i + 1).map((a) => a.scored.score.f1)));
  const present = perRound.filter((x) => !Number.isNaN(x));
  return { mean: mean(scored.map((a) => a.scored.score.f1)), low: Math.min(...present), high: Math.max(...present) };
}

function spreadText(s: { mean: number; low: number; high: number }): string {
  return `${f2(s.mean)} (rounds ${f2(s.low)}–${f2(s.high)})`;
}

function list(items: readonly string[], max = 12): string {
  if (items.length === 0) return "none";
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? `${shown}, +${items.length - max} more` : shown;
}

function lookupLine(l: Lookup): string {
  const args = Object.entries(l.args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
  const came = l.found === null ? "no result" : l.found ? (l.note ?? "found") : (l.note ?? "not found");
  return `${l.name}(${args}) → ${came}`;
}

/**
 * Worst first: an invented file is the failure the product exists to prevent,
 * then an answer with nothing looked up behind it, then the least overlap
 * with the key, then the most missed.
 */
function worse(a: Scored, b: Scored): number {
  return (
    b.scored.invented.length - a.scored.invented.length ||
    Number(a.lookedUp) - Number(b.lookedUp) ||
    a.scored.score.f1 - b.scored.score.f1 ||
    b.scored.score.missed.length - a.scored.score.missed.length ||
    a.round - b.round
  );
}

export function render(r: Results, before: Results | null): string {
  const byId = new Map(r.questions.map((q) => [q.id, q]));
  const scored = r.attempts.filter(isScored);
  const errored = r.attempts.filter((a) => !isScored(a));
  const out: string[] = [];

  out.push(`Answer check · ${r.repo} @ ${r.commit.slice(0, 7)} · ${r.startedAt}`);
  out.push(`${r.questions.length} questions × ${r.rounds} rounds · traces: LangSmith project "${r.tracedIn}", metadata answer_check = ${r.answerCheck}`);
  if (r.sittings.length > 1) {
    const builds = new Set(r.sittings.map((s) => `${s.flowlens.commit.slice(0, 7)}${s.flowlens.localChanges ? " with local changes" : ""}`));
    out.push(
      `asked over ${r.sittings.length} sittings` +
        (builds.size > 1 ? `, NOT all on the same Flowlens build (${[...builds].join("; ")}): this number mixes them` : ""),
    );
  }
  out.push("");

  // One entry per question, its worst attempt, so ten slots are ten different questions.
  const worstPerQuestion = new Map<string, Scored>();
  for (const a of scored) {
    const held = worstPerQuestion.get(a.question);
    if (!held || worse(a, held) < 0) worstPerQuestion.set(a.question, a);
  }
  const worst = [...worstPerQuestion.values()].sort(worse).slice(0, WORST);
  out.push(`THE ${worst.length} WORST ANSWERS`);
  for (const [i, a] of worst.entries()) {
    const q = byId.get(a.question)!;
    const { score, invented, ambiguous } = a.scored;
    const others = scored.filter((b) => b.question === a.question).map((b) => f2(b.scored.score.f1));
    out.push("");
    out.push(`${i + 1}. ${q.template} · ${q.pick} · round ${a.round} · F1 ${f2(score.f1)} (all rounds: ${others.join(", ")})`);
    out.push(`   Q: ${q.text}`);
    out.push(`   expected (${q.expected.length}): ${list(q.expected)}`);
    out.push(`   answered (${a.scored.named.length}): ${list(a.scored.named)}`);
    if (score.missed.length > 0) out.push(`   missed (${score.missed.length}): ${list(score.missed)}`);
    if (score.wrong.length > 0) out.push(`   real but not expected (${score.wrong.length}): ${list(score.wrong)}`);
    if (invented.length > 0) out.push(`   INVENTED (${invented.length}): ${list(invented)}`);
    if (ambiguous.length > 0) out.push(`   set aside, matches several files: ${list(ambiguous)}`);
    if (a.lookups.length === 0) out.push("   lookups: none");
    for (const l of a.lookups) out.push(`   lookup: ${lookupLine(l)}`);
    if (!a.lookedUp) out.push("   NO LOOKUP behind this answer");
    out.push(`   trace: ${a.agentRunId ?? "run id not reported"}`);
    const text = a.text.trim().replace(/\s+/g, " ");
    out.push(`   said: ${text.length > 400 ? `${text.slice(0, 400)}…` : text || "(nothing)"}`);
  }

  out.push("");
  out.push("TOTALS");
  const all = f1Spread(scored, r.rounds);
  const correct = scored.reduce((s, a) => s + a.scored.score.correct.length, 0);
  const expected = scored.reduce((s, a) => s + byId.get(a.question)!.expected.length, 0);
  const named = scored.reduce((s, a) => s + a.scored.named.length, 0);
  const inventedAnswers = scored.filter((a) => a.scored.invented.length > 0);
  const inventedFiles = new Set(inventedAnswers.flatMap((a) => a.scored.invented));
  const noLookup = scored.filter((a) => !a.lookedUp);
  const ambiguous = scored.reduce((s, a) => s + a.scored.ambiguous.length, 0);
  out.push(`answers scored      ${scored.length} of ${r.attempts.length}${errored.length > 0 ? ` (${errored.length} errored, not scored)` : ""}`);
  out.push(`mean F1             ${spreadText(all)}`);
  out.push(`files found         ${correct} of ${expected} expected${expected === 0 ? "" : ` (${f2(correct / expected)})`}`);
  out.push(`files named right   ${correct} of ${named} named${named === 0 ? "" : ` (${f2(correct / named)})`}`);
  out.push(
    `INVENTED FILES      ${inventedAnswers.length} answer${inventedAnswers.length === 1 ? "" : "s"} named a file that doesn't exist` +
      (inventedFiles.size > 0 ? `: ${list([...inventedFiles])}` : ""),
  );
  out.push(`NO LOOKUP           ${noLookup.length} answer${noLookup.length === 1 ? "" : "s"} had no lookup behind them`);
  if (ambiguous > 0) out.push(`set aside           ${ambiguous} bare names matched several files and weren't counted either way`);
  const unsteady = r.questions.filter((q) => new Set(scored.filter((a) => a.question === q.id).map((a) => f2(a.scored.score.f1))).size > 1);
  out.push(`unsteady questions  ${unsteady.length} of ${r.questions.length} scored differently across rounds`);

  out.push("");
  out.push("by question");
  for (const t of TEMPLATES) {
    const of = scored.filter((a) => byId.get(a.question)!.template === t);
    if (of.length > 0) out.push(`  ${t.padEnd(18)}${spreadText(f1Spread(of, r.rounds))}`);
  }
  out.push("by pick");
  for (const p of PICKS) {
    const of = scored.filter((a) => byId.get(a.question)!.pick === p);
    out.push(`  ${p.padEnd(18)}${of.length > 0 ? spreadText(f1Spread(of, r.rounds)) : `none picked: no file is ${PICK_MEANING[p]}`}`);
  }

  out.push("");
  if (before === null) {
    out.push("No earlier run of this commit to compare with.");
  } else {
    const then = f1Spread(before.attempts.filter(isScored), before.rounds);
    const apart = all.low > then.high || all.high < then.low;
    out.push(`Earlier run ${before.startedAt}: mean F1 ${spreadText(then)}.`);
    out.push(
      apart
        ? `This run's rounds don't overlap it: a change of ${f2(all.mean - then.mean)}, larger than the noise.`
        : `The rounds overlap: a change of ${f2(all.mean - then.mean)} is within the noise.`,
    );
    if (before.questions.map((q) => q.id).join() !== r.questions.map((q) => q.id).join()) {
      out.push("The questions differ from that run's, so the two numbers aren't over the same answers.");
    }
  }
  if (errored.length > 0) {
    out.push("");
    out.push("ERRORED");
    for (const a of errored) out.push(`  round ${a.round} · ${a.question}: ${a.error}`);
  }
  return `${out.join("\n")}\n`;
}
