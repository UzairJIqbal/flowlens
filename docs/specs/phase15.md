# Phase 15 - Answer Check

The product decisions behind this phase, written before it starts, with the reasoning attached. It builds on everything in `project-doc.md`, and every rule there still holds. Where this document is silent, that one decides.

Read the part you need before you build something. Don't read it all at once, and don't paste it into a prompt.

## What it is

A script that measures how often the chat agent is right, using the parser as the answer key.

Flowlens already knows the true answer to a whole family of questions, because the parser computed it. Which files import this one. What this one imports. What breaks two levels out if it changes. How one file reaches another. So the script writes those questions itself from templates, asks the real chat agent, and compares what the agent said with what the edge list says. The output is a number, the worst answers behind it, and a record of every run.

It's a developer tool. Nobody using the product sees it.

## The problem

`project-doc.md` names this as the least settled part of the plan: answer quality has to become a number, and the method was open. Reading a few answers and judging them fine is not measurement.

The usual ways to measure have real problems here. A person grading answers doesn't scale and drifts. A model grading another model's answers is the same guessing the product refuses, moved one step back. Both treat "is this right?" as a matter of opinion.

For structural questions it isn't. The answer is sitting in the edge list.

## Who it's for

The person building Flowlens. They change a prompt, a tool, or the model, and need to know whether the chat agent got better or worse at the one job it has, which is looking facts up and reporting them faithfully.

Indirectly it's for the user in `project-doc.md`, who never sees the number but is the reason it exists. They're trusting the chat panel not to make structure up.

## Why this is worth a phase

It closes the one gap `project-doc.md` admits to. It also makes the central claim of the product testable. "The AI only explains and never invents structure" stops being a principle and becomes a measured rate, with failures you can open and read.

## The rule this phase rests on

**The answer key comes from the parser, and only from the parser.**

No model writes the questions, and no model judges the answers. Questions come from fixed templates filled with real file paths. Correct answers come from the same graph functions the canvas uses. Scoring is set comparison. If a model is involved anywhere other than as the thing being tested, the measurement inherits the problem it was built to measure.

## Scope

- A command-line script, separate from the web application, that takes a directory.
- Runs the existing parser and graph functions on it.
- Fills four question templates: direct importers, direct imports, blast radius two levels out, and the dependency chain between two files.
- Picks files across the range on purpose: heavily imported files, rarely imported ones, files reached only through re-exports, and files in folders with path aliases.
- Sends each question to the real chat agent through the same path the panel uses.
- Records which lookups the agent made, which files it named, and what it answered.
- Scores each answer: how many named files were correct, how many correct files were missed, how many named files don't exist in the repository at all, and whether any lookup happened before the answer.
- A report with totals plus the worst answers, readable as text, and a results file kept in the repository so runs can be compared over time.
- A small fixed set of public repositories to run it against, including one built heavily on barrel files.

## Out of scope, and why

- **Showing the number in the product.** `project-doc.md` refuses scores in the interface, and this is no exception. The number is for the person building the product, not for the person reading a map.
- **Model-written questions or model grading.** Covered by the rule above. It would be faster to build and would quietly measure nothing.
- **Open-ended questions** like "what does this module do?" There is no answer key in the edge list for those. They can be measured later, by a different method, in a different phase. Mixing them in makes the number mean less.
- **Using the result to tune prompts automatically.** A loop that rewrites prompts to raise the number will find ways to raise the number. A person reads the worst answers and decides.
- **Running on every commit in CI** to start with. It calls a model and costs money. Run it by hand first, decide later whether it earns a place in CI.

## How it works

**The script sits outside the web app** and imports the parser and graph functions the same way any plain script would. If it needs the web framework running, the layering `project-doc.md` asked for has slipped somewhere.

**The agent is called through its real path**, not a copy, so the measurement is of what users actually get. If the agent can only be reached through an HTTP route, add a thin entry point that the route and the script both call.

**The cache is bypassed for the answer itself and nothing else.** A cached answer measures the cache. Bypass it with an explicit flag on the call, so the trace shows the bypass happened.

**Every run is traced** with the existing tracing, grouped under one run id, so a bad number can be opened answer by answer.

**Scoring is a pure function** of the expected file set and the named file set, with tests, next to the other graph calculations.

**Extracting the files an answer names** is the one fragile step. Prefer reading them from the agent's structured output or tool calls over pattern-matching prose. Whatever method is used, the existing "names a file that doesn't exist" check is the source of truth for invented files.

## The output

This phase has no screen. Its interface is the report.

**Lead with the failures, not the average.** The ten worst answers come first, each with the question, what was expected, what was said, and the lookups behind it. An average hides exactly the cases worth reading.

**Invented files get their own line**, separate from wrong-but-real files. Naming a real file that isn't an importer is a mistake. Naming a file that doesn't exist is the failure the product exists to prevent, and it should be zero.

**Answers with no lookup behind them get their own line too**, for the reason the last bullet of `project-doc.md` gives.

## Where this is likely to go wrong

**Measuring the easy cases.** If the picked files are mostly simple, the number looks great and means little. That's why the file picking is deliberate and includes re-exports and aliases.

**Measuring the parser instead of the agent.** If the parser misses an edge, the answer key is wrong too, and an agent that answered correctly from the code gets marked wrong. Keep the five-files-checked-by-hand test from `project-doc.md` passing for every repository in the set. When an answer looks wrong, check the key before blaming the agent.

**The number becoming the goal.** Once there's a number it gets optimised. Keep reading the worst answers.

**Non-determinism.** The same question can get different answers on different runs. Run each question more than once, report the spread, and don't celebrate a change smaller than that spread.

## What has to be true before this ships

- The script runs from a plain terminal with the web app not running.
- No model call happens anywhere except the agent being tested, shown by the traces.
- The scoring function has tests, including an exact match, a partial match, an empty answer and an answer naming a file that doesn't exist.
- Results exist for at least three public repositories, one of them built on barrel files, and are committed so the next run can be compared.
- For three answers marked wrong, someone checked the code by hand and confirmed the key was right.
- Invented files and answers with no lookups are reported as separate lines, not folded into the average.

## The phase spec

### Goal

The chat agent's accuracy on structural questions becomes a number, measured against what the parser already knows, with the worst answers laid out underneath it.

### Where this starts

The parser, the graph functions, the chat agent and its lookups, the invented-file check and tracing all exist. This phase is about measuring them, not changing them.

### Build

* A command-line script, separate from the web app, that takes a repository directory and runs the existing parser and graph functions on it.
* Questions generated from four fixed templates, filled with real file paths: which files import this one, what this one imports, what could break two levels out if it changes, and how one file reaches another. The correct answer to each comes from the existing graph functions.
* Files picked across the range on purpose: heavily imported ones, rarely imported ones, ones reached only through re-exports, and ones behind path aliases.
* Each question goes to the real chat agent through the same path the panel uses. The script records which lookups it made, which files it named, and what it answered.
* Each answer is scored: correct files named, correct files missed, files named that don't exist in the repository, and whether at least one lookup happened before the answer.
* A report that opens with the ten worst answers (question, expected, answered, lookups behind it), then the totals. Invented files and answers with no lookups each get their own line.
* A results file committed to the repository, so the next run can be compared against this one.
* A fixed set of at least three public repositories to run against, one of them built heavily on barrel files.

### Constraints

* The answer key comes from the parser and only the parser. No model writes questions and no model grades answers. A model judging a model is the guessing this product refuses, moved one step back.
* The script runs from a plain terminal with the web app not running. If it needs the framework up, the layering has slipped.
* The agent is called through its real code path, not a copy. If it's only reachable through an HTTP route, add one entry point that both the route and the script call.
* The cache is bypassed for the agent's answer and nothing else, with an explicit flag that shows up in the trace. A cached answer measures the cache.
* Every run is traced and grouped under one run id, so a bad number can be opened answer by answer.
* Scoring is a pure function of the expected file set and the named file set, next to the other graph calculations.
* Files an answer names are read from the agent's tool calls or structured output, not pattern-matched out of prose, wherever that's possible. The existing invented-file check stays the source of truth for invented files.
* Each question runs more than once and the spread is reported, so a change smaller than the noise isn't mistaken for an improvement.

### Acceptance check

1. Run the script with the web app stopped. It completes and writes the report and the results file.
2. Open the traces for one run. The only model calls are the agent being tested; none of them are question writing or grading.
3. The scoring function's tests cover an exact match, a partial match, an empty answer, and an answer naming a file that doesn't exist.
4. Results exist for three public repositories, one built on barrel files, and are committed.
5. Pick three answers the report marks wrong and check the code by hand. The key was right each time; if it wasn't, the parser bug gets fixed before the number is trusted.
6. Invented files and no-lookup answers appear as their own lines in the report, not folded into an average.

### Not in this phase

Showing any score in the product interface. Open-ended questions like "what does this module do", which have no answer key in the edge list. Automatically rewriting prompts to raise the number. Running it in CI on every commit.

---

**Kickoff prompt for Claude Code** (save this file as `docs/specs/phase15.md` first):

```
Read docs/specs/phase15.md, and the parts of docs/project-doc.md it points to. Look at how the parser, the graph functions, the chat agent, its lookup tools and the tracing are built today. Then give me a short plan for this phase in small steps, and wait for my go before building.
```
