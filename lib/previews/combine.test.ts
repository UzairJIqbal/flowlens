import assert from "node:assert/strict";
import { test } from "node:test";
import { fold } from "../map/fold.ts";
import { buildView, folderFan, onSide, type ChangeSide } from "../map/view.ts";
import { fanInOut } from "../parser/graph.ts";
import type { ChangedFile } from "../pipeline/github.ts";
import { changedBoxes, combine } from "./combine.ts";
import type { PreviewCoverage, PreviewEdge, PreviewSide } from "./side.ts";

// Two hand-made sides, so each expected answer can be checked by eye.

const COVERAGE: PreviewCoverage = { found: 0, parsed: 0, unparsed: 0, internal: 0, external: 0, excluded: 0, unresolved: 0 };

function side(paths: string[], edges: [string, string][], coverage: Partial<PreviewCoverage> = {}): PreviewSide {
  return {
    adapter: "generic",
    files: paths.map((path) => ({ path, folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".", lines: 1, role: null })),
    edges: edges.map(([from, to]): PreviewEdge => ({ from, to, kinds: ["import"], typeOnly: false })),
    coverage: { ...COVERAGE, parsed: paths.length, internal: edges.length, ...coverage },
    warnings: [],
    unparsed: [],
  };
}

const modified = (path: string): ChangedFile => ({ path, status: "modified", previousPath: null });

test("the map holds both sides' files, each marked with where it exists", () => {
  const { files } = combine(side(["a.ts", "gone.ts"], []), side(["a.ts", "new.ts"], []), []);
  assert.deepEqual(
    files.map((f) => [f.path, f.onBase, f.onHead]),
    [
      ["a.ts", true, true],
      ["gone.ts", true, false],
      ["new.ts", false, true],
    ],
  );
});

test("a pair on one side alone carries which, a pair on both carries nothing", () => {
  const base = side(["a.ts", "b.ts", "c.ts"], [["a.ts", "b.ts"], ["a.ts", "c.ts"]]);
  const head = side(["a.ts", "b.ts", "c.ts"], [["a.ts", "b.ts"], ["b.ts", "c.ts"]]);
  assert.deepEqual(combine(base, head, [modified("a.ts"), modified("b.ts")]).edges, [
    { from: "a.ts", to: "b.ts" },
    { from: "a.ts", to: "c.ts", change: "removed" },
    { from: "b.ts", to: "c.ts", change: "added" },
  ]);
});

test("affected is measured after the change, and a rename counts both names as changed", () => {
  const base = side(["app.ts", "old.ts", "page.ts"], [["page.ts", "app.ts"], ["app.ts", "old.ts"]]);
  const head = side(["app.ts", "new.ts", "page.ts"], [["page.ts", "app.ts"], ["app.ts", "new.ts"]]);
  const change = combine(base, head, [{ path: "new.ts", status: "renamed", previousPath: "old.ts" }]);
  assert.deepEqual(change.changedPaths, ["new.ts", "old.ts"]);
  assert.deepEqual(change.affected, [
    { path: "app.ts", depth: 1 },
    { path: "page.ts", depth: 2 },
  ]);
});

test("two sides parsed unequally raise the coverage gap", () => {
  const base = side(["a.ts", "b.ts"], [["a.ts", "b.ts"]], { internal: 90, unresolved: 10 });
  const head = side(["a.ts", "b.ts"], [["a.ts", "b.ts"]], { internal: 70, unresolved: 30 });
  assert.deepEqual(combine(base, head, []).gap.differs, ["imports"]);
  assert.deepEqual(combine(base, base, []).gap.differs, []);
});

test("a change inside one folder is drawn on load, as loops, each on its own side", () => {
  // The case that drew nothing: every file in the root, so one box, and
  // every import inside it.
  const base = side(["a.ts", "b.ts", "c.ts", "d.ts"], [["a.ts", "b.ts"], ["c.ts", "b.ts"]]);
  const head = side(["a.ts", "b.ts", "c.ts", "d.ts"], [["c.ts", "b.ts"], ["d.ts", "c.ts"]]);
  const change = combine(base, head, [modified("a.ts"), modified("d.ts")]);

  // What the workspace does on its first render, with no click.
  const folded = fold(change.files);
  const open = changedBoxes(folded, change.changedPaths);
  const counts = fanInOut(
    change.files.map((f) => f.path),
    change.edges,
  );
  const facts = new Map(change.files.map((f) => [f.path, { path: f.path, ...counts.get(f.path)! }]));
  const view = buildView(folded, folderFan(folded, change.edges), facts, change.edges, open);

  assert.deepEqual([...open], ["."]);
  // The unchanged import c.ts → b.ts stays undrawn, as it is on any map.
  assert.deepEqual(
    view.edges.map((e) => [e.source, e.target, e.files.map((f) => `${f.from}>${f.to}`), e.change]),
    [
      [".", ".", ["a.ts>b.ts"], "removed"],
      [".", ".", ["d.ts>c.ts"], "added"],
    ],
  );
  const drawn = (s: ChangeSide) => view.edges.filter((e) => onSide(e.change ?? undefined, s)).map((e) => e.change);
  assert.deepEqual(drawn("before"), ["removed"]);
  assert.deepEqual(drawn("after"), ["added"]);
  assert.deepEqual(drawn("both"), ["removed", "added"]);
});
