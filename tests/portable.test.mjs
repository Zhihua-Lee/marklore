import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  portableDir,
  isPortable,
  enablePortable,
  disablePortable,
  retireDisabled,
  isInstalled,
  UNINSTALLER,
} from "../desktop/portable.mjs";

async function fixture() {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "folio-portable-")),
  );
  const program = path.join(root, "Marklore");
  const profile = path.join(root, "profile");
  await fs.mkdir(program);
  await fs.mkdir(path.join(profile, "backups"), { recursive: true });
  await fs.mkdir(path.join(profile, "Cache"));
  await fs.writeFile(path.join(profile, "session.json"), '{"tabs":[1]}');
  await fs.writeFile(path.join(profile, "recent.json"), "[]");
  await fs.writeFile(path.join(profile, "desktop-settings.json"), "{}");
  await fs.writeFile(path.join(profile, "backups", "note.md"), "old");
  await fs.writeFile(path.join(profile, "Cache", "blob"), "chromium");
  return { root, executable: path.join(program, "Marklore.exe"), profile };
}
const exists = (p) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

test("enabling copies only Folio's own data beside the program", async () => {
  const { root, executable, profile } = await fixture();
  assert.equal(isPortable(executable), false);
  const target = await enablePortable({ executable, current: profile });
  assert.equal(target, portableDir(executable));
  assert.equal(isPortable(executable), true);
  assert.equal(
    await fs.readFile(path.join(target, "session.json"), "utf8"),
    '{"tabs":[1]}',
  );
  assert.equal(
    await fs.readFile(path.join(target, "backups", "note.md"), "utf8"),
    "old",
  );
  // Chromium caches stay in the profile; no staging folder is left behind.
  assert.equal(await exists(path.join(target, "Cache")), false);
  const siblings = await fs.readdir(path.dirname(executable));
  assert.deepEqual(siblings, ["data"]);
  // The profile copy is left as it was.
  assert.equal(await exists(path.join(profile, "session.json")), true);
  await assert.rejects(
    enablePortable({ executable, current: profile }),
    /已有 data 文件夹/,
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("disabling copies the data back and the next start keeps the folder renamed", async () => {
  const { root, executable, profile } = await fixture();
  const target = await enablePortable({ executable, current: profile });
  await fs.writeFile(path.join(target, "session.json"), '{"tabs":[2]}');
  await disablePortable({ executable, fallback: profile });
  // Marked at once (the running app still holds its lock in the folder).
  assert.equal(isPortable(executable), false);
  assert.equal(
    await fs.readFile(path.join(profile, "session.json"), "utf8"),
    '{"tabs":[2]}',
  );
  const now = new Date("2026-09-29T12:00:00Z");
  const kept = retireDisabled(executable, now);
  assert.equal(path.basename(kept), "data-disabled-2026-09-29");
  assert.equal(await exists(target), false);
  assert.equal(
    await fs.readFile(path.join(kept, "session.json"), "utf8"),
    '{"tabs":[2]}',
  );
  assert.equal(retireDisabled(executable, now), null);
  // A second round the same day does not overwrite the first kept folder.
  await enablePortable({ executable, current: profile });
  await disablePortable({ executable, fallback: profile });
  assert.equal(
    path.basename(retireDisabled(executable, now)),
    "data-disabled-2026-09-29-2",
  );
  assert.equal(await exists(kept), true);
  await fs.rm(root, { recursive: true, force: true });
});

test("an installed copy is never portable", async () => {
  const { executable, profile } = await fixture();
  await fs.mkdir(portableDir(executable));
  assert.equal(isPortable(executable), true);
  await fs.writeFile(
    path.join(path.dirname(executable), UNINSTALLER),
    "uninstaller",
  );
  assert.equal(isInstalled(executable), true);
  assert.equal(isPortable(executable), false);
  await fs.rm(portableDir(executable), { recursive: true });
  await assert.rejects(enablePortable({ executable, current: profile }));
  assert.equal(await exists(portableDir(executable)), false);
});
