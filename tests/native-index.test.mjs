import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseNote, createLinkIndex } from "../desktop/link-index.mjs";
import { parseQuery, rank, searchNote } from "../desktop/note-search.mjs";
import {
  binaryPaths,
  binaryName,
  createIndex,
  indexInfo,
  loadNative,
} from "../desktop/native-index.mjs";
import { writeLibrary, notePath } from "../tools/synthetic-library.mjs";

test("the binary is looked for in the checkout and beside app.asar", () => {
  const name = binaryName("win32", "x64");
  assert.equal(name, "marklore-index.win32-x64.node");
  const app = path.join("C:", "Marklore", "resources", "app.asar");
  const list = binaryPaths(app, path.join("C:", "Marklore", "resources"), name);
  assert.equal(
    list[0],
    path.join(
      "C:",
      "Marklore",
      "resources",
      "app.asar.unpacked",
      "native",
      "index",
      name,
    ),
  );
  assert.ok(list.includes(path.join(app, "native", "index", name)));
  assert.ok(
    list.includes(path.join("C:", "Marklore", "resources", "native", name)),
  );
  const checkout = binaryPaths(path.join("C:", "src", "marklore"), null, name);
  assert.deepEqual(checkout, [
    path.join("C:", "src", "marklore", "native", "index", name),
  ]);
});

test("MARKLORE_INDEX=js uses the JavaScript index", async () => {
  const before = process.env.MARKLORE_INDEX;
  process.env.MARKLORE_INDEX = "js";
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "marklore-js-index-"));
  try {
    assert.equal(loadNative(), null);
    assert.equal(indexInfo().kind, "js");
    await fs.writeFile(path.join(root, "A.md"), "See [B](B.md).\n");
    await fs.writeFile(path.join(root, "B.md"), "# B\n");
    const index = createIndex();
    await index.follow([root]);
    assert.equal(index.size, 2);
    const back = await index.backlinks(path.join(root, "B.md"));
    assert.deepEqual(
      back.map((l) => path.basename(l.source)),
      ["A.md"],
    );
    assert.equal((await index.search("b")).total, 2);
  } finally {
    if (before === undefined) delete process.env.MARKLORE_INDEX;
    else process.env.MARKLORE_INDEX = before;
    await fs.rm(root, { recursive: true, force: true });
  }
});

// Notes that test the edges: windows cutting a surrogate pair, formulas,
// case mapping that changes length, tables, anchors in upper case, encoded
// and malformed targets, CRLF, a byte order mark and odd white space.
const edges = {
  "edge-emoji.md": [
    "# Emoji 🙂 heading",
    "",
    "🙂".repeat(60) + " [to zero](note-0000.md) " + "😀".repeat(100) + ".",
    "",
    '<A ID="Up"></A>',
    "**Défintion 🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂 long label** text",
  ].join("\n"),
  "edge-math.md": [
    "## Σ ΟΔΟΣ İstanbul",
    "",
    "Before $" +
      "\\sum_{k=0}^{N-1} a_k x^k + ".repeat(8) +
      "c$ then [the link](edge-emoji.md#up) after **bold `code` text** and $$x$$ and \\(y\\) end.",
    "",
    "| a | [b](edge-emoji.md) | c\\|d |",
    "| --- | --- | --- |",
    "",
    "[bad](%E4%B8.md) [ok](a%20b.md) [frag only](#Σ-οδος-i̇stanbul) [<x>](<edge math.md#a%23b>)",
    "",
    "Setext　heading",
    "===",
    "",
    'text with﻿spaces [x](./sub/../edge-math.md "title") and ![img](edge-emoji.md)',
  ].join("\r\n"),
  "edge-fence.md":
    "﻿```js\n[no](edge-math.md)\n````\n~~~\n[no](edge-math.md)\n~~~\n# After\n[yes](edge-math.md) `[no](x.md)` ``[no `x` ](y.md)``",
};

const QUERIES = [
  "the",
  "zyzzogeton",
  "收敛",
  '"proof measure"',
  "kernel 矩阵",
  "note",
  "σ",
  "🙂",
  "md",
  "link",
  "",
];

// Real Markdown: the guides, the sample notebooks and the test fixtures.
test("the native parser and search agree on the repository's Markdown", async (t) => {
  const native = loadNative();
  if (!native) {
    t.skip(`no native index binary: ${indexInfo().error}`);
    return;
  }
  const repo = path.resolve(import.meta.dirname, "..");
  const files = [];
  for (const dir of ["docs", "tests/fixtures", "."])
    for (const entry of await fs.readdir(path.join(repo, dir), {
      recursive: dir !== ".",
    }))
      if (/\.md$/i.test(entry)) files.push(path.join(repo, dir, entry));
  assert.ok(files.length > 10);
  const queries = [
    "the",
    "傅里叶",
    "fourier transform",
    "$",
    "](",
    "**",
    "定理 卷积",
    '"sample notebook"',
  ];
  for (const file of files) {
    const text = (await fs.readFile(file, "utf8")).replace(/^﻿/, "");
    assert.deepEqual(native.parseNote(text, file), parseNote(text, file), file);
    const name = path.basename(file);
    for (const q of queries) {
      const terms = parseQuery(q);
      assert.deepEqual(
        native.searchNote(file, name, text, terms, 5),
        searchNote({ path: file, name, text }, terms, { maxHits: 5 }),
        `${file} ${q}`,
      );
    }
  }
});

test("the native index gives the JavaScript index's results", async (t) => {
  const native = loadNative();
  if (!native) {
    t.skip(`no native index binary: ${indexInfo().error}`);
    return;
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "marklore-native-"));
  try {
    const total = Number(process.env.MARKLORE_COMPARE_NOTES || 600);
    await writeLibrary(root, total);
    for (const [name, text] of Object.entries(edges))
      await fs.writeFile(path.join(root, "area-0", name), text);
    const files = [
      ...Array.from({ length: total }, (_, i) => notePath(root, i)),
      ...Object.keys(edges).map((name) => path.join(root, "area-0", name)),
    ];
    // Parsing and searching each note.
    for (const file of files) {
      const text = (await fs.readFile(file, "utf8")).replace(/^﻿/, "");
      assert.deepEqual(
        native.parseNote(text, file),
        parseNote(text, file),
        file,
      );
      const name = path.basename(file);
      for (const q of QUERIES) {
        const terms = parseQuery(q);
        assert.equal(
          native.rankNote(name, text, terms) ?? null,
          rank({ name, text }, terms),
          `${file} ${q}`,
        );
        assert.deepEqual(
          native.searchNote(file, name, text, terms, 3),
          searchNote({ path: file, name, text }, terms, { maxHits: 3 }),
          `${file} ${q}`,
        );
      }
    }
    // The whole index.
    const js = createLinkIndex(),
      nat = createIndex();
    await Promise.all([js.follow([root]), nat.follow([root])]);
    assert.equal(nat.size, js.size);
    assert.deepEqual(await nat.notes(), await js.notes());
    const sample = [0, 1, 5, 42, total - 1].map((i) => notePath(root, i));
    sample.push(path.join(root, "area-0", "edge-emoji.md"));
    for (const file of sample) {
      assert.deepEqual(
        await nat.backlinks(file),
        await js.backlinks(file),
        file,
      );
      assert.deepEqual(await nat.anchors(file), await js.anchors(file), file);
      assert.equal(nat.has(file), js.has(file));
    }
    for (const q of QUERIES)
      for (const options of [undefined, { maxNotes: 7, maxHits: 1 }])
        assert.deepEqual(
          await nat.search(q, options),
          await js.search(q, options),
          q,
        );
    const from = notePath(root, 3);
    for (const href of [
      "../area-0/note-0000.md",
      "note-9999.md",
      "#nope",
      "x.md#L3",
    ])
      assert.equal(
        await nat.status(from, href),
        await js.status(from, href),
        href,
      );
    // A note changed, and a folder left out.
    const changed = notePath(root, 7);
    await fs.appendFile(
      changed,
      "\n[new](../area-0/note-0000.md) zyzzogeton\n",
    );
    assert.equal(await nat.changed(changed), await js.changed(changed));
    const popular = notePath(root, 0);
    assert.deepEqual(await nat.backlinks(popular), await js.backlinks(popular));
    assert.deepEqual(
      await nat.search("zyzzogeton"),
      await js.search("zyzzogeton"),
    );
    const excluded = [path.join(root, "area-1")];
    await Promise.all([
      js.follow([root], excluded),
      nat.follow([root], excluded),
    ]);
    assert.equal(nat.size, js.size);
    assert.deepEqual(await nat.notes(), await js.notes());
    assert.deepEqual(await nat.backlinks(popular), await js.backlinks(popular));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
