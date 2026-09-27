// Keep release/ small once versions are archived on GitHub Releases.
// Dry run by default; --apply moves pruned items to the Windows Recycle Bin.
//   node tools/prune-releases.mjs [--keep 3] [--keep-dirs 1] [--apply]
// Only versioned items (vX.Y.Z directories, *-vX.Y.Z-*.zip, SHA256SUMS-vX.Y.Z.txt)
// are considered. Unversioned output such as release/win-unpacked from
// `pnpm dist` may be the newest build and is never touched.
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value < 1)
    throw Error(`${name} needs a positive integer`);
  return value;
}
const keep = option("--keep", 3),
  keepDirs = option("--keep-dirs", 1),
  apply = args.includes("--apply");
const root = path.resolve("release");

async function size(target) {
  const stat = await fs.lstat(target);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of await fs.readdir(target))
    total += await size(path.join(target, entry));
  return total;
}
const parse = (name) => name.match(/(?:^|[-_])v(\d+)\.(\d+)\.(\d+)(?=$|[-_.])/);
const compare = (a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2];

const items = [],
  untouched = [];
for (const entry of await fs.readdir(root, { withFileTypes: true })) {
  const match = parse(entry.name);
  if (!match) {
    untouched.push(entry.name);
    continue;
  }
  const parts = match.slice(1).map(Number);
  items.push({ name: entry.name, dir: entry.isDirectory(), version: parts.join("."), parts });
}
const newest = (dir) =>
  new Set(
    [...new Map(items.filter((i) => i.dir === dir).sort(compare).map((i) => [i.version, i])).keys()]
      .slice(0, dir ? keepDirs : keep),
  );
const keptDirs = newest(true),
  keptFiles = newest(false);
const prune = items.filter((i) => !(i.dir ? keptDirs : keptFiles).has(i.version));

let bytes = 0;
for (const item of prune) {
  item.bytes = await size(path.join(root, item.name));
  bytes += item.bytes;
  console.log(`${item.dir ? "dir " : "file"}  ${item.name}  ${(item.bytes / 2 ** 20).toFixed(0)} MB`);
}
console.log(`\nKeep directories: ${[...keptDirs].join(", ") || "none"}; files: ${[...keptFiles].join(", ") || "none"}`);
if (untouched.length) console.log(`Unversioned, left untouched: ${untouched.join(", ")}`);
console.log(`${prune.length} item(s), ${(bytes / 2 ** 30).toFixed(2)} GB ${apply ? "to the Recycle Bin" : "would be pruned (dry run; add --apply)"}`);

if (apply && prune.length) {
  if (process.platform !== "win32") throw Error("--apply uses the Windows Recycle Bin");
  // Recycle rather than delete: paths travel through an environment variable, not the command line.
  const script = `Add-Type -AssemblyName Microsoft.VisualBasic
foreach ($p in ($env:FOLIO_PRUNE | ConvertFrom-Json)) {
  if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }
  else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }
}`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, FOLIO_PRUNE: JSON.stringify(prune.map((i) => path.join(root, i.name))) },
    stdio: "inherit",
  });
  if (result.status !== 0) throw Error("Recycling failed; nothing further was changed");
  console.log("Done. Empty the Recycle Bin to reclaim the space.");
}
