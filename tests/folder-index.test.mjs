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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "marklore-index-"));
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
