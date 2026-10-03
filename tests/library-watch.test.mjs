import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { treeChange, createLibraryWatch } from "../desktop/library-watch.mjs";

test("only notes, folders and unnamed changes touch the tree", () => {
  for (const name of ["new.md", "sub\\note.markdown", "Topic", "a/b", null])
    assert.equal(treeChange(name), true, String(name));
  for (const name of [
    ".git\\index.lock",
    "sub\\.obsidian\\workspace.json",
    "node_modules\\x\\a.md",
    "assets\\image-1.png",
    "notes.pdf",
    ".folio-1234.tmp",
  ])
    assert.equal(treeChange(name), false, name);
});

test("follows exactly the library folders and debounces renames", async () => {
  const opened = new Map(),
    notified = [];
  const watch = (folder, options, listener) => {
    assert.equal(options.recursive, true);
    const watcher = Object.assign(new EventEmitter(), {
      listener,
      closed: false,
      close() {
        this.closed = true;
      },
    });
    opened.set(folder, watcher);
    return watcher;
  };
  const library = createLibraryWatch({
    notify: () => notified.push(Date.now()),
    delay: 20,
    watch,
  });
  const a = path.resolve("A"),
    b = path.resolve("B");
  library.follow(["A", "B"]);
  assert.deepEqual([...opened.keys()], [a, b]);
  library.follow(["B"]);
  assert.equal(opened.get(a).closed, true);
  assert.equal(opened.get(b).closed, false);

  const fire = opened.get(b).listener;
  fire("change", "note.md");
  fire("rename", ".git\\HEAD.lock");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(notified.length, 0, "edits and hidden folders are ignored");
  fire("rename", "new.md");
  fire("rename", "Topic");
  fire("rename", "Topic\\inner.md");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(notified.length, 1, "a burst of changes refreshes once");
  library.close();
  assert.equal(opened.get(b).closed, true);
});

test("a note written into a library folder is noticed", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "marklore-library-"));
  let resolveSeen;
  const seen = new Promise((resolve) => (resolveSeen = resolve));
  const library = createLibraryWatch({ notify: resolveSeen, delay: 50 });
  try {
    library.follow([folder]);
    await fs.mkdir(path.join(folder, "Topic"));
    await fs.writeFile(path.join(folder, "Topic", "Agent note.md"), "# New\n");
    await Promise.race([
      seen,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("no notification")), 3000),
      ),
    ]);
  } finally {
    library.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});
