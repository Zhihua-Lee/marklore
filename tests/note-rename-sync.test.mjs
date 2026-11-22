// Renaming a note renames everything at once (desktop/note-names.mjs): its
// file, its index entry, its heading and front-matter title, and the links
// to it, anchors included. A library shaped like a OneNote export: CJK
// names, spaces written %20, full-width punctuation, entry texts and
// headings that differ from the file names, child pages, a subfolder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileStore } from "../desktop/files.mjs";
import { createLinkIndex } from "../desktop/link-index.mjs";
import { createNoteMoves } from "../desktop/note-moves.mjs";

const FILES = {
  "_目录.md":
    "# 课程笔记\r\n\r\n- [第一章：集合与映射](第一章_集合与映射.md)\r\n  - [1.1 集合 （定义）](1.1%20集合%20（定义）.md)\r\n  - [映射](1.2%20映射.md)\r\n- [第二章 极限](第二章%20极限.md)\r\n- [习题](习题/_目录.md)\r\n",
  "第一章_集合与映射.md":
    "# 第一章：集合与映射\n\n见 [映射](1.2%20映射.md#12-映射) 和 [定义](<1.1 集合 （定义）.md#集合>)\n",
  "1.1 集合 （定义）.md":
    "---\ntitle: 1.1 集合 （定义）\n---\n\n# 1.1 集合 （定义）\n\n回到 [第一章](第一章_集合与映射.md)\n",
  "1.2 映射.md":
    "---\ntitle: 1.2 映射\n---\n# 1.2 映射\n\n[本页顶部](#12-映射)\n\n## 定义\n",
  "第二章 极限.md":
    '# 第二章 极限\n\n[第一章](第一章_集合与映射.md#第一章集合与映射) [映射](1.2%20映射.md "映射")\n',
  "习题/_目录.md": "- [习题一](习题一.md)\n",
  "习题/习题一.md":
    "[映射](../1.2%20映射.md#12-映射) [定义](../1.2%20映射.md#定义) [ch2](../%E7%AC%AC%E4%BA%8C%E7%AB%A0%20%E6%9E%81%E9%99%90.md)\n",
  "无标题.md": "只有正文\n",
};

async function library() {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "marklore-names-")),
  );
  const kb = path.join(dir, "kb");
  for (const [name, text] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(kb, name)), { recursive: true });
    await fs.writeFile(path.join(kb, name), text);
  }
  const store = new FileStore({ backups: path.join(dir, "backups") });
  store.roots = [kb];
  const index = createLinkIndex();
  await index.follow([kb]);
  const moves = createNoteMoves({
    files: store,
    linkIndex: index,
    undoFile: path.join(dir, "last-move.json"),
  });
  const root = await store.directory(kb);
  const read = (name) => fs.readFile(path.join(kb, name), "utf8");
  // As main's planRename and renameEntry do it.
  async function rename(name, title, { drafts = [], previous = null } = {}) {
    const options = { title, previous };
    const plan = await store.renameDetails(root.id, name, null, options);
    const planned =
      plan.target === plan.source ? [] : [[plan.source, plan.target]];
    const affected = await moves.plan(planned, {
      skip: [path.join(kb, "_目录.md")],
      anchors: plan.anchors,
    });
    const done = await moves.run({
      label: { kind: "rename", name, to: plan.newName },
      moves: planned,
      links: true,
      drafts,
      anchors: plan.anchors,
      perform: () =>
        store.renameEntry(root.id, name, plan.newName, { drafts, ...options }),
    });
    return { plan, affected, done };
  }
  return { dir, kb, store, root, moves, read, rename };
}

test("a note renamed by its name: file, index entry, heading, title and every link follow", async () => {
  const lib = await library();
  const { read } = lib;
  try {
    const { plan, affected, done } = await lib.rename(
      "1.2 映射.md",
      "1.2 映射：函数",
    );
    assert.equal(plan.newName, "1.2 映射：函数.md");
    assert.deepEqual(
      affected.map((a) => [a.name, a.links]).sort(),
      [
        ["1.2 映射.md", 1],
        ["习题一.md", 2],
        ["第一章_集合与映射.md", 1],
        ["第二章 极限.md", 1],
      ].sort(),
    );
    assert.equal(done.rewritten, 4);
    assert.deepEqual(done.failed, []);
    await assert.rejects(read("1.2 映射.md"));
    assert.equal(
      await read("1.2 映射：函数.md"),
      "---\ntitle: 1.2 映射：函数\n---\n# 1.2 映射：函数\n\n[本页顶部](#12-映射函数)\n\n## 定义\n",
    );
    assert.equal(
      await read("_目录.md"),
      "# 课程笔记\r\n\r\n- [第一章：集合与映射](第一章_集合与映射.md)\r\n  - [1.1 集合 （定义）](1.1%20集合%20（定义）.md)\r\n  - [1.2 映射：函数](1.2%20映射：函数.md)\r\n- [第二章 极限](第二章%20极限.md)\r\n- [习题](习题/_目录.md)\r\n",
    );
    assert.equal(
      await read("第一章_集合与映射.md"),
      "# 第一章：集合与映射\n\n见 [映射](1.2%20映射：函数.md#12-映射函数) 和 [定义](<1.1 集合 （定义）.md#集合>)\n",
    );
    assert.equal(
      await read("习题/习题一.md"),
      "[映射](../1.2%20映射：函数.md#12-映射函数) [定义](../1.2%20映射：函数.md#定义) [ch2](../%E7%AC%AC%E4%BA%8C%E7%AB%A0%20%E6%9E%81%E9%99%90.md)\n",
    );
    assert.match(
      await read("第二章 极限.md"),
      /\(1\.2%20映射：函数\.md "映射"\)/,
    );
    // One undo puts every file back.
    const back = await lib.moves.undo({
      relocate: (from, to) => lib.store.relocate(from, to),
    });
    assert.deepEqual(back.skipped, []);
    for (const name of Object.keys(FILES))
      assert.equal(await read(name), FILES[name], name);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("names Windows refuses are mapped; a taken name gets a number", async () => {
  const lib = await library();
  try {
    const first = await lib.rename("1.2 映射.md", '映射: "定义"? <A|B>.');
    assert.equal(first.plan.newName, "映射： ＂定义＂？ ＜A｜B＞.md");
    assert.match(
      await lib.read(first.plan.newName),
      /^---\ntitle: "映射: \\"定义\\"\? <A\|B>\."\n---\n# 映射: "定义"\? <A\|B>\.\n/,
    );
    assert.match(
      await lib.read("_目录.md"),
      /- \[映射: "定义"\? <A\|B>\.\]\(映射：%20＂定义＂？%20＜A｜B＞\.md\)/,
    );
    // "第二章 极限" renamed to the name of a note already there.
    const second = await lib.rename("第二章 极限.md", "第一章_集合与映射");
    assert.equal(second.plan.newName, "第一章_集合与映射 (2).md");
    assert.match(
      await lib.read("第一章_集合与映射 (2).md"),
      /^# 第一章_集合与映射\n/,
    );
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("a rename with the index or the note open with unsaved changes leaves them to the page", async () => {
  const lib = await library();
  const { kb, read } = lib;
  try {
    const drafts = [path.join(kb, "_目录.md"), path.join(kb, "1.2 映射.md")];
    const { done } = await lib.rename("1.2 映射.md", "映射", { drafts });
    assert.equal(await read("_目录.md"), FILES["_目录.md"]);
    assert.equal(await read("映射.md"), FILES["1.2 映射.md"]);
    assert.deepEqual(
      done.drafts.map((d) => [path.basename(d.path), d.ops[0].kind]),
      [
        ["_目录.md", "rename"],
        ["1.2 映射.md", "note-name"],
      ],
    );
    // The other notes' links on disk do follow.
    assert.match(await read("习题/习题一.md"), /\.\.\/映射\.md#映射\)/);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("undo takes back a heading's anchor in a draft too, saved since or not", async () => {
  const lib = await library();
  const { kb, read } = lib;
  try {
    const draft = path.join(kb, "第一章_集合与映射.md");
    await lib.rename("1.2 映射.md", "1.2 映射：函数", {
      drafts: [draft],
    });
    // The page patched its draft and the reader saved it.
    await fs.writeFile(
      draft,
      FILES["第一章_集合与映射.md"].replace(
        "1.2%20映射.md#12-映射",
        "1.2%20映射：函数.md#12-映射函数",
      ),
    );
    const back = await lib.moves.undo({
      relocate: (from, to) => lib.store.relocate(from, to),
    });
    assert.equal(
      await read("第一章_集合与映射.md"),
      FILES["第一章_集合与映射.md"],
    );
    // A draft still unsaved is the page's: undo says which anchors go back.
    assert.deepEqual(
      back.anchors.map((a) => [path.basename(a.file), a.from, a.to]),
      [["1.2 映射.md", "12-映射函数", "12-映射"]],
    );
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("a save that changed the heading renames the note after it, the anchors following", async () => {
  const lib = await library();
  const { kb, read } = lib;
  try {
    // The note as saved, with its new heading.
    await fs.writeFile(
      path.join(kb, "第一章_集合与映射.md"),
      "# 第一章 集合\n\n见 [映射](1.2%20映射.md#12-映射) 和 [定义](<1.1 集合 （定义）.md#集合>)\n",
    );
    const { plan, done } = await lib.rename(
      "第一章_集合与映射.md",
      "第一章 集合",
      {
        previous: "第一章：集合与映射",
      },
    );
    assert.equal(plan.newName, "第一章 集合.md");
    assert.deepEqual(
      plan.anchors.map((a) => [a.from, a.to]),
      [["第一章集合与映射", "第一章-集合"]],
    );
    assert.ok(done.rewritten >= 2);
    assert.match(
      await read("_目录.md"),
      /- \[第一章 集合\]\(第一章%20集合\.md\)/,
    );
    assert.match(
      await read("第二章 极限.md"),
      /\[第一章\]\(第一章%20集合\.md#第一章-集合\)/,
    );
    assert.match(
      await read("1.1 集合 （定义）.md"),
      /\[第一章\]\(第一章%20集合\.md\)/,
    );
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("unify names: one batch, links followed, one undo", async () => {
  const lib = await library();
  const { kb, store, root, read } = lib;
  try {
    const plan = await store.unifyPlan(root.id, { deep: true });
    const byName = Object.fromEntries(plan.notes.map((n) => [n.name, n]));
    assert.deepEqual(
      Object.keys(byName).sort(),
      ["1.2 映射.md", "无标题.md", "第一章_集合与映射.md", "习题一.md"].sort(),
    );
    assert.equal(byName["第一章_集合与映射.md"].to, "第一章：集合与映射.md");
    assert.deepEqual(byName["1.2 映射.md"].entry, {
      from: "映射",
      to: "1.2 映射",
    });
    assert.equal(byName["1.2 映射.md"].to, null);
    assert.equal(byName["无标题.md"].heading, "无标题");
    assert.equal(byName["习题一.md"].heading, "习题一");
    // Nothing changed yet.
    for (const name of Object.keys(FILES))
      assert.equal(await read(name), FILES[name]);
    const moves = plan.notes
      .filter((n) => n.to)
      .map((n) => [n.path, path.join(n.folder, n.to)]);
    const done = await lib.moves.run({
      label: { kind: "unify", name: "kb", to: "" },
      moves,
      links: true,
      perform: () => store.unifyNames(plan),
    });
    assert.deepEqual(done.failed, []);
    assert.match(
      await read("_目录.md"),
      /- \[第一章：集合与映射\]\(第一章：集合与映射\.md\)\r\n  - \[1\.1 集合 （定义）\]\(1\.1%20集合%20（定义）\.md\)\r\n  - \[1\.2 映射\]\(1\.2%20映射\.md\)/,
    );
    assert.equal(await read("无标题.md"), "# 无标题\n\n只有正文\n");
    assert.match(await read("习题/习题一.md"), /^# 习题一\n\n\[映射\]/);
    assert.match(
      await read("第二章 极限.md"),
      /\(第一章：集合与映射\.md#第一章集合与映射\)/,
    );
    assert.match(
      await read("1.1 集合 （定义）.md"),
      /\[第一章\]\(第一章：集合与映射\.md\)/,
    );
    // Run again: nothing left to unify.
    assert.deepEqual(
      (await store.unifyPlan(root.id, { deep: true })).notes,
      [],
    );
    // A note open with unsaved changes is left out, and named.
    const skipped = await store.unifyPlan(root.id, {
      drafts: [path.join(kb, "无标题.md")],
    });
    assert.deepEqual(
      skipped.skipped.map((s) => s.name),
      ["无标题.md"],
    );
    await lib.moves.undo({ relocate: (from, to) => store.relocate(from, to) });
    for (const name of Object.keys(FILES))
      assert.equal(await read(name), FILES[name], name);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("an index file renamed keeps its heading (the folder's title, not a name)", async () => {
  const lib = await library();
  try {
    const { plan } = await lib.rename("_目录.md", "SUMMARY");
    assert.equal(plan.newName, "SUMMARY.md");
    assert.equal(await lib.read("SUMMARY.md"), FILES["_目录.md"]);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("the tree lists notes with their name (the leading heading)", async () => {
  const lib = await library();
  try {
    const list = await lib.store.list(lib.root.id);
    const byName = Object.fromEntries(list.map((c) => [c.name, c]));
    assert.equal(byName["第一章_集合与映射.md"].title, "第一章：集合与映射");
    assert.equal(byName["1.1 集合 （定义）.md"].heading, "1.1 集合 （定义）");
    assert.equal(byName["无标题.md"].title, undefined);
    assert.deepEqual(await lib.store.folderIndex(lib.root.id), {
      path: path.join(lib.kb, "_目录.md"),
      name: "_目录.md",
    });
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});
