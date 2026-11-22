// Run every tests/native*.mjs suite in sequence (each launches Electron with an
// isolated profile). Set FOLIO_TEST_EXE to test a packaged build instead of source.
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { checkExplorerGdi } from "./explorer-gdi.mjs";

const suites = (await fs.readdir("tests"))
  .filter((name) => /^native.*\.mjs$/.test(name))
  .sort();
const failed = [];
let stopped = null;
for (const [index, suite] of suites.entries()) {
  // Stop before a suite, not in the middle of one, when Explorer is near its limit.
  try {
    const gdi = checkExplorerGdi(suite);
    console.log(`\n▶ ${suite}${gdi === null ? "" : ` (Explorer GDI ${gdi})`}`);
  } catch (error) {
    console.error(`\n${error.message}`);
    stopped = suites.slice(index);
    break;
  }
  // Suites assert Chinese interface text whatever the machine's language.
  const result = spawnSync(process.execPath, [`tests/${suite}`], {
    stdio: "inherit",
    env: {
      ...process.env,
      FOLIO_LANG: process.env.FOLIO_LANG || "zh",
      // Windows open in the background instead of taking the foreground.
      FOLIO_TEST_INACTIVE: "1",
    },
  });
  if (result.status !== 0) failed.push(suite);
}
const ran = suites.length - (stopped?.length ?? 0);
console.log(
  `\n${ran - failed.length}/${ran} native suites passed` +
    (failed.length ? `; failed: ${failed.join(", ")}` : "") +
    (stopped ? `; not run: ${stopped.join(", ")}` : ""),
);
process.exitCode = failed.length || stopped ? 1 : 0;
