import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileStore } from "../desktop/files.mjs";
import { createLinkIndex } from "../desktop/link-index.mjs";
import { createNoteMoves } from "../desktop/note-moves.mjs";
import { createNoteRepair } from "../desktop/note-repair.mjs";
import { createRenameMemory } from "../desktop/rename-memory.mjs";

// A library where another program renamed Plan.md to Roadmap.md: a note
// and the folder's index still point at Plan.md.
async function library() {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "marklore-repair-")),
  );
  const kb = path.join(dir, "kb");
  await fs.mkdir(kb);
  const write = (name, text) => fs.writeFile(path.join(kb, name), text);
  await write(
    "_目录.md",
    "- [Plan](Plan.md)\n  - [Sub](Sub.md)\n- [Other](Other.md)\n",
  );
  await write("Other.md", "See [the plan](Plan.md#goals) and [x](Other.md).\n");
  await write("Sub.md", "");
  await write("Roadmap.md", "# Plan\n");
  const store = new FileStore({ backups: path.join(dir, "backups") });
  store.roots = [kb];
  const linkIndex = createLinkIndex();
  await linkIndex.follow([kb]);
  const renames = createRenameMemory();
  const moves = createNoteMoves({
    files: store,
    linkIndex,
    undoFile: path.join(dir, "last.json"),
  });
  const repair = createNoteRepair({
    files: store,
    renames,
    linkIndex,
    noteMoves: moves,
    roots: () => [kb],
  });
  const read = (name) =>
    fs.readFile(path.join(kb, name), "utf8").catch(() => null);
  const undo = () => moves.undo({ relocate: (a, b) => store.relocate(a, b) });
  return { dir, kb, store, linkIndex, renames, moves, repair, read, undo };
}

test("a broken link is offered where its note went, and relocated with undo", async () => {
  const lib = await library();
  const { kb, renames, repair, read, undo } = lib;
  try {
    // The watcher saw the rename (Plan.md gone, Roadmap.md come).
    renames.record([[path.join(kb, "Plan.md"), path.join(kb, "Roadmap.md")]]);
    const other = path.join(kb, "Other.md");
    const options = await repair.options(other, "Plan.md#goals");
    assert.equal(options.missing, true);
    assert.equal(options.creatable, true);
    assert.deepEqual(
      options.candidates.map((c) => [c.name, c.rel, c.reason]),
      [["Roadmap.md", "Roadmap.md", "renamed"]],
    );
    // A link that is not broken has nothing to offer.
    assert.equal((await repair.options(other, "Other.md")).missing, false);
    await repair.apply(other, "Plan.md#goals", {
      kind: "relocate",
      to: path.join(kb, "Roadmap.md"),
    });
    assert.equal(
      await read("Other.md"),
      "See [the plan](Roadmap.md#goals) and [x](Other.md).\n",
    );
    assert.equal((await lib.moves.last()).label.kind, "repair");
    await undo();
    assert.equal(
      await read("Other.md"),
      "See [the plan](Plan.md#goals) and [x](Other.md).\n",
    );
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("a missing index entry: candidates by name and from the folder, then relocate", async () => {
  const lib = await library();
  const { kb, store, repair, read, undo } = lib;
  try {
    await fs.mkdir(path.join(kb, "Archive"));
    await fs.writeFile(path.join(kb, "Archive", "Plan.md"), "# Old plan\n");
    // The watcher tells the link index about the new note.
    await lib.linkIndex.changed(path.join(kb, "Archive", "Plan.md"));
    const root = await store.directory(kb);
    // The tree counts it on the index's row.
    const listed = await store.list(root.id);
    assert.equal(listed[0].missing, 1);
    const issues = await store.indexIssues(root.id);
    assert.deepEqual(
      issues.missing.map((m) => [m.line, m.title, m.name]),
      [[0, "Plan", "Plan.md"]],
    );
    const index = issues.index;
    const options = await repair.options(index, issues.missing[0].href);
    assert.deepEqual(
      options.candidates.map((c) => [c.rel, c.reason]),
      [
        ["Archive/Plan.md", "same-name"],
        ["Roadmap.md", "unlisted"],
      ],
    );
    // In the same folder: the entry takes the new name and its title.
    await repair.apply(index, "Plan.md", {
      kind: "relocate",
      to: path.join(kb, "Roadmap.md"),
    });
    assert.equal(
      await read("_目录.md"),
      "- [Roadmap](Roadmap.md)\n  - [Sub](Sub.md)\n- [Other](Other.md)\n",
    );
    await undo();
    // Removed from the index: its sub-page moves up a level.
    await repair.apply(index, "Plan.md", { kind: "remove" });
    assert.equal(
      await read("_目录.md"),
      "- [Sub](Sub.md)\n- [Other](Other.md)\n",
    );
    await undo();
    assert.equal(
      await read("_目录.md"),
      "- [Plan](Plan.md)\n  - [Sub](Sub.md)\n- [Other](Other.md)\n",
    );
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("remove keeps a link's text; create makes the note, undone while untouched", async () => {
  const lib = await library();
  const { kb, repair, read, undo } = lib;
  try {
    const other = path.join(kb, "Other.md");
    await repair.apply(other, "Plan.md#goals", { kind: "remove" });
    assert.equal(await read("Other.md"), "See the plan and [x](Other.md).\n");
    await undo();
    await repair.apply(other, "Plan.md#goals", { kind: "create" });
    assert.equal(await read("Plan.md"), "# Plan\n");
    await undo();
    assert.equal(await read("Plan.md"), null);
    // Written to since: undo leaves it and says so.
    await repair.apply(other, "Plan.md#goals", { kind: "create" });
    await fs.writeFile(path.join(kb, "Plan.md"), "# Plan\n\nMine now.\n");
    const undone = await undo();
    assert.deepEqual(undone.skipped, [path.join(kb, "Plan.md")]);
    assert.equal(await read("Plan.md"), "# Plan\n\nMine now.\n");
    await assert.rejects(
      repair.apply(other, "Plan.md", { kind: "create" }),
      /已有同名/,
    );
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("a draft is left to the page; notes outside the library are not repaired", async () => {
  const lib = await library();
  const { dir, kb, repair, read } = lib;
  try {
    const other = path.join(kb, "Other.md");
    const done = await repair.apply(
      other,
      "Plan.md#goals",
      { kind: "relocate", to: path.join(kb, "Roadmap.md") },
      { drafts: [other] },
    );
    assert.deepEqual(done.draft, {
      path: other,
      kind: "relocate",
      moves: [[path.join(kb, "Plan.md"), path.join(kb, "Roadmap.md")]],
    });
    assert.match(await read("Other.md"), /\(Plan\.md#goals\)/);
    const outside = path.join(dir, "Outside.md");
    await fs.writeFile(outside, "[p](Plan.md)\n");
    await assert.rejects(repair.options(outside, "Plan.md"), /未授权/);
    await assert.rejects(
      repair.apply(other, "Plan.md", {
        kind: "relocate",
        to: path.join(dir, "Outside.md"),
      }),
      /不在笔记库/,
    );
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});

test("the tree's count of missing entries is what the index view shows missing", async () => {
  const lib = await library();
  const { kb, store } = lib;
  try {
    await fs.mkdir(path.join(kb, "deep"));
    await fs.writeFile(
      path.join(kb, "_目录.md"),
      [
        "- [Here](Other.md)",
        "- [Gone](Gone.md)",
        "- [Gone folder](GoneDir/)",
        "- [Old file](old.pdf)",
        "- [Deep](deep/Gone.md)",
        "- [Deep image](deep/x.png)",
        "",
      ].join("\n"),
    );
    const root = await store.directory(kb);
    // Notes and folders named in the folder, and notes deeper: as the view
    // (which never shows an attachment missing).
    assert.equal((await store.list(root.id))[0].missing, 3);
    assert.deepEqual(
      (await store.indexIssues(root.id)).missing.map((m) => m.href),
      ["Gone.md", "GoneDir/", "deep/Gone.md"],
    );
  } finally {
    await fs.rm(lib.dir, { recursive: true, force: true });
  }
});
