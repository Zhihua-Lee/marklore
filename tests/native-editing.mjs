import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "folio-editing-"));
const folder = path.join(temp, "notes"),
  external = path.join(temp, "external");
await fs.mkdir(folder);
await fs.mkdir(external);
const source = path.join(folder, "source.md"),
  image = path.join(external, "选定图片.png");
await fs.writeFile(source, "Hello 中文");
await fs.copyFile(path.join(root, "desktop/icons/folio.png"), image);
let instance;
try {
  instance = await electron.launch({
    ...(process.env.FOLIO_TEST_EXE
      ? { executablePath: process.env.FOLIO_TEST_EXE }
      : {}),
    args: process.env.FOLIO_TEST_EXE ? [source] : [root, source],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: path.join(temp, "profile"),
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await instance.firstWindow();
  page.setDefaultTimeout(15000);
  await expect(page.locator("#content")).toContainText("Hello 中文");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+b");
  await expect(page.locator("#content strong")).toHaveText("Hello 中文");
  await page.keyboard.press("Control+End");
  await instance.evaluate(({ dialog }, image) => {
    dialog.showOpenDialog = async (_win, options) => {
      globalThis.__imageOptions = options;
      return { canceled: false, filePaths: [image] };
    };
  }, image);
  await page.getByRole("button", { name: "插入图片", exact: true }).click();
  await expect(page.locator("#content img")).toHaveCount(1);
  await expect
    .poll(() => page.locator("#content img").evaluate((el) => el.naturalWidth))
    .toBe(256);
  const options = await instance.evaluate(() => globalThis.__imageOptions);
  assert.equal(options.defaultPath, folder);
  assert.deepEqual(options.properties, ["openFile"]);
  const attachments = await fs.readdir(path.join(folder, "assets"));
  assert.equal(attachments.length, 1);
  assert.deepEqual(
    await fs.readFile(path.join(folder, "assets", attachments[0])),
    await fs.readFile(image),
  );
  assert.equal(await fs.readFile(source, "utf8"), "Hello 中文");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator("#content img")).toHaveCount(0);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(page.locator("#content img")).toHaveCount(1);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(() => fs.readFile(source, "utf8"))
    .toContain("assets/image-");
  const saved = await fs.readFile(source, "utf8");
  assert.match(saved, /\*\*Hello 中文\*\*/);
  await instance.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await page.getByRole("button", { name: "插入图片", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "插入图片", exact: true }),
  ).toBeEnabled();
  assert.equal((await fs.readdir(path.join(folder, "assets"))).length, 1);
  // Paste an actual PNG payload through the renderer File/preload boundary,
  // without touching the user's system clipboard.
  await page.locator("#content p").first().hover();
  await page.getByRole("button", { name: "就地编辑此块", exact: true }).click();
  await page.locator(".block-editor .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.evaluate(
    (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], "clipboard.png", { type: "image/png" }),
      );
      document.querySelector(".block-editor .cm-content").dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    (await fs.readFile(image)).toString("base64"),
  );
  await expect(page.locator(".block-editor .cm-content")).toContainText(
    "粘贴图片",
  );
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("#content img")).toHaveCount(2);
  const cdp = await page.context().newCDPSession(page);
  const box = await page.locator("#reader").boundingBox();
  for (const type of ["dragEnter", "dragOver", "drop"])
    await cdp.send("Input.dispatchDragEvent", {
      type,
      x: box.x + 70,
      y: box.y + 70,
      data: { items: [], files: [image], dragOperationsMask: 1 },
    });
  await expect(page.locator("#content img")).toHaveCount(3);
  await expect
    .poll(() =>
      page
        .locator("#content img")
        .evaluateAll((imgs) => imgs.every((img) => img.naturalWidth === 256)),
    )
    .toBe(true);
  await cdp.detach();
  const pdf = path.join(folder, "报告 one.pdf");
  await fs.writeFile(pdf, "%PDF-1.4\nsynthetic");
  await instance.evaluate(({ dialog, shell }) => {
    globalThis.__openedAttachments = [];
    dialog.showMessageBox = async () => ({ response: 1 });
    shell.openPath = async (target) => {
      globalThis.__openedAttachments.push(target);
      return "";
    };
  });
  await page.locator("#editor .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n\n[PDF](<报告 one.pdf>)");
  await page
    .locator("#content")
    .getByRole("link", { name: "PDF", exact: true })
    .click();
  assert.deepEqual(
    await instance.evaluate(() => globalThis.__openedAttachments),
    [pdf],
  );
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.screenshot({
    path: path.join(root, ".local/native-editor-v016.png"),
  });
  console.log(
    "Native toolbar, block editing, picker/paste/file-drop images, decoded attachments, external PDF default-app routing, atomic undo/redo and save passed.",
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  if (instance)
    await instance.evaluate(({ app }) => app.exit(0)).catch(() => {});
  // Synthetic, uniquely created fixture only; never user notes.
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
