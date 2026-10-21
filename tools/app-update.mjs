// Packs a release's app files: the update a copy on the same Electron
// downloads instead of the whole package (desktop/updater.mjs).
//   node tools/app-update.mjs <win-unpacked> <out folder> [version]
// Writes Marklore-vX-app-electron-Y.zip, holding one Marklore-vX-win-x64
// folder with the files in appFiles. Y is read from the package's own
// Electron "version" file, so it always matches the build.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assetNames, appFiles } from "../desktop/updater.mjs";

process.noAsar = true;
const [unpacked, out, given] = process.argv.slice(2);
if (!unpacked || !out) {
  console.error(
    "usage: node tools/app-update.mjs <win-unpacked> <out folder> [version]",
  );
  process.exit(1);
}
const version =
  given ||
  JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url)))
    .version;
const electron = (
  await fs.readFile(path.join(unpacked, "version"), "utf8")
).trim();
const names = assetNames(version, electron);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "marklore-app-"));
try {
  for (const file of appFiles) {
    const to = path.join(temp, names.folder, file);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(path.join(unpacked, file), to);
  }
  await fs.mkdir(out, { recursive: true });
  const zip = path.resolve(out, names.app);
  await fs.rm(zip, { force: true });
  execFileSync(
    path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"),
    ["-a", "-c", "-f", zip, names.folder],
    { cwd: temp, windowsHide: true },
  );
  const { size } = await fs.stat(zip);
  console.log(`${zip} (${(size / 2 ** 20).toFixed(1)} MB)`);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
