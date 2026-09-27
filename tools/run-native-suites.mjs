// Run every tests/native*.mjs suite in sequence (each launches Electron with an
// isolated profile). Set FOLIO_TEST_EXE to test a packaged build instead of source.
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const suites = (await fs.readdir("tests"))
  .filter((name) => /^native.*\.mjs$/.test(name))
  .sort();
const failed = [];
for (const suite of suites) {
  console.log(`\n▶ ${suite}`);
  const result = spawnSync(process.execPath, [`tests/${suite}`], {
    stdio: "inherit",
  });
  if (result.status !== 0) failed.push(suite);
}
console.log(
  `\n${suites.length - failed.length}/${suites.length} native suites passed` +
    (failed.length ? `; failed: ${failed.join(", ")}` : ""),
);
process.exitCode = failed.length ? 1 : 0;
