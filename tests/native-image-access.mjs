import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "folio-image-access-"));
const note =
  process.env.FOLIO_TEST_NOTE || path.join(temp, "reviews", "note.md");
if (!process.env.FOLIO_TEST_NOTE) {
  await fs.mkdir(path.dirname(note));
  await fs.mkdir(path.join(temp, "cache"));
  await fs.copyFile(
    path.join(project, "desktop/icons/folio.png"),
    path.join(temp, "cache/page-4.png"),
  );
  await fs.writeFile(
    note,
    "<details><summary>Answer</summary>\n\n![Page](<../cache/page-4.png>)\n\n</details>",
  );
}
const original = await fs.readFile(note);
let instance;
try {
  instance = await electron.launch({
    ...(process.env.FOLIO_TEST_EXE
      ? { executablePath: process.env.FOLIO_TEST_EXE }
      : {}),
    args: process.env.FOLIO_TEST_EXE ? [note] : [project, note],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: path.join(temp, "profile"),
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await instance.firstWindow();
  page.setDefaultTimeout(15000);
  await expect(page.locator("#content details").first()).toBeVisible();
  await page
    .locator("#content details")
    .evaluateAll((nodes) => nodes.forEach((node) => (node.open = true)));
  await expect(
    page.getByRole("button", { name: "授权加载图片…" }).first(),
  ).toBeVisible();
  await instance.evaluate(
    ({ dialog }) => (dialog.showMessageBox = async () => ({ response: 0 })),
  );
  await page.getByRole("button", { name: "授权加载图片…" }).first().click();
  await expect(page.locator(".image-problem").first()).toBeVisible();
  await instance.evaluate(
    ({ dialog }) => (dialog.showMessageBox = async () => ({ response: 2 })),
  );
  await page.getByRole("button", { name: "授权加载图片…" }).first().click();
  await expect
    .poll(() =>
      page
        .locator("#content img")
        .first()
        .evaluate((img) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.locator("#content p").first().hover();
  await expect(page.locator("#block-edit-launch")).toBeHidden();
  await page.reload();
  await expect
    .poll(() =>
      page
        .locator("#content img")
        .first()
        .evaluate((img) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  assert.deepEqual(await fs.readFile(note), original);
  console.log(
    "Image access passed: sibling-path denial explained, cancel preserved, consent enables decoding and survives reload; original note unchanged; no read-mode pencil.",
  );
} finally {
  if (instance)
    await instance.evaluate(({ app }) => app.exit(0)).catch(() => {});
  // Only the uniquely generated fixture/profile directory is removed.
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
