import test from "node:test";
import assert from "node:assert/strict";
import { parseHeadings } from "../src/markdown.js";
import { outlineItems } from "../src/outline.js";

// A note's title is its leading level-one heading when the note has no
// other one (src/markdown.js markTitle): the page's title, not a section,
// and not in the outline. The outline indents below the shallowest level
// it shows; an index file's entries go in their places among the headings.

const titleOf = (text) =>
  parseHeadings(text)
    .filter((h) => h.title)
    .map((h) => h.label);

test("the leading level-one heading is the note's title", () => {
  assert.deepEqual(titleOf("# Note\n\nText.\n\n## A\n\n## B\n"), ["Note"]);
  // After front matter and blank lines; a setext heading too.
  assert.deepEqual(titleOf("---\ntitle: x\n---\n\n\n# Note\n\n## A\n"), [
    "Note",
  ]);
  assert.deepEqual(titleOf("Note\n====\n\n## A\n"), ["Note"]);
  // A level-one heading inside a quote is no second title.
  assert.deepEqual(titleOf("# Note\n\n> # Quoted\n"), ["Note"]);
});

test("no title: text before the heading, several level-one headings, none", () => {
  assert.deepEqual(titleOf("Intro.\n\n# Note\n\n## A\n"), []);
  assert.deepEqual(titleOf("# Part I\n\nText.\n\n# Part II\n"), []);
  assert.deepEqual(titleOf("## Only sections\n\n## B\n"), []);
  assert.deepEqual(titleOf(""), []);
});

test("the outline leaves out the title and indents below the shallowest level", () => {
  const items = outlineItems(
    parseHeadings("# Note\n\n## A\n\n### A.1\n\n## B\n"),
  );
  assert.deepEqual(
    items.map((i) => [i.label, i.depth, i.index]),
    [
      ["A", 0, 1],
      ["A.1", 1, 2],
      ["B", 0, 3],
    ],
  );
  // Several level-one headings: all listed, from depth 0.
  assert.deepEqual(
    outlineItems(parseHeadings("# I\n\n## a\n\n# II\n")).map((i) => [
      i.label,
      i.depth,
    ]),
    [
      ["I", 0],
      ["a", 1],
      ["II", 0],
    ],
  );
  // Only ### headings: they are the top level.
  assert.deepEqual(
    outlineItems(parseHeadings("# Note\n\n### x\n\n#### y\n")).map(
      (i) => i.depth,
    ),
    [0, 1],
  );
  assert.deepEqual(outlineItems(parseHeadings("# Note\n\nText.\n")), []);
});

test("an index file's entries sit in their places, under the heading above", () => {
  const text =
    "# Book\n\n- [One](One.md)\n  - [One.1](One.1.md)\n\n## Appendix\n\n- [Notes](Notes.md)\n";
  const headings = parseHeadings(text);
  const at = (s) => text.indexOf(s);
  const entries = [
    { label: "One", from: at("- [One]"), depth: 0, line: 2 },
    { label: "One.1", from: at("  - [One.1]"), depth: 1, line: 3 },
    { label: "Notes", from: at("- [Notes]"), depth: 0, line: 7 },
  ];
  assert.deepEqual(
    outlineItems(headings, entries).map((i) => [i.kind, i.label, i.depth]),
    [
      ["entry", "One", 0],
      ["entry", "One.1", 1],
      ["heading", "Appendix", 0],
      ["entry", "Notes", 1],
    ],
  );
  // Without headings: the entries' own two levels.
  assert.deepEqual(
    outlineItems(parseHeadings("# Book\n"), entries.slice(0, 2)).map(
      (i) => i.depth,
    ),
    [0, 1],
  );
});
