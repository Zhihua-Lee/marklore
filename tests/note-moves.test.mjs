import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileStore, hash } from "../desktop/files.mjs";
import { createLinkIndex } from "../desktop/link-index.mjs";
import { createNoteMoves, movedPath } from "../desktop/note-moves.mjs";
import { createAiStore, renamedNote } from "../desktop/ai-store.mjs";
import { createRecentFiles } from "../desktop/recent.mjs";

// A small library on disk: an index with a note and its child page, a
// folder with its own index, an image beside the notes.
async function library() {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "marklore-moves-")),
  );
  const kb = path.join(dir, "kb");
  const files = {
    "_目录.md":
      "# kb\r\n\r\n- [Plan](Plan.md)\r\n  - [Child](Child.md)\r\n- [Other](Other.md)\r\n- [Topics](Topics/_目录.md)\r\n",
    "Plan.md": "# Plan\n\n![img](assets/a.png) [o](Other.md)\n",
    "Child.md": "[up](Plan.md#top)\n",
    "Other.md":
      "[p](Plan.md#goals) [c](<Child.md>)\n\n```\n[p](Plan.md)\n```\n",
    "Topics/_目录.md": "- [T](T.md)\n",
    "Topics/T.md": "[p](../Plan.md 'The plan')\n",
    "assets/a.png": "png",
  };
  for (const [name, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(kb, name)), { recursive: true });
    await fs.writeFile(path.join(kb, name), text);
  }
  const store = new FileStore({ backups: path.join(dir, "backups") });
  const index = createLinkIndex();
  await index.follow([kb]);
  const synced = [];
  const moves = createNoteMoves({
    files: store,
    linkIndex: index,
    undoFile: path.join(dir, "last-move.json"),
    synced: async (m, written) => synced.push([m, written]),
  });
  const root = await store.directory(kb);
  store.roots = [kb];
  const read = (name) => fs.readFile(path.join(kb, name), "utf8");
  const snapshot = async () => {
    const out = {};
    for (const name of Object.keys(files))
      out[name] = await read(name).catch(() => null);
    return out;
  };
  return { dir, kb, store, index, moves, root, read, snapshot, synced };
}

test("a rename asks which notes link to it, then rewrites them and its index", async () => {
  const lib = await library();
  const { kb, store, moves, root, read } = lib;
  try {
    const before = await lib.snapshot();
    const { source, target } = await store.renameTarget(
      root.id,
      "Plan.md",
      "Road map.md",
    );
    const planned = [[source, target]];
    const affected = await moves.plan(planned, {
      skip: [path.join(kb, "_目录.md")],
    });
    assert.deepEqual(
      affected.map((a) => [a.name, a.links]),
      [
        ["Child.md", 1],
        ["Other.md", 1],
        ["T.md", 1],
      ],
    );
    const done = await moves.run({
      label: "rename",
      moves: planned,
      perform: () => store.renameEntry(root.id, "Plan.md", "Road map.md"),
    });
    assert.equal(done.rewritten, 3);
    assert.deepEqual(done.failed, []);
    assert.equal(
      await read("_目录.md"),
      before["_目录.md"].replace(
        "- [Plan](Plan.md)",
        "- [Road map](Road%20map.md)",
      ),
    );
    assert.equal(
      await read("Other.md"),
      "[p](Road%20map.md#goals) [c](<Child.md>)\n\n```\n[p](Plan.md)\n```\n",
    );
    assert.equal(await read("Child.md"), "[up](Road%20map.md#top)\n");
    assert.equal(
      await read("Topics/T.md"),
      "[p](../Road%20map.md 'The plan')\n",
    );
    // Every file rewritten was backed up first.
    assert.equal((await fs.readdir(path.join(lib.dir, "backups"))).length, 4);
    assert.deepEqual(await moves.last(), {
      label: "rename",
      at: (await moves.last()).at,
    });
    // Undo: names and texts as before, byte for byte.
    const undone = await moves.undo({
      relocate: (a, b) => store.relocate(a, b),
    });
    assert.deepEqual(undone.skipped, []);
    assert.deepEqual(await lib.snapshot(), before);
    assert.equal(await moves.last(), null);
    await assert.rejects(
      moves.undo({ relocate: (a, b) => store.relocate(a, b) }),
      /没有可撤销/,
    );
    assert.equal(lib.synced.length, 2);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("a move with child pages carries their entries and every link along", async () => {
  const lib = await library();
  const { kb, store, moves, root, read } = lib;
  try {
    const before = await lib.snapshot();
    const plan = await store.movePlan(
      root.id,
      "Plan.md",
      path.join(kb, "Topics"),
      { children: true },
    );
    assert.deepEqual(plan.children, ["Child.md"]);
    const affected = await moves.plan(plan.moves, {
      skip: [path.join(kb, "_目录.md"), path.join(kb, "Topics", "_目录.md")],
    });
    assert.deepEqual(
      affected.map((a) => [a.name, a.links]),
      [
        ["Other.md", 2],
        ["Plan.md", 2],
        ["T.md", 1],
      ],
    );
    const done = await moves.run({
      label: "move",
      moves: plan.moves,
      perform: () =>
        store.moveEntry(root.id, "Plan.md", path.join(kb, "Topics"), {
          children: true,
        }),
    });
    assert.equal(done.path, path.join(kb, "Topics", "Plan.md"));
    assert.equal(
      await read("_目录.md"),
      "# kb\r\n\r\n- [Other](Other.md)\r\n- [Topics](Topics/_目录.md)\r\n",
    );
    assert.equal(
      await read("Topics/_目录.md"),
      "- [T](T.md)\n- [Plan](Plan.md)\n  - [Child](Child.md)\n",
    );
    assert.equal(
      await read("Topics/Plan.md"),
      "# Plan\n\n![img](../assets/a.png) [o](../Other.md)\n",
    );
    assert.equal(await read("Topics/Child.md"), "[up](Plan.md#top)\n");
    assert.equal(
      await read("Other.md"),
      "[p](Topics/Plan.md#goals) [c](<Topics/Child.md>)\n\n```\n[p](Plan.md)\n```\n",
    );
    assert.equal(await read("Topics/T.md"), "[p](Plan.md 'The plan')\n");
    await moves.undo({ relocate: (a, b) => store.relocate(a, b) });
    assert.deepEqual(await lib.snapshot(), before);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("open drafts are left to the page; undo skips what changed since", async () => {
  const lib = await library();
  const { kb, store, moves, root, read } = lib;
  try {
    const other = path.join(kb, "Other.md");
    const { source, target } = await store.renameTarget(
      root.id,
      "Plan.md",
      "Roadmap.md",
    );
    const done = await moves.run({
      label: "rename",
      moves: [[source, target]],
      drafts: [other],
      perform: () =>
        store.renameEntry(root.id, "Plan.md", "Roadmap.md", {
          drafts: [other],
        }),
    });
    // Not written: the page applies it to its draft.
    assert.match(await read("Other.md"), /\(Plan\.md#goals\)/);
    assert.deepEqual(done.drafts, []);
    assert.match(await read("_目录.md"), /\[Roadmap\]\(Roadmap\.md\)/);
    // Edited after the rename: undo leaves it and says so.
    await fs.writeFile(path.join(kb, "Child.md"), "edited\n");
    const undone = await moves.undo({
      relocate: (a, b) => store.relocate(a, b),
    });
    assert.deepEqual(undone.skipped, [path.join(kb, "Child.md")]);
    assert.equal(await read("Child.md"), "edited\n");
    assert.equal(
      await read("Plan.md"),
      "# Plan\n\n![img](assets/a.png) [o](Other.md)\n",
    );
    assert.match(await read("Topics/T.md"), /\(\.\.\/Plan\.md/);
    assert.deepEqual(
      movedPath(path.join(kb, "Topics", "T.md"), [
        [path.join(kb, "TOPICS"), path.join(kb, "Subjects")],
      ]),
      path.join(kb, "Subjects", "T.md"),
    );
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("undo refuses when an entry moved again or its old place is taken", async () => {
  const lib = await library();
  const { kb, store, moves, root } = lib;
  try {
    const { source, target } = await store.renameTarget(
      root.id,
      "Other.md",
      "Else.md",
    );
    await moves.run({
      label: "rename",
      moves: [[source, target]],
      perform: () => store.renameEntry(root.id, "Other.md", "Else.md"),
    });
    await fs.writeFile(path.join(kb, "Other.md"), "new\n");
    await assert.rejects(
      moves.undo({ relocate: (a, b) => store.relocate(a, b) }),
      /无法撤销/,
    );
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("the tree's index work: new child page, indent, a new index, backups", async () => {
  const lib = await library();
  const { kb, store, root, read } = lib;
  try {
    // A child page of Other: listed under it.
    const made = await store.createEntry(root.id, "Sub page.md", "note", "", {
      under: "Other.md",
    });
    assert.equal(made.path, path.join(kb, "Sub page.md"));
    assert.match(
      await read("_目录.md"),
      /- \[Other\]\(Other\.md\)\r\n {2}- \[Sub page\]\(Sub%20page\.md\)\r\n/,
    );
    // A new note in an indexed folder goes to the end of its list.
    await store.createEntry(root.id, "Last.md", "note");
    assert.match(await read("_目录.md"), /- \[Last\]\(Last\.md\)\r\n$/);
    // Indent and outdent from the tree.
    await store.editIndex(root.id, { kind: "outdent", ref: "Sub page.md" });
    assert.match(await read("_目录.md"), /\r\n- \[Sub page\]/);
    await store.editIndex(root.id, { kind: "indent", ref: "Sub page.md" });
    assert.match(await read("_目录.md"), /\r\n {2}- \[Sub page\]/);
    // Not under a folder.
    assert.equal(
      await store.editIndex(root.id, { kind: "indent", ref: "Last.md" }),
      null,
    );
    await assert.rejects(
      store.editIndex(root.id, { kind: "remove", ref: "../x.md" }),
    );
    // Drag reordering is backed up like every index rewrite.
    const indexFile = path.join(kb, "_目录.md");
    const prior = await fs.readFile(indexFile);
    await store.reorderIndex(root.id, {
      name: "Last.md",
      target: "Plan.md",
      place: "before",
    });
    assert.deepEqual(
      await fs.readFile(
        path.join(
          lib.dir,
          "backups",
          hash(indexFile) + "-" + hash(prior) + ".bak",
        ),
      ),
      prior,
    );
    // A folder without an index gets one on request, never twice.
    await fs.mkdir(path.join(kb, "Box", "Inner"), { recursive: true });
    await fs.writeFile(path.join(kb, "Box", "b.md"), "");
    await fs.writeFile(path.join(kb, "Box", "a.md"), "");
    await fs.writeFile(path.join(kb, "Box", "Inner", "SUMMARY.md"), "");
    const box = await store.directory(path.join(kb, "Box"));
    await store.createIndex(box.id);
    assert.equal(
      await read("Box/_目录.md"),
      "# Box\n\n- [Inner](Inner/SUMMARY.md)\n- [a](a.md)\n- [b](b.md)\n",
    );
    await assert.rejects(store.createIndex(box.id), /已有目录文件/);
    // Gone to the Recycle Bin: the entry goes, its child pages move up.
    await store.unlistEntry(kb, "Other.md");
    assert.match(await read("_目录.md"), /\r\n- \[Sub page\]/);
    assert.doesNotMatch(await read("_目录.md"), /Other/);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("a move is checked before anything changes", async () => {
  const lib = await library();
  const { kb, store, root } = lib;
  try {
    await assert.rejects(
      store.movePlan(root.id, "Plan.md", kb),
      /已在这个文件夹中/,
    );
    await fs.writeFile(path.join(kb, "Topics", "Plan.md"), "");
    await assert.rejects(
      store.movePlan(root.id, "Plan.md", path.join(kb, "Topics")),
      /已有/,
    );
    const topics = (await store.list(root.id)).find((e) => e.name === "Topics");
    await fs.mkdir(path.join(kb, "Topics", "Deep"));
    await assert.rejects(
      store.movePlan(root.id, "Topics", path.join(kb, "Topics", "Deep")),
      /自己里面/,
    );
    await assert.rejects(
      store.movePlan(root.id, "Plan.md", path.join(lib.dir, "elsewhere")),
    );
    assert.ok(topics);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("marks, waiting proposals and recent notes follow a move; trash puts them aside", async () => {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "marklore-moves-ai-")),
  );
  try {
    const kb = path.join(dir, "kb");
    const plan = path.join(kb, "Plan.md");
    const moved = path.join(kb, "Archive", "Plan.md");
    const store = createAiStore(path.join(dir, "ai"));
    await store.changeMarks(plan, (doc) =>
      doc.marks.push({ id: "m1", quote: "x", text: "fix" }),
    );
    // A mark already on the new path is kept beside the moved ones.
    await store.changeMarks(moved, (doc) =>
      doc.marks.push({ id: "m0", quote: "y", text: "old" }),
    );
    const waiting = await store.create({
      kind: "edit",
      note: "kb/Plan.md",
      file: plan,
      edits: [],
    });
    const other = await store.create({
      kind: "edit",
      note: "kb/Other.md",
      file: path.join(kb, "Other.md"),
      edits: [],
    });
    await store.moveNotes([[kb + path.sep + "Plan.md", moved]]);
    assert.deepEqual((await store.marksOf(plan)).marks, []);
    assert.deepEqual(
      (await store.marksOf(moved)).marks.map((m) => m.id).sort(),
      ["m0", "m1"],
    );
    const p = await store.get(waiting.id);
    assert.equal(p.file, moved);
    assert.equal(p.note, "kb/Archive/Plan.md");
    assert.equal((await store.get(other.id)).file, path.join(kb, "Other.md"));
    assert.equal(
      renamedNote(
        "kb/a/b.md",
        path.join(kb, "a", "b.md"),
        path.join(dir, "x.md"),
      ),
      "kb/a/b.md",
    );
    // A folder renamed: what is inside follows.
    await store.moveNotes([[path.join(kb, "Archive"), path.join(kb, "Old")]]);
    assert.equal(
      (await store.get(waiting.id)).file,
      path.join(kb, "Old", "Plan.md"),
    );
    assert.equal(
      (await store.marksOf(path.join(kb, "Old", "Plan.md"))).marks.length,
      2,
    );
    // To the Recycle Bin: marks put aside, the proposal fails.
    await store.trashNotes([path.join(kb, "Old")]);
    assert.deepEqual(await store.allMarks(), []);
    assert.equal(
      (await fs.readdir(path.join(dir, "ai", "marks", "trashed"))).length,
      1,
    );
    const failed = await store.get(waiting.id);
    assert.equal(failed.status, "failed");
    assert.match(failed.error, /Recycle Bin/);

    // The recent list keeps the place of a renamed note, drops a trashed one.
    const recent = createRecentFiles({ file: path.join(dir, "recent.json") });
    await recent.add(path.join(kb, "B.md"));
    await recent.add(path.join(kb, "Sub", "A.md"));
    await recent.rename([[path.join(kb, "SUB"), path.join(kb, "Topic")]]);
    const saved = JSON.parse(
      await fs.readFile(path.join(dir, "recent.json"), "utf8"),
    );
    assert.deepEqual(saved, [
      path.join(kb, "Topic", "A.md"),
      path.join(kb, "B.md"),
    ]);
    await recent.remove([path.join(kb, "Topic")]);
    assert.ok(await recent.has(path.join(kb, "B.md")));
    assert.equal(await recent.has(path.join(kb, "Topic", "A.md")), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("the link index follows a move at once, and forgets what went", async () => {
  const lib = await library();
  const { kb, index } = lib;
  try {
    const from = path.join(kb, "Other.md");
    const to = path.join(kb, "Else.md");
    await fs.rename(from, to);
    await index.moved([[from, to]]);
    assert.equal(index.has(from), false);
    assert.equal(index.has(to), true);
    assert.equal(
      (await index.backlinks(path.join(kb, "Plan.md"))).some(
        (link) => link.source === to,
      ),
      true,
    );
    assert.equal(index.forget([path.join(kb, "Topics")]), true);
    assert.equal(index.has(path.join(kb, "Topics", "T.md")), false);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

// Review finding 1: a move or undo that fails halfway leaves nothing split.
const failing = (store, fail) => {
  const real = store.renameFile;
  let count = 0;
  store.renameFile = async (from, to) => {
    count++;
    const error = fail(count, from, to);
    if (error) throw Object.assign(Error(error), { code: error });
    return real(from, to);
  };
  return () => (store.renameFile = real);
};

test("a move whose second rename fails is rolled back, with no batch to undo", async () => {
  const lib = await library();
  const { kb, store, moves, root } = lib;
  try {
    const before = await lib.snapshot();
    const plan = await store.movePlan(
      root.id,
      "Plan.md",
      path.join(kb, "Topics"),
      { children: true },
    );
    const restore = failing(store, (n, from) =>
      from.endsWith("Child.md") ? "EACCES" : null,
    );
    // Retried, then given up: the note already moved comes back.
    store.retryWait = 1;
    await assert.rejects(
      moves.run({
        label: "move",
        moves: plan.moves,
        perform: () =>
          store.moveEntry(root.id, "Plan.md", path.join(kb, "Topics"), {
            children: true,
          }),
      }),
    );
    restore();
    assert.deepEqual(await lib.snapshot(), before);
    assert.equal(await moves.last(), null);
    // Another drive: said plainly, nothing moved.
    const back = failing(store, () => "EXDEV");
    await assert.rejects(
      store.moveEntry(root.id, "Other.md", path.join(kb, "Topics")),
      /另一个磁盘/,
    );
    back();
    assert.deepEqual(await lib.snapshot(), before);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("a short lock is waited out: a rename is retried on EBUSY", async () => {
  const lib = await library();
  const { store, root, read } = lib;
  try {
    store.retryWait = 1;
    const restore = failing(store, (n) => (n < 3 ? "EBUSY" : null));
    await store.renameEntry(root.id, "Other.md", "Else.md");
    restore();
    assert.equal(
      await read("Else.md"),
      "[p](Plan.md#goals) [c](<Child.md>)\n\n```\n[p](Plan.md)\n```\n",
    );
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("an undo whose second rename fails changes nothing and can be tried again", async () => {
  const lib = await library();
  const { kb, store, moves, root } = lib;
  try {
    const before = await lib.snapshot();
    const plan = await store.movePlan(
      root.id,
      "Plan.md",
      path.join(kb, "Topics"),
      { children: true },
    );
    await moves.run({
      label: "move",
      moves: plan.moves,
      perform: () =>
        store.moveEntry(root.id, "Plan.md", path.join(kb, "Topics"), {
          children: true,
        }),
    });
    const after = await lib.snapshot();
    store.retryWait = 1;
    // The second entry moved back (Plan.md, after its child page) stays locked.
    const restore = failing(store, (n, from) =>
      from.endsWith(path.join("Topics", "Plan.md")) ? "EPERM" : null,
    );
    await assert.rejects(
      moves.undo({ relocate: (a, b) => store.relocate(a, b) }),
    );
    restore();
    assert.deepEqual(await lib.snapshot(), after);
    assert.notEqual(await moves.last(), null);
    // A note being saved: undo waits for it.
    store.locks.add(path.join(kb, "Other.md"));
    await assert.rejects(
      moves.undo({ relocate: (a, b) => store.relocate(a, b) }),
      /正在保存/,
    );
    store.locks.clear();
    await moves.undo({ relocate: (a, b) => store.relocate(a, b) });
    assert.deepEqual(await lib.snapshot(), before);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

// Review finding 3: undo after drafts were saved, with a dirty index, and
// after "rename only".
test("a draft patched in memory and saved before undo is put back too", async () => {
  const lib = await library();
  const { kb, store, moves, root, read } = lib;
  try {
    const other = path.join(kb, "Other.md");
    const original = await read("Other.md");
    const { source, target } = await store.renameTarget(
      root.id,
      "Plan.md",
      "Roadmap.md",
    );
    await moves.run({
      label: "rename",
      moves: [[source, target]],
      drafts: [other],
      perform: () => store.renameEntry(root.id, "Plan.md", "Roadmap.md"),
    });
    // The page patched its draft and the reader saved it.
    await fs.writeFile(
      other,
      original.replace("(Plan.md#goals)", "(Roadmap.md#goals)"),
    );
    const undone = await moves.undo({
      relocate: (a, b) => store.relocate(a, b),
    });
    assert.equal(await read("Other.md"), original);
    assert.ok(undone.restored.includes(other));
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("an index open with unsaved changes: a rename goes on and leaves its entry to the draft; a move stops", async () => {
  const lib = await library();
  const { kb, store, root, read } = lib;
  try {
    const before = await lib.snapshot();
    const drafts = [path.join(kb, "_目录.md")];
    await assert.rejects(
      store.moveEntry(root.id, "Plan.md", path.join(kb, "Topics"), { drafts }),
      /_目录\.md 有未保存的修改/,
    );
    await assert.rejects(store.checkIndexSaved(kb, drafts), /有未保存的修改/);
    assert.deepEqual(await lib.snapshot(), before);
    // The index tab being edited (the index view's own changes) does not
    // stop a rename: the page gets the index's change for its draft.
    const done = await store.renameEntry(root.id, "Plan.md", "Roadmap.md", {
      drafts,
      title: "Roadmap",
    });
    assert.equal(path.basename(done.path), "Roadmap.md");
    assert.equal(await read("_目录.md"), before["_目录.md"]);
    const draft = done.indexes.find((w) => w.draft);
    assert.equal(draft.path, path.join(kb, "_目录.md"));
    assert.deepEqual(draft.ops, [
      { kind: "rename", from: "Plan.md", to: "Roadmap.md", title: "Roadmap" },
    ]);
    assert.match(await read("Roadmap.md"), /^# Roadmap\n/);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("undo after 'rename only' says so, so drafts are not rewritten back", async () => {
  const lib = await library();
  const { store, moves, root } = lib;
  try {
    const { source, target } = await store.renameTarget(
      root.id,
      "Plan.md",
      "Roadmap.md",
    );
    await moves.run({
      label: "rename",
      moves: [[source, target]],
      links: false,
      perform: () => store.renameEntry(root.id, "Plan.md", "Roadmap.md"),
    });
    const undone = await moves.undo({
      relocate: (a, b) => store.relocate(a, b),
    });
    assert.equal(undone.links, false);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

// Review finding 4: links the link index does not record (reference
// definitions, HTML, images, attachments, folders) and notes it does not
// read (.txt, or not read yet) are still found.
test("every kind of link into a renamed or moved folder is found", async () => {
  const lib = await library();
  const { kb, store, moves, root, read } = lib;
  try {
    await fs.writeFile(
      path.join(kb, "Home.md"),
      [
        '[ref][r] <a href="Topics/T.md">t</a> ![img](Topics/a.png)',
        "[doc](Topics/spec.pdf) [folder](Topics/)",
        "",
        "[r]: Topics/T.md",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(kb, "Topics", "Old.txt"),
      "[up](../Plan.md)\n",
    );
    await fs.mkdir(path.join(kb, "Box"));
    await lib.index.rescan();
    const topics = path.join(kb, "Topics");
    const skip = { skip: [path.join(kb, "_目录.md")] };
    const renamed = await moves.plan(
      [[topics, path.join(kb, "Subjects")]],
      skip,
    );
    assert.deepEqual(
      renamed.map((a) => [a.name, a.links]),
      [["Home.md", 5]],
    );
    const box = await store.directory(path.join(kb, "Box"));
    const moved = await moves.plan(
      [[topics, path.join(kb, "Box", "Topics")]],
      skip,
    );
    assert.deepEqual(
      moved.map((a) => [a.name, a.links]),
      [
        ["Home.md", 5],
        ["Old.txt", 1],
        ["T.md", 1],
      ],
    );
    await moves.run({
      label: "move",
      moves: [[topics, path.join(kb, "Box", "Topics")]],
      perform: () => store.moveEntry(root.id, "Topics", path.join(kb, "Box")),
    });
    assert.equal(await read("Box/Topics/Old.txt"), "[up](../../Plan.md)\n");
    assert.match(await read("Home.md"), /\[r\]: Box\/Topics\/T\.md/);
    assert.match(await read("Home.md"), /<a href="Box\/Topics\/T\.md">/);
    assert.ok(box);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("a plan says when the library is still being read", async () => {
  const lib = await library();
  const { kb, moves } = lib;
  try {
    const plan = await moves.plan([
      [path.join(kb, "Plan.md"), path.join(kb, "P.md")],
    ]);
    assert.equal(plan.indexing, false);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

// Review finding 6: index integrity on moves and renames; AI runs and the
// file-name search follow.
test("a move takes only the child pages: not the index, not a folder listed under it", async () => {
  const lib = await library();
  const { kb, store, root, read } = lib;
  try {
    await fs.writeFile(
      path.join(kb, "_目录.md"),
      "- [Plan](Plan.md)\n  - [Child](Child.md)\n  - [Index](_目录.md)\n  - [Topics](Topics/)\n- [Other](Other.md)\n",
    );
    await fs.mkdir(path.join(kb, "Box"));
    const plan = await store.movePlan(
      root.id,
      "Plan.md",
      path.join(kb, "Box"),
      {
        children: true,
      },
    );
    assert.deepEqual(plan.children, ["Child.md"]);
    await store.moveEntry(root.id, "Plan.md", path.join(kb, "Box"), {
      children: true,
    });
    // The folder listed under it stays listed, a level up.
    assert.equal(
      await read("_目录.md"),
      "- [Index](_目录.md)\n- [Topics](Topics/)\n- [Other](Other.md)\n",
    );
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("a note renamed to SUMMARY.md beside _目录.md keeps its entry", async () => {
  const lib = await library();
  const { store, root, read } = lib;
  try {
    await store.renameEntry(root.id, "Other.md", "SUMMARY.md");
    assert.match(await read("_目录.md"), /- \[SUMMARY\]\(SUMMARY\.md\)/);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("a background AI run's marks follow a move, so they are released there", async () => {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "marklore-moves-run-")),
  );
  try {
    const store = createAiStore(path.join(dir, "ai"));
    const plan = path.join(dir, "kb", "Plan.md");
    const moved = path.join(dir, "kb", "Archive", "Plan.md");
    const run = await store.createRun({ marks: [{ id: "m1", file: plan }] });
    await store.moveNotes([[plan, moved]]);
    assert.deepEqual((await store.getRun(run.id)).marks, [
      { id: "m1", file: moved },
    ]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("the file-name search of folders outside the library walks again after a move", async () => {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "marklore-moves-names-")),
  );
  try {
    await fs.writeFile(path.join(dir, "Alpha.md"), "");
    const store = new FileStore({});
    const folder = await store.directory(dir);
    assert.equal((await store.search([folder.id], "alpha")).items.length, 1);
    await fs.rename(path.join(dir, "Alpha.md"), path.join(dir, "Beta.md"));
    store.names.reset();
    assert.equal((await store.search([folder.id], "beta")).items.length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// Review finding 7: where an entry may move to, and links to outside the
// library.
test("moves go only into the library's folders, not hidden or software ones", async () => {
  const lib = await library();
  const { dir, kb, store, root } = lib;
  try {
    store.roots = [kb];
    await fs.mkdir(path.join(kb, ".git"));
    await fs.mkdir(path.join(kb, "node_modules"));
    const outside = path.join(dir, "outside");
    await fs.mkdir(outside);
    await store.directory(outside);
    for (const dest of [
      path.join(kb, ".git"),
      path.join(kb, "node_modules"),
      outside,
    ])
      await assert.rejects(store.movePlan(root.id, "Other.md", dest), /未授权/);
    // Removed from the library: no longer a place to move to.
    store.roots = [path.join(kb, "Elsewhere")];
    await assert.rejects(
      store.movePlan(root.id, "Other.md", path.join(kb, "Topics")),
      /未授权/,
    );
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("a note reached through a link to outside is never rewritten", async () => {
  const lib = await library();
  const { dir, kb, store } = lib;
  try {
    const outside = path.join(dir, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "Ext.md"), "[p](Plan.md)\n");
    await fs.symlink(outside, path.join(kb, "J"), "junction");
    await assert.rejects(
      store.rewrite(path.join(kb, "J", "Ext.md"), () => "changed\n"),
      /路径已改变/,
    );
    assert.equal(
      await fs.readFile(path.join(outside, "Ext.md"), "utf8"),
      "[p](Plan.md)\n",
    );
  } finally {
    await fs.rm(path.join(lib.kb, "J"), { force: true }).catch(() => {});
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("the link index does not read a note through a symbolic link", async (t) => {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "marklore-moves-link-")),
  );
  try {
    const kb = path.join(dir, "kb");
    await fs.mkdir(kb);
    await fs.mkdir(path.join(dir, "outside"));
    await fs.writeFile(path.join(dir, "outside", "Ext.md"), "# Ext\n");
    await fs.writeFile(path.join(kb, "Own.md"), "# Own\n");
    try {
      await fs.symlink(
        path.join(dir, "outside", "Ext.md"),
        path.join(kb, "Ext.md"),
        "file",
      );
    } catch {
      t.skip("symbolic links to files need a privilege here");
      return;
    }
    const index = createLinkIndex();
    await index.follow([kb]);
    assert.equal(index.has(path.join(kb, "Own.md")), true);
    assert.equal(index.has(path.join(kb, "Ext.md")), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a note made by the index's own view is not listed again by main", async () => {
  const lib = await library();
  const { store, root, read } = lib;
  try {
    const before = await read("_目录.md");
    await store.createEntry(root.id, "Example.md", "note", "", { list: false });
    await store.createEntry(root.id, "Box", "folder", "", { list: false });
    assert.equal(await read("_目录.md"), before);
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});
