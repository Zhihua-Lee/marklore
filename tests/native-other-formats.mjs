import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Other formats (.diff, .patch) open only when turned on in Settings; then a
// diff opened from the command line reads as one section per file, read-only.
// The preference lives in the isolated profile; no registry entry is written
// (this copy is not registered).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "folio-other-formats-"));
const profile = path.join(temp, "profile"),
  diff = path.join(temp, "fix.diff"),
  text = [
    "diff --git a/src/app.js b/src/app.js",
    "--- a/src/app.js",
    "+++ b/src/app.js",
    "@@ -1,2 +1,2 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
    "diff --git a/README.md b/README.md",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/README.md",
    "@@ -0,0 +1 @@",
    "+# Title",
    "",
  ].join("\r\n");
await fs.writeFile(diff, text);

async function launch() {
  const instance = await electron.launch({
    ...(process.env.FOLIO_TEST_EXE
      ? { executablePath: process.env.FOLIO_TEST_EXE }
      : {}),
    args: process.env.FOLIO_TEST_EXE ? [diff] : [root, diff],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: profile,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await instance.firstWindow();
  page.setDefaultTimeout(15000);
  await page.locator("main").waitFor();
  return { instance, page };
}
async function quit(instance) {
  await instance.evaluate(({ app }) => app.exit(0)).catch(() => {});
}

let instance;
try {
  // Off (the default): the argument is ignored, like any other file type.
  ({ instance } = await launch());
  let page = await instance.firstWindow();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator("#tabs .tab").count(), 0);
  assert.equal(
    (await page.evaluate(() => window.folio.desktopStatus())).otherFormats,
    false,
  );
  await quit(instance);
  instance = null;

  // On: the same argument opens as a diff.
  await fs.writeFile(
    path.join(profile, "desktop-settings.json"),
    JSON.stringify({ closeToTray: false, otherFormats: true }),
  );
  ({ instance, page } = await launch());
  await expect(page.getByRole("tab", { name: "fix.diff" })).toBeVisible();
  await expect(page.locator("#content h2")).toHaveCount(2);
  await expect(page.locator("#content h2").first()).toContainText("src/app.js");
  await expect(page.locator("#content .diff-add")).toHaveCount(2);
  await expect(page.locator("#content .diff-del")).toHaveCount(1);
  await expect(page.locator("#outline > button")).toHaveCount(2);
  await expect(page.locator("#content [data-edit-from]")).toHaveCount(0);
  assert.equal(
    (await page.evaluate(() => window.folio.desktopStatus())).otherFormats,
    true,
  );
  await quit(instance);
  instance = null;
  // Reading never writes the file (CRLF and all).
  assert.equal(await fs.readFile(diff, "utf8"), text);
  console.log(
    "Native other formats passed: a .diff argument is ignored while off; on, it opens read-only as one section per file; the file is unchanged.",
  );
} finally {
  if (instance) await quit(instance);
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
