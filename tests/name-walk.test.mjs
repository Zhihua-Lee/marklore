import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createNameWalks } from "../desktop/name-walk.mjs";
import { excludedBy } from "../desktop/excluded.mjs";

async function home() {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "folio-names-")),
  );
  for (const rel of [
    "AGENTS.md",
    "deep/a/b/AGENT notes.md",
    "runs/seed0/AGENT log.md",
    "envs/py/conda-meta/history",
    "envs/py/AGENT.md",
  ]) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), "x");
  }
  return root;
}
const names = (found, root) =>
  found.items.map((item) => path.relative(root, item.path)).sort();

test("a slow folder answers with what it has, then the rest; walked once", async () => {
  const root = await home();
  let release,
    reads = 0,
    progress = 0;
  const gate = new Promise((resolve) => (release = resolve));
  const walks = createNameWalks({
    budget: 50,
    onProgress: () => progress++,
    readdir: async (folder, options) => {
      reads++;
      if (folder !== root) await gate; // below the top: as over a network
      return fs.readdir(folder, options);
    },
  });
  const early = await walks.search([root], "agent");
  assert.equal(early.scanning, true);
  assert.deepEqual(names(early, root), ["AGENTS.md"]);
  release();
  for (
    let i = 0;
    i < 100 && (await walks.search([root], "agent")).scanning;
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  const full = await walks.search([root], "agent");
  assert.equal(full.scanning, false);
  assert.deepEqual(names(full, root), [
    "AGENTS.md",
    path.join("deep", "a", "b", "AGENT notes.md"),
    path.join("runs", "seed0", "AGENT log.md"),
  ]);
  assert.ok(progress >= 1);
  // Later searches reuse the walk: no folder is read again.
  const before = reads;
  assert.deepEqual(names(await walks.search([root], "notes agent"), root), [
    path.join("deep", "a", "b", "AGENT notes.md"),
  ]);
  assert.equal(reads, before);
});

test("excluded folders are left out; changing them walks again", async () => {
  const root = await home();
  let reads = 0;
  const walks = createNameWalks({
    readdir: (folder, options) => {
      reads++;
      return fs.readdir(folder, options);
    },
  });
  const runs = path.join(root, "runs");
  const options = { excluded: excludedBy([runs]), excludedKey: runs };
  const found = await walks.search([root], "agent", options);
  assert.equal(found.scanning, false);
  assert.ok(!names(found, root).some((name) => name.startsWith("runs")));
  const first = reads;
  // Restored: walked again, and the folder's notes come back.
  const restored = await walks.search([root], "agent", { excludedKey: "" });
  assert.ok(reads > first);
  assert.ok(
    names(restored, root).includes(path.join("runs", "seed0", "AGENT log.md")),
  );
});
