import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appFiles, assetNames, nativeAppFiles } from "../desktop/updater.mjs";

const tool = fileURLToPath(new URL("../tools/app-update.mjs", import.meta.url));
const tar = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "tar.exe",
);

// A stand-in for win-unpacked: the app files, with or without the binary.
async function pack(withNative) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "marklore-pack-"));
  const unpacked = path.join(temp, "win-unpacked");
  for (const file of [...appFiles, ...(withNative ? nativeAppFiles : [])]) {
    await fs.mkdir(path.dirname(path.join(unpacked, file)), {
      recursive: true,
    });
    await fs.writeFile(path.join(unpacked, file), file);
  }
  await fs.writeFile(path.join(unpacked, "version"), "44.4.5");
  execFileSync(process.execPath, [tool, unpacked, temp, "0.3.1"], {
    windowsHide: true,
    stdio: "ignore",
  });
  const names = assetNames("0.3.1", "44.4.5");
  const listed = execFileSync(tar, ["-tf", path.join(temp, names.app)], {
    encoding: "utf8",
    windowsHide: true,
  })
    .split(/\r?\n/)
    .filter((line) => line && !line.endsWith("/"))
    .map((line) => line.slice(names.folder.length + 1))
    .sort();
  await fs.rm(temp, { recursive: true, force: true });
  return listed;
}

test(
  "the app files carry the native index when the package has it",
  { skip: process.platform !== "win32" && "packs with Windows tar" },
  async () => {
    assert.deepEqual(await pack(true), [...appFiles, ...nativeAppFiles].sort());
    assert.deepEqual(await pack(false), [...appFiles].sort());
  },
);
