// Choosing the interface language in Settings takes effect at once in the
// desktop app: the page reloads itself (the navigation guard must allow a
// reload of the current page) and main switches its menus.
import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const temp = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "folio-language-")),
);
const note = path.join(temp, "note.md");
await fs.writeFile(note, "# Language\n\nText.\n");
const exe = process.env.FOLIO_TEST_EXE;
let instance;
try {
  instance = await electron.launch({
    ...(exe ? { executablePath: exe } : {}),
    // Start from Chinese whatever the machine's language.
    args: [...(exe ? [] : [project]), "--lang=zh-CN", note],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: path.join(temp, "profile"),
      FOLIO_LANG: "",
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await instance.firstWindow();
  const read = page.locator('.modes [data-mode="read"]');
  const menu = () =>
    instance.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].label);
  await page.locator("#content h1").waitFor();
  assert.equal(await read.textContent(), "阅读");
  assert.equal(await menu(), "文件");

  for (const [choice, label, menuLabel] of [
    ["en", "Read", "File"],
    ["zh", "阅读", "文件"],
  ]) {
    await page.locator("#weight").click();
    await page.locator("#interface-language").selectOption(choice);
    await page.waitForFunction(
      (label) =>
        document.querySelector('.modes [data-mode="read"]')?.textContent ===
        label,
      label,
      { timeout: 15000 },
    );
    assert.equal(await menu(), menuLabel);
    // The note is still open after the rebuild.
    await page.locator("#content h1").waitFor();
  }
  console.log(
    "Native language passed: the choice in Settings reloads the interface and switches menus at once, both ways.",
  );
} finally {
  if (instance) {
    await instance
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await instance.close().catch(() => {});
  }
  await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
}
