import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeExcluded, excludedBy } from "../desktop/excluded.mjs";
import { normalizeSettings } from "../src/settings.js";
import { createLinkIndex } from "../desktop/link-index.mjs";

test("excluded folders: absolute paths, once each, at most 200", () => {
  assert.deepEqual(
    normalizeExcluded([
      "Z:\\DeepONet\\runs",
      "z:/deeponet/RUNS/",
      "relative\\path",
      42,
      "\\\\server\\share\\out",
    ]),
    ["Z:\\DeepONet\\runs", "\\\\server\\share\\out"],
  );
  assert.deepEqual(normalizeExcluded("Z:\\x"), []);
  const many = Array.from({ length: 300 }, (_, i) => `C:\\f${i}`);
  assert.equal(normalizeExcluded(many).length, 200);
  assert.deepEqual(normalizeSettings({}).searchExclude, []);
  assert.deepEqual(
    normalizeSettings({ searchExclude: ["Z:\\a", "nope"] }).searchExclude,
    ["Z:\\a"],
  );
});

test("a folder and everything inside it is excluded, nothing beside it", () => {
  const isExcluded = excludedBy(["Z:\\DeepONet\\runs"]);
  assert.equal(isExcluded("Z:\\DeepONet\\runs"), true);
  assert.equal(isExcluded("z:\\deeponet\\runs\\seed0\\notes.md"), true);
  assert.equal(isExcluded("Z:\\DeepONet\\runs-old\\a.md"), false);
  assert.equal(isExcluded("Z:\\DeepONet\\README.md"), false);
});

test("the index leaves excluded folders out, at once and on later changes", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "folio-exclude-")),
  );
  const put = async (rel) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), "needle\n");
  };
  await put("notes/a.md");
  await put("runs/seed0/log.md");
  await put("runs/seed1/log.md");
  let progress = 0;
  const index = createLinkIndex({ onProgress: () => progress++ });
  await index.follow([root]);
  assert.equal((await index.search("needle")).total, 3);

  // Excluding a folder drops its notes before the rescan finishes.
  const runs = path.join(root, "runs");
  const rescan = index.follow([root], [runs]);
  assert.equal((await index.search("needle")).total, 1);
  assert.ok(progress >= 1);
  await rescan;
  assert.deepEqual(
    (await index.search("needle")).results.map((r) =>
      path.relative(root, r.path),
    ),
    [path.join("notes", "a.md")],
  );
  // A note written there later stays out; restoring brings them back.
  await put("runs/seed2/log.md");
  assert.equal(await index.changed(path.join(runs, "seed2", "log.md")), false);
  await index.follow([root], []);
  assert.equal((await index.search("needle")).total, 4);
});
