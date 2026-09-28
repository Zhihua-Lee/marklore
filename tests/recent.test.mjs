import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRecentFiles } from "../desktop/recent.mjs";

async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "folio-recent-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const notes = [];
  for (let i = 0; i < 14; i++) {
    const file = path.join(root, `note-${i}.md`);
    await fs.writeFile(file, `# ${i}`);
    notes.push(file);
  }
  return { root, notes, store: path.join(root, "profile", "recent.json") };
}

test("recent files are newest first, deduplicated case-insensitively and capped", async (t) => {
  const { notes, store } = await fixture(t);
  const lists = [];
  const recent = createRecentFiles({
    file: store,
    limit: 12,
    jumpList: (paths) => lists.push(paths),
  });
  for (const note of notes) await recent.add(note);
  await recent.add(notes[3].toUpperCase());
  const listed = (await recent.list()).map((item) => item.path);
  assert.equal(listed.length, 12);
  assert.equal(listed[0], notes[3].toUpperCase());
  assert.equal(
    listed.filter((p) => p.toLowerCase() === notes[3].toLowerCase()).length,
    1,
  );
  assert.deepEqual(listed.slice(1, 3), [notes[13], notes[12]]);
  // The jump list mirrors only the first eight.
  assert.equal(lists.at(-1).length, 8);
  assert.equal(lists.at(-1)[0], notes[3].toUpperCase());
  const item = (await recent.list())[1];
  assert.equal(item.name, "note-13.md");
  assert.equal(item.folder, path.dirname(notes[13]));
});

test("vanished files drop out, the list persists and clearing empties it", async (t) => {
  const { notes, store } = await fixture(t);
  const recent = createRecentFiles({ file: store });
  await recent.add(notes[0]);
  await recent.add(notes[1]);
  await fs.rm(notes[0]);
  assert.deepEqual(
    (await recent.list()).map((item) => item.path),
    [notes[1]],
  );
  assert.equal(await recent.has(notes[0]), false);
  assert.equal(await recent.has(notes[1].toUpperCase()), true);
  // A fresh instance (next launch) reads what was written.
  const reopened = createRecentFiles({ file: store });
  assert.deepEqual(
    (await reopened.list()).map((item) => item.path),
    [notes[1]],
  );
  await reopened.clear();
  assert.deepEqual(await createRecentFiles({ file: store }).list(), []);
});

test("a damaged or foreign recent file is ignored", async (t) => {
  const { store } = await fixture(t);
  await fs.mkdir(path.dirname(store), { recursive: true });
  await fs.writeFile(store, '["relative.md", 42, {"x":1}]');
  assert.deepEqual(await createRecentFiles({ file: store }).list(), []);
  await fs.writeFile(store, "not json");
  assert.deepEqual(await createRecentFiles({ file: store }).list(), []);
});
