import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { profileFolder } from "../desktop/profile-folder.mjs";

async function appData(names) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "marklore-appdata-"));
  for (const name of names) {
    await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, name, "session.json"), name);
  }
  return root;
}

test("the Folio Notes profile moves to Marklore on first start", async () => {
  const root = await appData(["folio-notes"]);
  try {
    const folder = profileFolder(root);
    assert.equal(folder, path.join(root, "Marklore"));
    assert.equal(
      await fs.readFile(path.join(folder, "session.json"), "utf8"),
      "folio-notes",
    );
    await assert.rejects(fs.access(path.join(root, "folio-notes")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("an existing Marklore profile wins and the old one is left alone", async () => {
  const root = await appData(["folio-notes", "Marklore"]);
  try {
    assert.equal(profileFolder(root), path.join(root, "Marklore"));
    await fs.access(path.join(root, "folio-notes"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a fresh install uses Marklore; a failed move keeps the old folder", async () => {
  const root = await appData([]);
  try {
    assert.equal(profileFolder(root), path.join(root, "Marklore"));
    const locked = profileFolder(root, {
      exists: (p) => p.endsWith("folio-notes"),
      rename: () => {
        throw Object.assign(Error("busy"), { code: "EPERM" });
      },
    });
    assert.equal(locked, path.join(root, "folio-notes"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
