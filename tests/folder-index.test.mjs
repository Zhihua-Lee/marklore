import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  childName,
  findIndexName,
  indexOrder,
  moveInIndex,
  hrefFor,
  insertEntry,
  removeEntry,
  indentEntry,
  outdentEntry,
  shiftEntry,
  renameInIndex,
  retitleEntry,
  applyIndexOp,
  newIndexText,
  subtreeOf,
} from "../desktop/folder-index.mjs";
import { FileStore } from "../desktop/files.mjs";

const index = [
  "# Section",
  "",
  "<!-- Order as in the notebook. -->",
  "",
  "- [Intro](Intro.md)",
  "  - [Detail](Detail%20one.md)",
  "    - [Deeper](深入.md)",
  "- [Topics](Topics/_目录.md)",
  "  - [Inner](Topics/Inner/_目录.md)",
  "- [Missing](Gone.md)",
  "- [Last](Last.md)",
  "",
].join("\n");
const names = ["Intro.md", "Detail one.md", "深入.md", "Topics", "Last.md"];
const has = (name) =>
  names.find((n) => n.toLowerCase() === name.toLowerCase()) || null;

test("an index file is _目录.md or SUMMARY.md, _目录.md first", () => {
  assert.equal(findIndexName(["a.md", "summary.md"]), "summary.md");
  assert.equal(findIndexName(["SUMMARY.md", "_目录.md"]), "_目录.md");
  assert.equal(findIndexName(["a.md"]), null);
});

test("links name the folder's children; deeper and outside links do not", () => {
  assert.equal(childName("Detail%20one.md"), "Detail one.md");
  assert.equal(childName("<My page.md>"), "My page.md");
  assert.equal(childName("./a.md#part"), "a.md");
  assert.equal(childName('a.md "title"'), "a.md");
  assert.equal(childName("Topics/_目录.md"), "Topics");
  assert.equal(childName("Topics/"), "Topics");
  assert.equal(childName("Topics/Inner/_目录.md"), null);
  assert.equal(childName("Topics/page.md"), null);
  assert.equal(childName("../up.md"), null);
  assert.equal(childName("https://example.com/a.md"), null);
  assert.equal(childName("/abs.md"), null);
});

test("the order and nesting come from the list; missing links are skipped", () => {
  assert.deepEqual(indexOrder(index, has), [
    { name: "Intro.md", depth: 0 },
    { name: "Detail one.md", depth: 1 },
    { name: "深入.md", depth: 2 },
    { name: "Topics", depth: 0 },
    { name: "Last.md", depth: 0 },
  ]);
  // A child linked twice shows once, at its first link.
  assert.deepEqual(
    indexOrder("- [a](a.md)\n- [b](b.md)\n  - [a again](a.md)\n", (n) => n),
    [
      { name: "a.md", depth: 0 },
      { name: "b.md", depth: 0 },
    ],
  );
  // Under a missing entry, the shown ones keep the nearest shown parent.
  assert.deepEqual(
    indexOrder("- [x](x.md)\n  - [gone](gone.md)\n    - [y](y.md)\n", (n) =>
      n === "gone.md" ? null : n,
    ),
    [
      { name: "x.md", depth: 0 },
      { name: "y.md", depth: 1 },
    ],
  );
  // Ordered lists and tabs nest as Markdown does.
  assert.deepEqual(
    indexOrder(
      "1. [a](a.md)\n   1. [b](b.md)\n2. [c](c.md)\n\t- [d](d.md)\n",
      (n) => n,
    ),
    [
      { name: "a.md", depth: 0 },
      { name: "b.md", depth: 1 },
      { name: "c.md", depth: 0 },
      { name: "d.md", depth: 1 },
    ],
  );
});

test("moving an entry carries its sub-list and keeps the rest of the file", () => {
  const out = moveInIndex(index, "Intro.md", "Last.md", "after");
  assert.equal(
    out,
    [
      "# Section",
      "",
      "<!-- Order as in the notebook. -->",
      "",
      "- [Topics](Topics/_目录.md)",
      "  - [Inner](Topics/Inner/_目录.md)",
      "- [Missing](Gone.md)",
      "- [Last](Last.md)",
      "- [Intro](Intro.md)",
      "  - [Detail](Detail%20one.md)",
      "    - [Deeper](深入.md)",
      "",
    ].join("\n"),
  );
  // Before an entry; a sub-page out to the top level.
  assert.equal(
    moveInIndex(index, "深入.md", "Intro.md", "before")
      .split("\n")
      .slice(4, 7)
      .join("\n"),
    "- [Deeper](深入.md)\n- [Intro](Intro.md)\n  - [Detail](Detail%20one.md)",
  );
  // Into a note: its last sub-page, indented under its text.
  assert.equal(
    moveInIndex(index, "Last.md", "Intro.md", "into")
      .split("\n")
      .slice(4, 8)
      .join("\n"),
    "- [Intro](Intro.md)\n  - [Detail](Detail%20one.md)\n    - [Deeper](深入.md)\n  - [Last](Last.md)",
  );
  assert.match(
    moveInIndex("1. [a](a.md)\n2. [b](b.md)\n", "b.md", "a.md", "into"),
    /^1\. \[a\]\(a\.md\)\n {3}2\. \[b\]\(b\.md\)\n$/,
  );
});

test("a move that changes nothing or loops into itself is refused", () => {
  assert.equal(moveInIndex(index, "Intro.md", "Intro.md", "after"), null);
  assert.equal(moveInIndex(index, "Intro.md", "深入.md", "into"), null);
  assert.equal(moveInIndex(index, "Intro.md", "Topics", "before"), null);
  assert.equal(moveInIndex(index, "Intro.md", "Nope.md", "before"), null);
  assert.equal(moveInIndex(index, "New.md", "Last.md", "after"), null);
});

test("a child not listed yet gets an entry; line endings and BOM are kept", () => {
  const crlf = "﻿- [a](a.md)\r\n- [b](b.md)\r\n";
  assert.equal(
    moveInIndex(crlf, "New page (2).md", "a.md", "after", { folder: false }),
    "﻿- [a](a.md)\r\n- [New page (2)](New%20page%20%282%29.md)\r\n- [b](b.md)\r\n",
  );
  assert.equal(hrefFor("Sub folder", true), "Sub%20folder/");
  assert.equal(childName(hrefFor("50% [x].md")), "50% [x].md");
});

test("the library lists a folder in its index's order and rewrites it", async () => {
  // The real path: the store resolves folders, and a temp folder may have
  // an 8.3 short name (as on CI).
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "marklore-index-")),
  );
  try {
    for (const name of [
      "Intro.md",
      "Detail one.md",
      "深入.md",
      "Last.md",
      "Zed.md",
      "Aaa.md",
    ])
      await fs.writeFile(path.join(dir, name), "# " + name);
    await fs.mkdir(path.join(dir, "Topics"));
    await fs.mkdir(path.join(dir, "Other"));
    await fs.writeFile(
      path.join(dir, "_目录.md"),
      index.replace(/\n/g, "\r\n"),
    );
    const files = new FileStore({});
    const folder = await files.directory(dir);
    const listed = await files.list(folder.id);
    assert.deepEqual(
      listed.map((item) => [
        item.name,
        item.depth ?? null,
        Boolean(item.index),
      ]),
      [
        ["_目录.md", null, true],
        ["Intro.md", 0, false],
        ["Detail one.md", 1, false],
        ["深入.md", 2, false],
        ["Topics", 0, false],
        ["Last.md", 0, false],
        ["Other", null, false],
        ["Aaa.md", null, false],
        ["Zed.md", null, false],
      ],
    );
    const written = await files.reorderIndex(folder.id, {
      name: "Zed.md",
      target: "Intro.md",
      place: "before",
    });
    assert.equal(written, path.join(dir, "_目录.md"));
    const text = await fs.readFile(written, "utf8");
    assert.match(
      text,
      /\r\n- \[Zed\]\(Zed\.md\)\r\n- \[Intro\]\(Intro\.md\)\r\n/,
    );
    assert.equal((await files.list(folder.id))[1].name, "Zed.md");
    // No temporary file is left behind.
    assert.equal(
      (await fs.readdir(dir)).filter((n) => n.endsWith(".tmp")).length,
      0,
    );
    await assert.rejects(
      files.reorderIndex(folder.id, {
        name: "../x.md",
        target: "Intro.md",
        place: "after",
      }),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("insert: under a note, after one, at the end, or as a new list", () => {
  const text =
    "# T\n\nIntro text.\n\n- [a](a.md)\n  - [a1](a1.md)\n- [b](b.md)\n\nAfter.\n";
  assert.equal(
    insertEntry(text, "New.md", { under: "a.md" }),
    "# T\n\nIntro text.\n\n- [a](a.md)\n  - [a1](a1.md)\n  - [New](New.md)\n- [b](b.md)\n\nAfter.\n",
  );
  assert.equal(
    insertEntry(text, "New.md", { after: "a.md" }),
    "# T\n\nIntro text.\n\n- [a](a.md)\n  - [a1](a1.md)\n- [New](New.md)\n- [b](b.md)\n\nAfter.\n",
  );
  assert.equal(
    insertEntry(text, "Sub dir", { folder: true }),
    "# T\n\nIntro text.\n\n- [a](a.md)\n  - [a1](a1.md)\n- [b](b.md)\n- [Sub dir](Sub%20dir/)\n\nAfter.\n",
  );
  // Listed already, or the parent is not: nothing.
  assert.equal(insertEntry(text, "a1.md"), null);
  assert.equal(insertEntry(text, "x.md", { under: "nope.md" }), null);
  // A file without a list gets one at its end; CRLF and BOM are kept.
  assert.equal(
    insertEntry("﻿# T\r\n\r\nNotes.\r\n", "计划.md"),
    "﻿# T\r\n\r\nNotes.\r\n\r\n- [计划](计划.md)\r\n",
  );
  assert.equal(insertEntry("", "a.md"), "- [a](a.md)\n");
  // Numbered lists stay numbered; tab-indented lists keep tabs.
  assert.equal(
    insertEntry("1. [a](a.md)\n2. [b](b.md)\n", "c.md"),
    "1. [a](a.md)\n2. [b](b.md)\n3. [c](c.md)\n",
  );
  assert.equal(
    insertEntry("* [a](a.md)\n\t* [x](x.md)\n", "y.md", { under: "a.md" }),
    "* [a](a.md)\n\t* [x](x.md)\n\t* [y](y.md)\n",
  );
  // A title of its own, escaped.
  assert.equal(
    insertEntry("- [a](a.md)\n", "n.md", { title: "Notes [draft]" }),
    "- [a](a.md)\n- [Notes \\[draft\\]](n.md)\n",
  );
});

test("remove: the entry's line only; its sub-items move up or go along", () => {
  const text =
    "- [a](a.md)\n    - [b](b.md)\n        - [c](c.md)\n    - [d](d.md)\n- [e](e.md)\n";
  assert.equal(
    removeEntry(text, "a.md"),
    "- [b](b.md)\n    - [c](c.md)\n- [d](d.md)\n- [e](e.md)\n",
  );
  assert.equal(removeEntry(text, "a.md", { subtree: true }), "- [e](e.md)\n");
  assert.equal(
    removeEntry(text, "c.md"),
    "- [a](a.md)\n    - [b](b.md)\n    - [d](d.md)\n- [e](e.md)\n",
  );
  assert.equal(removeEntry(text, "zzz.md"), null);
  // By line: an entry whose link names no child (a missing or deeper one).
  assert.equal(
    removeEntry("- [x](deep/x.md)\n- [a](a.md)\n", { line: 0 }),
    "- [a](a.md)\n",
  );
});

test("indent and outdent move an entry with its sub-items a level", () => {
  const text =
    "- [a](a.md)\n  - [a1](a1.md)\n- [b](b.md)\n  - [b1](b1.md)\n- [c](c.md)\n";
  // Indent: under the entry before it at its level, as its last sub-item.
  assert.equal(
    indentEntry(text, "b.md"),
    "- [a](a.md)\n  - [a1](a1.md)\n  - [b](b.md)\n    - [b1](b1.md)\n- [c](c.md)\n",
  );
  // The first at its level has nothing to go under.
  assert.equal(indentEntry(text, "a.md"), null);
  assert.equal(indentEntry(text, "a1.md"), null);
  // Outdent: right after its parent's sub-list.
  assert.equal(
    outdentEntry(text, "a1.md"),
    "- [a](a.md)\n- [a1](a1.md)\n- [b](b.md)\n  - [b1](b1.md)\n- [c](c.md)\n",
  );
  assert.equal(outdentEntry(text, "c.md"), null);
  // Only notes nest: not a folder, nor under one.
  const folders = "- [Sub](Sub/)\n- [n](n.md)\n- [Box](Box)\n- [m](m.md)\n";
  assert.equal(indentEntry(folders, "n.md"), null);
  assert.equal(
    indentEntry(folders, "Box", {}),
    "- [Sub](Sub/)\n- [n](n.md)\n  - [Box](Box)\n- [m](m.md)\n",
  );
  assert.equal(
    indentEntry(folders, "Box", { isFolder: (n) => n === "Box" }),
    null,
  );
  assert.equal(
    applyIndexOp(folders, { kind: "indent", ref: "m.md", folders: ["Box"] }),
    null,
  );
  // Up and down past a sibling.
  assert.equal(
    shiftEntry(text, "b.md", -1),
    "- [b](b.md)\n  - [b1](b1.md)\n- [a](a.md)\n  - [a1](a1.md)\n- [c](c.md)\n",
  );
  assert.equal(shiftEntry(text, "c.md", 1), null);
});

test("rename: links to the child follow and an unchanged title with them", () => {
  const text = [
    "# Index",
    "",
    "See [plan](Old%20plan.md#goals) above.",
    "",
    "- [Old plan](Old%20plan.md)",
    "  - [My own title](<Old plan.md>)",
    "- [Topics](Topics/_目录.md)",
    "- [Other](Other.md)",
    "",
  ].join("\r\n");
  assert.equal(
    renameInIndex(text, "Old plan.md", "新计划 (2).md"),
    [
      "# Index",
      "",
      "See [plan](新计划%20%282%29.md#goals) above.",
      "",
      "- [新计划 (2)](新计划%20%282%29.md)",
      "  - [My own title](<新计划 (2).md>)",
      "- [Topics](Topics/_目录.md)",
      "- [Other](Other.md)",
      "",
    ].join("\r\n"),
  );
  assert.equal(
    renameInIndex(text, "Topics", "Subjects"),
    text.replace("[Topics](Topics/_目录.md)", "[Subjects](Subjects/_目录.md)"),
  );
  assert.equal(renameInIndex(text, "Nope.md", "X.md"), null);
  // A change of letter case.
  assert.equal(
    renameInIndex("- [other](other.md)\n", "other.md", "Other.md"),
    "- [Other](Other.md)\n",
  );
});

test("retitle and the operation dispatcher", () => {
  const text = "- [a](a.md)\n- [b](b.md)\n";
  assert.equal(
    retitleEntry(text, "b.md", "B [1]"),
    "- [a](a.md)\n- [B \\[1\\]](b.md)\n",
  );
  assert.equal(retitleEntry(text, "b.md", "  "), null);
  assert.equal(
    applyIndexOp(text, {
      kind: "move",
      ref: "b.md",
      target: "a.md",
      place: "before",
    }),
    "- [b](b.md)\n- [a](a.md)\n",
  );
  assert.equal(
    applyIndexOp(text, { kind: "insert", name: "c.md", under: "a.md" }),
    "- [a](a.md)\n  - [c](c.md)\n- [b](b.md)\n",
  );
  assert.equal(
    applyIndexOp(text, { kind: "remove", ref: "a.md" }),
    "- [b](b.md)\n",
  );
  assert.equal(
    applyIndexOp(text, { kind: "indent", ref: { line: 1 } }),
    "- [a](a.md)\n  - [b](b.md)\n",
  );
  assert.equal(applyIndexOp(text, { kind: "outdent", ref: "a.md" }), null);
  assert.equal(
    applyIndexOp(text, { kind: "shift", ref: "a.md", step: 1 }),
    "- [b](b.md)\n- [a](a.md)\n",
  );
  assert.equal(
    applyIndexOp(text, { kind: "rename", from: "a.md", to: "z.md" }),
    "- [z](z.md)\n- [b](b.md)\n",
  );
  assert.equal(
    applyIndexOp(text, { kind: "retitle", ref: "a.md", title: "A" }),
    "- [A](a.md)\n- [b](b.md)\n",
  );
  assert.equal(applyIndexOp(text, { kind: "nope" }), null);
  assert.equal(applyIndexOp(null, { kind: "remove", ref: "a.md" }), null);
});

test("a new index lists the folder's children in the order given", () => {
  assert.equal(
    newIndexText("Notes", [
      { name: "Sub", folder: true, index: "_目录.md" },
      { name: "Box", folder: true },
      { name: "A plan.md" },
      { name: "计划.md" },
    ]),
    "# Notes\n\n- [Sub](Sub/_目录.md)\n- [Box](Box/)\n- [A plan](A%20plan.md)\n- [计划](计划.md)\n",
  );
  assert.deepEqual(
    indexOrder(
      newIndexText("N", [{ name: "Box", folder: true }, { name: "a.md" }]),
      (n) => n,
    ),
    [
      { name: "Box", depth: 0 },
      { name: "a.md", depth: 0 },
    ],
  );
});

test("a note's subtree: its child pages in order, with their titles", () => {
  const text =
    "- [a](a.md)\n  - [Own \\[1\\]](b.md)\n    - [gone](deep/x.md)\n      - [c](c.md)\n  - [d](d.md)\n- [e](e.md)\n";
  assert.deepEqual(subtreeOf(text, "a.md"), [
    { name: "a.md", title: "a", parent: null },
    { name: "b.md", title: "Own [1]", parent: "a.md" },
    { name: "c.md", title: "c", parent: "b.md" },
    { name: "d.md", title: "d", parent: "a.md" },
  ]);
  assert.deepEqual(subtreeOf(text, "e.md"), [
    { name: "e.md", title: "e", parent: null },
  ]);
  assert.deepEqual(subtreeOf(text, "zzz.md"), []);
});
