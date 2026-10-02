import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const root = process.cwd(),
  seen = new Set(),
  sections = [];
async function visit(name, from) {
  const require = createRequire(path.join(from, "package.json"));
  let folder, pkg;
  for (const candidate of require.resolve.paths(name) || []) {
    try {
      const real = await fs.realpath(path.join(candidate, name)),
        parsed = JSON.parse(
          await fs.readFile(path.join(real, "package.json"), "utf8"),
        );
      if (parsed.name === name) {
        folder = real;
        pkg = parsed;
        break;
      }
    } catch {}
  }
  if (!pkg) throw Error("Cannot locate " + name);
  const key = pkg.name + "@" + pkg.version;
  if (seen.has(key)) return;
  seen.add(key);
  const names = (await fs.readdir(folder))
    .filter((f) => /^(license|licence|copying|notice)([-.]|$)/i.test(f))
    .sort();
  if (!names.length) throw Error("License text missing for " + key);
  const texts = await Promise.all(
    names.map((f) => fs.readFile(path.join(folder, f), "utf8")),
  );
  sections.push(
    `${key}\nDeclared license: ${pkg.license}\n${texts.join("\n\n")}`,
  );
  for (const dep of Object.keys(pkg.dependencies || {}))
    await visit(dep, folder);
}
const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
for (const name of Object.keys(pkg.dependencies)) await visit(name, root);
// Sort by package@version so regeneration is byte-stable (CI diffs this file).
sections.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
await fs.writeFile(
  "THIRD-PARTY-NOTICES.txt",
  "Marklore — bundled application dependencies\nElectron/Chromium runtime licenses are also supplied beside the executable.\n\n" +
    sections.join("\n\n" + "=".repeat(78) + "\n\n"),
);
console.log(`Collected license texts for ${sections.length} runtime packages.`);
