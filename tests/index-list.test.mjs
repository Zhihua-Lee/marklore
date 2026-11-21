import test from "node:test";
import assert from "node:assert/strict";
import {
  scanIndex,
  moveEntry,
  indentEntry,
  outdentEntry,
  shiftEntry,
  insertEntry,
  removeEntry,
  retitleEntry,
  relinkEntry,
  noteExcerpt,
  difference,
} from "../src/index-list.js";

// An OneNote-style index: front matter, a title, intro text, a comment, a
// code block with a link-like line, three levels, prose between two lists.
const index = [
  "---",
  "title: 课程笔记",
  "- [Not](an-entry.md)",
  "---",
  "# 课程笔记",
  "",
  "Intro text with a [link](Elsewhere.md).",
  "",
  "<!-- - [Commented](Out.md) -->",
  "",
  "- [第一章](第一章.md)",
  "  - [1.1 概念](1.1%20概念.md)",
  "    - [细节](细节.md)",
  "  - [1.2 练习](练习.md)",
  "- [第二章](第二章.md)",
  "",
  "```",
  "- [Code](code.md)",
  "```",
  "",
  "## 附录",
  "",
  "* [附录 A](A.md)",
  "* [附录 B](B.md)",
  "",
].join("\n");

// Applying the one change gives the text returned.
function applied(text, result) {
  const { from, to, insert } = result.change;
  return text.slice(0, from) + insert + text.slice(to);
}
// The title of the entry an edit names as the one acted on.
const lineTitle = (result) =>
  scanIndex(result.text).entries.find((entry) => entry.line === result.line)
    .title;
const at = (text, title) =>
  scanIndex(text).entries.find((entry) => entry.title === title).index;

test("only list items starting with a link, outside front matter, comments and code, are entries", () => {
  const scan = scanIndex(index);
  assert.deepEqual(
    scan.entries.map((e) => [e.title, e.depth, e.name]),
    [
      ["第一章", 0, "第一章.md"],
      ["1.1 概念", 1, "1.1 概念.md"],
      ["细节", 2, "细节.md"],
      ["1.2 练习", 1, "练习.md"],
      ["第二章", 0, "第二章.md"],
      ["附录 A", 0, "A.md"],
      ["附录 B", 0, "B.md"],
    ],
  );
  assert.equal(scan.runs.length, 2);
  assert.deepEqual(scan.runs[0].roots, [0, 4]);
});

test("a move takes the entry's sub-list with it and changes nothing else", () => {
  const result = moveEntry(
    index,
    at(index, "第一章"),
    at(index, "第二章"),
    "after",
  );
  assert.equal(applied(index, result), result.text);
  assert.equal(
    result.text,
    index.replace(
      "- [第一章](第一章.md)\n  - [1.1 概念](1.1%20概念.md)\n    - [细节](细节.md)\n  - [1.2 练习](练习.md)\n- [第二章](第二章.md)\n",
      "- [第二章](第二章.md)\n- [第一章](第一章.md)\n  - [1.1 概念](1.1%20概念.md)\n    - [细节](细节.md)\n  - [1.2 练习](练习.md)\n",
    ),
  );
  assert.equal(lineTitle(result), "第一章");
  // Not into its own sub-list.
  assert.equal(
    moveEntry(index, at(index, "第一章"), at(index, "细节"), "into"),
    null,
  );
});

test("indent and outdent nest under the entry before, and come back", () => {
  const indented = indentEntry(index, at(index, "第二章"));
  assert.match(
    indented.text,
    /\n {2}- \[1\.2 练习\]\(练习\.md\)\n {2}- \[第二章\]/,
  );
  const back = outdentEntry(indented.text, at(indented.text, "第二章"));
  assert.equal(back.text, index);
  // The first entry of a level has nothing to go under.
  assert.equal(indentEntry(index, at(index, "第一章")), null);
  assert.equal(outdentEntry(index, at(index, "第一章")), null);
});

test("a first sub-item is indented as the index nests: spaces, or tabs", () => {
  const spaces = indentEntry(index, at(index, "附录 B"));
  assert.match(spaces.text, /\* \[附录 A\]\(A\.md\)\n {2}\* \[附录 B\]/);
  const tabbed = "- [A](A.md)\n\t- [A1](A1.md)\n- [B](B.md)\n- [C](C.md)\n";
  const result = indentEntry(tabbed, at(tabbed, "C"));
  assert.equal(
    result.text,
    "- [A](A.md)\n\t- [A1](A1.md)\n- [B](B.md)\n\t- [C](C.md)\n",
  );
  // Four-space nesting stays four spaces.
  const four = "- [A](A.md)\n    - [A1](A1.md)\n- [B](B.md)\n- [C](C.md)\n";
  assert.equal(
    indentEntry(four, at(four, "C")).text,
    "- [A](A.md)\n    - [A1](A1.md)\n- [B](B.md)\n    - [C](C.md)\n",
  );
});

test("Alt+arrows swap with the neighbour at the same level only", () => {
  const up = shiftEntry(index, at(index, "1.2 练习"), -1);
  assert.match(
    up.text,
    /- \[第一章\]\(第一章\.md\)\n {2}- \[1\.2 练习\]\(练习\.md\)\n {2}- \[1\.1 概念\]\(1\.1%20概念\.md\)\n {4}- \[细节\]/,
  );
  assert.equal(shiftEntry(index, at(index, "1.1 概念"), -1), null);
  assert.equal(shiftEntry(index, at(index, "第二章"), 1), null);
});

test("CRLF line endings and a BOM stay byte for byte", () => {
  const crlf = "﻿" + index.replace(/\n/g, "\r\n");
  const result = moveEntry(
    crlf,
    at(crlf, "附录 B"),
    at(crlf, "附录 A"),
    "before",
  );
  assert.ok(result.text.startsWith("﻿# ") === false);
  assert.ok(result.text.startsWith("﻿---\r\n"));
  assert.equal(
    result.text,
    crlf.replace(
      "* [附录 A](A.md)\r\n* [附录 B](B.md)\r\n",
      "* [附录 B](B.md)\r\n* [附录 A](A.md)\r\n",
    ),
  );
  assert.equal(applied(crlf, result), result.text);
  // Round trip.
  const back = moveEntry(
    result.text,
    at(result.text, "附录 B"),
    at(result.text, "附录 A"),
    "after",
  );
  assert.equal(back.text, crlf);
  // Mixed endings: each line keeps its own.
  const mixed = "- [A](A.md)\r\n- [B](B.md)\n- [C](C.md)\r\n";
  const swapped = shiftEntry(mixed, at(mixed, "A"), 1);
  assert.equal(swapped.text, "- [B](B.md)\n- [A](A.md)\r\n- [C](C.md)\r\n");
});

test("a last line without a line ending stays the last without one", () => {
  const text = "- [A](A.md)\n- [B](B.md)";
  const result = shiftEntry(text, at(text, "B"), -1);
  assert.equal(result.text, "- [B](B.md)\n- [A](A.md)");
  assert.equal(shiftEntry(result.text, 1, -1).text, text);
});

test("numbered lists keep their numbers; a moved entry takes its neighbours' kind", () => {
  const numbered = "1. [A](A.md)\n2. [B](B.md)\n3. [C](C.md)\n";
  assert.equal(
    shiftEntry(numbered, at(numbered, "C"), -1).text,
    "1. [A](A.md)\n3. [C](C.md)\n2. [B](B.md)\n",
  );
  const added = insertEntry(numbered, { title: "D", href: "D.md" });
  assert.equal(added.text, numbered + "4. [D](D.md)\n");
  const mixed = "- [A](A.md)\n\n1. [X](X.md)\n";
  const into = moveEntry(mixed, at(mixed, "X"), at(mixed, "A"), "after");
  assert.equal(into.text, "- [A](A.md)\n- [X](X.md)\n\n");
  const star = "* [A](A.md)\n\n- [X](X.md)\n";
  assert.equal(
    moveEntry(star, at(star, "X"), at(star, "A"), "before").text,
    "* [X](X.md)\n* [A](A.md)\n\n",
  );
});

test("insert a child, a sibling, at the end, or into a text with no list yet", () => {
  const child = insertEntry(
    index,
    { title: "细节 [2]", href: "细节%202.md" },
    at(index, "细节"),
    "into",
  );
  assert.match(
    child.text,
    /\n {4}- \[细节\]\(细节\.md\)\n {6}- \[细节 \\\[2\\\]\]\(细节%202\.md\)\n/,
  );
  assert.equal(lineTitle(child), "细节 [2]");
  const end = insertEntry(index, { title: "附录 C", href: "C.md" });
  assert.match(end.text, /\* \[附录 B\]\(B\.md\)\n\* \[附录 C\]\(C\.md\)\n$/);
  assert.equal(
    insertEntry("# Title\n\nIntro", { title: "A", href: "A.md" }).text,
    "# Title\n\nIntro\n\n- [A](A.md)\n",
  );
  assert.equal(
    insertEntry("# Title\n", { title: "A", href: "A.md" }).text,
    "# Title\n\n- [A](A.md)\n",
  );
  assert.equal(
    insertEntry("", { title: "A", href: "A.md" }).text,
    "- [A](A.md)\n",
  );
});

test("remove takes one line; the entries under it move up a level", () => {
  const result = removeEntry(index, at(index, "第一章"));
  assert.match(
    result.text,
    /\n- \[1\.1 概念\]\(1\.1%20概念\.md\)\n {2}- \[细节\]\(细节\.md\)\n- \[1\.2 练习\]\(练习\.md\)\n- \[第二章\]/,
  );
  const tabs = "- [A](A.md)\n\t- [A1](A1.md)\n\t\t- [A2](A2.md)\n";
  assert.equal(removeEntry(tabs, 0).text, "- [A1](A1.md)\n\t- [A2](A2.md)\n");
  const leaf = removeEntry(index, at(index, "附录 B"));
  assert.equal(leaf.text, index.replace("* [附录 B](B.md)\n", ""));
});

test("retitle changes the link text only; relink the target only", () => {
  const titled = retitleEntry(index, at(index, "第二章"), "第二章 ] 新");
  assert.equal(
    titled.text,
    index.replace("- [第二章](第二章.md)", "- [第二章 \\] 新](第二章.md)"),
  );
  assert.equal(titled.change.insert, " \\] 新");
  assert.equal(retitleEntry(index, at(index, "第二章"), "第二章"), null);
  assert.equal(retitleEntry(index, at(index, "第二章"), "  "), null);
  const angled = '- [A](<Old name.md> "tip") and more\n';
  assert.equal(
    relinkEntry(angled, 0, "New%20name.md").text,
    '- [A](<New name.md> "tip") and more\n',
  );
  assert.equal(
    relinkEntry(index, at(index, "附录 A"), "A2.md").text,
    index.replace("(A.md)", "(A2.md)"),
  );
});

test("one change from the first to the last differing character", () => {
  assert.deepEqual(difference("abcXdef", "abcYYdef"), {
    from: 3,
    to: 4,
    insert: "YY",
  });
  assert.equal(difference("same", "same"), null);
});

test("an excerpt is the note's first sentence, in plain text", () => {
  assert.equal(
    noteExcerpt(
      "---\nonenote_id: 1\n---\n# 第一章\n\n![图](a.png)\n\n本章介绍**基本概念**和[术语](t.md)。后面还有。\n",
      "第一章",
    ),
    "本章介绍基本概念和术语。",
  );
  assert.equal(noteExcerpt("# Only a heading\n", "Other"), "Only a heading");
  assert.equal(noteExcerpt("# Same\n", "Same"), "");
  assert.equal(
    noteExcerpt("```\ncode\n```\n> Quoted `text` here. And more.\n"),
    "Quoted text here.",
  );
  const long = noteExcerpt("x".repeat(100));
  assert.equal(Array.from(long).length, 61);
  assert.ok(long.endsWith("…"));
  assert.equal(noteExcerpt("<!--\nhidden\n-->\n- [ ] task item"), "task item");
  assert.equal(
    noteExcerpt("求集合 $\\{1-1/n\\}$ 的上确界。"),
    "求集合 {1-1/n} 的上确界。",
  );
});

// Nesting survives a marker of another width and tab indentation; link
// destinations with angle brackets, parentheses and titles stay whole.
const nesting = (text) =>
  scanIndex(text).entries.map((e) => [e.title, e.depth]);

test("sub-pages stay under an entry whose marker gets wider", () => {
  const text = "1. [B](b.md)\n- [A](a.md)\n  - [A1](a1.md)\n";
  // Into B: A becomes a numbered sub-item; A1 stays under A.
  assert.deepEqual(nesting(indentEntry(text, 1).text), [
    ["B", 0],
    ["A", 1],
    ["A1", 2],
  ]);
  // After B as "2.": A1 still under A, and only the moved lines change.
  const after = moveEntry(text, 1, 0, "after");
  assert.deepEqual(nesting(after.text), [
    ["B", 0],
    ["A", 0],
    ["A1", 1],
  ]);
  assert.equal(after.text, "1. [B](b.md)\n2. [A](a.md)\n   - [A1](a1.md)\n");
});

test("a tab stepping past the width taken away keeps the rest as spaces", () => {
  const text = "- [P](p.md)\n  - [C](c.md)\n\t- [G](g.md)\n";
  assert.deepEqual(nesting(removeEntry(text, 0).text), [
    ["C", 0],
    ["G", 1],
  ]);
  assert.deepEqual(nesting(outdentEntry(text, 1).text), [
    ["P", 0],
    ["C", 0],
    ["G", 1],
  ]);
});

test("a first sub-item in a tab-nested index reaches the entry's text", () => {
  const text = "- [A](a.md)\n\t- [A1](a1.md)\n100. [X](x.md)\n";
  const result = insertEntry(text, { title: "Y", href: "y.md" }, 2, "into");
  assert.deepEqual(nesting(result.text).at(-1), ["Y", 1]);
});

test("link destinations in angle brackets, with parentheses or a title", () => {
  const text = [
    "- [Lecture](<Lecture (1).md>)",
    '- [Notes](notes.md "see (v2)")',
    "- [Paren](a(b).md)",
    "",
  ].join("\n");
  assert.deepEqual(
    scanIndex(text).entries.map((e) => [e.href, e.name]),
    [
      ["<Lecture (1).md>", "Lecture (1).md"],
      ['notes.md "see (v2)"', "notes.md"],
      ["a(b).md", "a(b).md"],
    ],
  );
  // Text after an unbalanced parenthesis is not part of the link.
  assert.equal(scanIndex("- [A](a.md) (draft)\n").entries[0].rest, " (draft)");
  // Pointed elsewhere: the brackets and the link title stay, the line whole.
  assert.equal(
    relinkEntry(text, 0, "Other.md").text.split("\n")[0],
    "- [Lecture](<Other.md>)",
  );
  assert.equal(
    relinkEntry(text, 1, "Other.md").text.split("\n")[1],
    '- [Notes](Other.md "see (v2)")',
  );
});
