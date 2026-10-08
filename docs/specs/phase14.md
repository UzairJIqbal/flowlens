# Flowlens: PR Change Preview

The product decisions behind this phase, written before it starts, with the reasoning attached. It builds on everything in `project-doc.md`, and every rule there still holds. Where this document is silent, that one decides.

Read the part you need before you build something. Don't read it all at once, and don't paste it into a prompt.

## What it is

Paste a link to a pull request on a public repository and get the map twice: before the change and after it, shown as one picture. New import lines are drawn one way, removed ones another. Files the pull request touched are marked. Files that could break because of it, two levels out, are lit up the same way selection lights them up today.

A side list says the same thing in words: what changed, which imports appeared, which disappeared, and what could be affected.

## The problem

The moment someone most needs the map is the moment just before code nobody read gets merged. An agent opens a pull request with forty changed files. The review tool shows forty diffs of lines. What it can't show is what the change did to the shape: that a utility now imports the database layer, that a barrel file gained six re-exports, that a page which used to depend on nothing now depends on half the app.

Those are structural questions, and answering them from a line diff means rebuilding the import graph in your head twice and comparing. Nobody does that. They skim and merge.

## Who it's for

The same developer as `project-doc.md`, on a specific afternoon: a pull request is open, most likely written by an agent, and they have to decide whether to merge it. They can read the diff. They can't see what it does to the structure.

On a team it's also the reviewer who didn't write the code and didn't prompt the agent that did.

## Why this is worth a phase

`project-doc.md` argues that earlier map tools failed because the map was a nice-to-have. A pull request is the clearest case of "needed on a specific afternoon for a specific reason". It turns Flowlens from something you open when you get lost into something you open every time code is about to land.

It's also the thing the AI-reads-the-repo tools structurally can't do honestly. Asking a model to describe the difference between two structures it guessed doubles the guessing.

## The rule this phase rests on

**The difference is computed, never described into existence.**

Both sides are produced by the same standalone parser, unchanged. The difference is set arithmetic over two edge lists. The affected files come from the same blast-radius function the canvas already uses. The AI may explain the difference afterwards. It may never decide that an edge was added or removed, and it may never decide what is affected.

## Scope

- Accept a public GitHub pull request URL. Read the base commit, the head commit and the changed-file list from the public API. No token, no repo scope, same as the rest of the product.
- Parse both commits with the existing parser, as two ordinary runs.
- A pure function that takes two sets of files and edges and returns added files, removed files, added edges and removed edges.
- Blast radius, two levels out, from every changed file, on the head side.
- The combined map, the side list, and coverage for both sides.
- An optional "explain this change" that hands the computed lists to the existing explain path.
- Cache by repository, base commit and head commit, owned by an organization.

## Out of scope, and why

- **Approve, reject, "safe to merge", risk levels.** This is the strongest pull toward becoming a code reviewer, and it's refused for the reason `project-doc.md` gives: once there's a verdict, people argue with the verdict instead of reading the map.
- **Counts presented as findings.** "12 new imports" in a list header is information. "12 new imports" in a red badge is a score. Lists, not badges.
- **Commenting on the pull request.** Writing to GitHub needs a token that would then have to be stored.
- **Private repositories.** Same reason as v1.
- **Comparing any two arbitrary commits or branches.** Tempting and nearly free once this exists, but a pull request has an obvious base and a reason someone is looking. Start there.
- **Re-parsing only the changed files.** It looks like an obvious speed-up. A changed file can change how unchanged files resolve, through an index file or an alias. Parse both sides whole until there's evidence that's too slow.

## How it works

**The parser doesn't know pull requests exist.** It gets a directory twice. If anything about pull requests reaches the parser, the layering is wrong.

**The diff is a pure function**, in the same place as the other graph calculations, with tests built from tiny hand-made graphs. An edge is the same edge on both sides when its source file, target file and kind match. Decide that definition once, write it down next to the function, and don't change it per screen.

**Renamed files show up as removed and added.** Matching renames is guessing. If the GitHub API reports a rename, the list can say so, because that is recorded fact rather than inference.

**Rows belong to an organization**, with row-level security as everywhere else. A second organization pasting the same pull request gets its own row, not a shared one.

**The explanation is traced and cached** like every other AI call, keyed on the computed diff rather than on the URL, so a cache hit is provably the same input.

## The interface

This adds to the existing shell. It doesn't rearrange it.

**Two new edge styles, no new colours.** Direction is still green and amber. Added and removed are line styles, for example solid and dashed, because colour already means direction and kind, and `project-doc.md` caps what earns colour.

**Removed files stay on the map, greyed**, so the place they used to occupy is visible.

**Affected files use the existing selection highlight.** A new highlight would mean learning a second meaning for "lit up".

**Switching between before, after and both is instant**, because both graphs are already in the browser. No spinner.

**Nothing animates the change.** No morphing from before to after. The user clicks a toggle, the picture changes.

## Where this is likely to go wrong

**Unequal coverage.** If the head side parses ninety percent of files and the base side parses sixty, the diff shows a flood of "added" edges that are really just edges the base parse missed. That's the silent-failure case from import resolution, doubled. Compare coverage first, and if the two sides differ noticeably, say so at the top, louder than the diff.

**Big pull requests.** A dependency upgrade or a mass rename touches hundreds of files and the blast radius becomes most of the repository. That's a true answer, not a bug. Show it honestly and let the list carry it, rather than inventing a filter that hides most of it.

**Lockfiles and generated code.** Changed files that aren't TypeScript or JavaScript appear in GitHub's list but not in the parse. Show them as changed but unparsed, with the reason, the same way coverage does today.

**Time and size.** Two parses take twice as long. Live progress covers both sides. If a pull request is too large to parse in a request, state that limit, as `project-doc.md` says. Don't build a queue.

## What has to be true before this ships

- On a pull request picked by hand, every added and removed import in the diff was checked against the actual changed lines, and they match.
- The diff function has tests with an added edge, a removed edge, a renamed file, and a file that moved behind a barrel.
- Running the same pull request twice gives the identical diff.
- When the two sides' coverage differs, the warning appears, demonstrated on a constructed case.
- A second organization doesn't get the first one's cached result back from the query.
- "Explain this change" never names a file that isn't in either side of the diff, checked by the existing check rather than asserted.

---

**Kickoff prompt for Claude Code** (save this file next to `project-doc.md` first):

```
Read phase-pr-change-preview.md, and the parts of project-doc.md it points to. Look at how the parser, the graph functions and the map are built today. Then give me a short plan for this phase in small steps, and wait for my go before building.
```
