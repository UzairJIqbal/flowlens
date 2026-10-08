import assert from "node:assert/strict";
import { test } from "node:test";
import { affected, coverageGap, diffGraphs, pairChanges, type Side, type SideCoverage } from "./diff.ts";

// Tiny graphs written by hand, so each expected answer can be checked by eye.

test("an added import is an added edge, and nothing else moves", () => {
  const base: Side = { files: ["a.ts", "b.ts"], edges: [] };
  const head: Side = { files: ["a.ts", "b.ts"], edges: [{ from: "a.ts", to: "b.ts", kinds: ["import"] }] };
  assert.deepEqual(diffGraphs(base, head), {
    addedFiles: [],
    removedFiles: [],
    addedEdges: [{ from: "a.ts", to: "b.ts", kind: "import" }],
    removedEdges: [],
  });
});

test("a removed import is a removed edge", () => {
  const base: Side = { files: ["a.ts", "b.ts"], edges: [{ from: "a.ts", to: "b.ts", kinds: ["require"] }] };
  const head: Side = { files: ["a.ts", "b.ts"], edges: [] };
  assert.deepEqual(diffGraphs(base, head), {
    addedFiles: [],
    removedFiles: [],
    addedEdges: [],
    removedEdges: [{ from: "a.ts", to: "b.ts", kind: "require" }],
  });
});

test("a renamed file is one removed and one added, never matched", () => {
  const base: Side = { files: ["a.ts", "old.ts"], edges: [{ from: "a.ts", to: "old.ts", kinds: ["import"] }] };
  const head: Side = { files: ["a.ts", "new.ts"], edges: [{ from: "a.ts", to: "new.ts", kinds: ["import"] }] };
  assert.deepEqual(diffGraphs(base, head), {
    addedFiles: ["new.ts"],
    removedFiles: ["old.ts"],
    addedEdges: [{ from: "a.ts", to: "new.ts", kind: "import" }],
    removedEdges: [{ from: "a.ts", to: "old.ts", kind: "import" }],
  });
});

test("a file moved behind a barrel: the direct import goes, two edges arrive", () => {
  const base: Side = {
    files: ["page.ts", "lib/db.ts"],
    edges: [{ from: "page.ts", to: "lib/db.ts", kinds: ["import"] }],
  };
  const head: Side = {
    files: ["page.ts", "lib/db.ts", "lib/index.ts"],
    edges: [
      { from: "page.ts", to: "lib/index.ts", kinds: ["import"] },
      { from: "lib/index.ts", to: "lib/db.ts", kinds: ["reexport"] },
    ],
  };
  assert.deepEqual(diffGraphs(base, head), {
    addedFiles: ["lib/index.ts"],
    removedFiles: [],
    addedEdges: [
      { from: "lib/index.ts", to: "lib/db.ts", kind: "reexport" },
      { from: "page.ts", to: "lib/index.ts", kind: "import" },
    ],
    removedEdges: [{ from: "page.ts", to: "lib/db.ts", kind: "import" }],
  });
  // On the map the old pair's line goes and both new ones appear.
  assert.deepEqual(pairChanges(base.edges, head.edges), {
    added: head.edges,
    removed: base.edges,
  });
});

test("a kind change on a pair is in the diff but not a new line on the map", () => {
  const base: Side = { files: ["a.ts", "b.ts"], edges: [{ from: "a.ts", to: "b.ts", kinds: ["import"] }] };
  const head: Side = { files: ["a.ts", "b.ts"], edges: [{ from: "a.ts", to: "b.ts", kinds: ["import", "reexport"] }] };
  const diff = diffGraphs(base, head);
  assert.deepEqual(diff.addedEdges, [{ from: "a.ts", to: "b.ts", kind: "reexport" }]);
  assert.deepEqual(diff.removedEdges, []);
  assert.deepEqual(pairChanges(base.edges, head.edges), { added: [], removed: [] });
});

test("the same two sides in any order give the identical diff", () => {
  const base: Side = {
    files: ["c.ts", "a.ts", "b.ts"],
    edges: [
      { from: "c.ts", to: "a.ts", kinds: ["import"] },
      { from: "b.ts", to: "a.ts", kinds: ["dynamic", "import"] },
    ],
  };
  const head: Side = {
    files: ["d.ts", "a.ts", "b.ts"],
    edges: [
      { from: "d.ts", to: "b.ts", kinds: ["import"] },
      { from: "a.ts", to: "b.ts", kinds: ["import"] },
    ],
  };
  const shuffled = (s: Side): Side => ({ files: [...s.files].reverse(), edges: [...s.edges].reverse() });
  assert.deepEqual(diffGraphs(base, head), diffGraphs(shuffled(base), shuffled(head)));
});

test("affected walks dependents two levels from every changed file, nearest kept", () => {
  // e -> d -> c -> b, and a -> b. b changed.
  const edges = [
    { from: "a.ts", to: "b.ts" },
    { from: "c.ts", to: "b.ts" },
    { from: "d.ts", to: "c.ts" },
    { from: "e.ts", to: "d.ts" },
  ];
  assert.deepEqual(affected(["b.ts"], edges), [
    { path: "a.ts", depth: 1 },
    { path: "c.ts", depth: 1 },
    { path: "d.ts", depth: 2 },
  ]);
  // d changed too: it is the change, not affected by it, and e is now one level out.
  assert.deepEqual(affected(["b.ts", "d.ts"], edges), [
    { path: "a.ts", depth: 1 },
    { path: "c.ts", depth: 1 },
    { path: "e.ts", depth: 1 },
  ]);
  // A changed file gone from the head side has nothing importing it there.
  assert.deepEqual(affected(["gone.ts"], edges), []);
});

const coverage = (found: number, parsed: number, internal: number, unresolved: number): SideCoverage => ({
  files: { parsed, unparsed: found - parsed },
  imports: { internal, unresolved },
});

test("coverage that matches raises nothing", () => {
  assert.deepEqual(coverageGap(coverage(100, 100, 90, 10), coverage(102, 102, 92, 10)).differs, []);
});

test("coverage that differs past two points is reported, per share", () => {
  // Base resolved 60% of its imports, head 90%: most "added" edges would be the base parse's misses.
  assert.deepEqual(coverageGap(coverage(100, 100, 60, 40), coverage(100, 100, 90, 10)).differs, ["imports"]);
  assert.deepEqual(coverageGap(coverage(100, 90, 50, 0), coverage(100, 100, 50, 0)).differs, ["files"]);
});

test("one side with nothing to count is not comparable", () => {
  assert.deepEqual(coverageGap(coverage(0, 0, 0, 0), coverage(10, 10, 5, 0)).differs, ["files", "imports"]);
});
