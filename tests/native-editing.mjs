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
  await instance.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].hide(),
  );
  page.setDefaultTimeout(15000);
  const editor = page.locator("#rich .ProseMirror");
  const images = editor.locator("img:not(.ProseMirror-separator)");
  await expect(page.locator("#content")).toContainText("Hello 中文");
  // A double click on a word while reading: Edit mode, the word selected
  // in the note as drawn.
  await page
    .locator("#content p")
    .first()
    .dblclick({ position: { x: 14, y: 10 } });
  await expect(editor).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.getSelection().toString()))
    .toBe("Hello");
  // Formatting from the keyboard and the toolbar, undone exactly.
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+b");
  await expect(editor.locator("strong")).toHaveText("Hello 中文");
  await page.getByRole("button", { name: "文字高亮", exact: true }).click();
  await expect(editor.locator("mark")).toHaveText("Hello 中文");
  await page.keyboard.press("Control+z");
  await expect(editor.locator("mark")).toHaveCount(0);
  await page
    .getByRole("button", { name: "文字颜色", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("dialog", { name: "文字调色板" })
    .getByRole("button", { name: "蓝色", exact: true })
    .click();
  await expect(editor.locator('span.rich-html[style*="color"]')).toHaveText(
    "Hello 中文",
  );
  await page.keyboard.press("Control+z");
  await expect(editor.locator("span.rich-html")).toHaveCount(0);
  assert.equal(await fs.readFile(source, "utf8"), "Hello 中文");
  // An image picked in the system dialog: copied into the note's assets,
  // shown from there, undone and redone from the toolbar.
  await page.keyboard.press("Control+End");
  await instance.evaluate(({ dialog }, image) => {
    dialog.showOpenDialog = async (_win, options) => {
      globalThis.__imageOptions = options;
      return { canceled: false, filePaths: [image] };
    };
  }, image);
  await page.getByRole("button", { name: "插入图片", exact: true }).click();
  await expect(images).toHaveCount(1);
  await expect
    .poll(() => images.first().evaluate((el) => el.naturalWidth))
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
  await expect(images).toHaveCount(0);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(images).toHaveCount(1);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(() => fs.readFile(source, "utf8"))
    .toContain("assets/image-");
  assert.match(await fs.readFile(source, "utf8"), /\*\*Hello 中文\*\*/);
  // A cancelled dialog copies nothing.
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
  await editor.focus();
  await page.keyboard.press("Control+End");
  await page.evaluate(
    (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], "clipboard.png", { type: "image/png" }),
      );
      document.querySelector("#rich .ProseMirror").dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    (await fs.readFile(image)).toString("base64"),
  );
  await expect(images).toHaveCount(2);
  // A file dropped from the system onto the note.
  const cdp = await page.context().newCDPSession(page);
  const box = await editor.locator("p").first().boundingBox();
  for (const type of ["dragEnter", "dragOver", "drop"])
    await cdp.send("Input.dispatchDragEvent", {
      type,
      x: box.x + 20,
      y: box.y + box.height / 2,
      data: { items: [], files: [image], dragOperationsMask: 1 },
    });
  await expect(images).toHaveCount(3);
  await expect
    .poll(() =>
      images.evaluateAll((imgs) =>
        imgs.every((img) => img.naturalWidth === 256),
      ),
    )
    .toBe(true);
  await cdp.detach();
  assert.equal((await fs.readdir(path.join(folder, "assets"))).length, 3);
  // A link to a local PDF, typed as Markdown, opens in the default app.
  const pdf = path.join(folder, "报告 one.pdf");
  await fs.writeFile(pdf, "%PDF-1.4\nsynthetic");
  await instance.evaluate(({ dialog, shell }) => {
    globalThis.__openedAttachments = [];
    dialog.showMessageBox = async () => {
      throw Error("Attachment click must not ask for confirmation");
    };
    shell.openPath = async (target) => {
      globalThis.__openedAttachments.push(target);
      return "";
    };
  });
  await editor.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("[PDF](<报告 one.pdf>)");
  const link = editor.locator("a", { hasText: "PDF" });
  await expect(link).toHaveCount(1);
  await link.click({ modifiers: ["Control"] });
  await expect
    .poll(() => instance.evaluate(() => globalThis.__openedAttachments))
    .toEqual([pdf]);
  await expect(page.getByRole("tab")).toHaveCount(1);
  console.log(
    "Native editing: double-click into Edit mode, keyboard and toolbar formatting with undo, picker/paste/file-drop images into assets, PDF attachment to the default app, save passed.",
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
