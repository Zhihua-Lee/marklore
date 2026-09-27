import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "folio-drop-copy-"));
const source = path.join(temp, "source.md"),
  other = path.join(temp, "other.markdown"),
  binary = path.join(temp, "ignored.bin");
await fs.writeFile(
  source,
  '# Native copy\n\n```js\nconst text = "中文";\n\tconsole.log(text);\n```\n',
);
await fs.writeFile(other, "# Dropped note\n\nExternal file");
await fs.writeFile(binary, "not markdown");
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
  await page.locator("#content .code-copy").waitFor();
  await instance.evaluate(({ clipboard }) => {
    globalThis.__copied = [];
    clipboard.writeText = (text) => globalThis.__copied.push(text);
  });
  await page.locator("#content .code-copy").click();
  assert.deepEqual(await instance.evaluate(() => globalThis.__copied), [
    'const text = "中文";\n\tconsole.log(text);\n',
  ]);
  const fake = await page.evaluate(async () => {
    try {
      await window.folio.openDroppedFiles([new File(["hello"], "forged.md")]);
      return "unexpected success";
    } catch (error) {
      return error.message;
    }
  });
  assert.match(fake, /真实文件/);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("UNSAVED KEEP");
  const cdp = await page.context().newCDPSession(page);
  const data = {
    items: [],
    files: [source, other, binary],
    dragOperationsMask: 1,
  };
  for (const type of ["dragEnter", "dragOver", "drop"])
    await cdp.send("Input.dispatchDragEvent", { type, x: 650, y: 250, data });
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator("#content h1")).toContainText("Dropped note");
  await expect(page.locator("#toast")).toContainText("不支持的文件类型");
  await page.getByRole("tab").filter({ hasText: "source.md" }).click();
  await expect(page.locator(".cm-content")).toContainText("UNSAVED KEEP");
  assert.doesNotMatch(await fs.readFile(source, "utf8"), /UNSAVED KEEP/);
  await expect(page.locator("body")).not.toHaveClass(/file-drop/);
  await cdp.detach();
  if (process.env.FOLIO_TEST_EXE) {
    const icon = await instance.evaluate(async ({ app }) => {
      const image = await app.getFileIcon(process.execPath, { size: "large" });
      const pixels = image.toBitmap();
      let green = 0,
        paper = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const [b, g, r, a] = pixels.subarray(i, i + 4);
        if (a > 128 && g > r * 1.4 && g > b * 1.05) green++;
        if (a > 128 && r > 180 && g > 180 && b > 150) paper++;
      }
      return {
        png: image.toPNG().toString("base64"),
        green,
        paper,
        total: pixels.length / 4,
      };
    });
    assert.ok(
      icon.green > icon.total * 0.1 && icon.paper > icon.total * 0.08,
      "Windows must extract the page logo, not a generic executable icon",
    );
    await fs.writeFile(
      path.join(root, ".local/native-app-icon.png"),
      Buffer.from(icon.png, "base64"),
    );
  }
  console.log(
    "Native copy/drop passed: clipboard write mocked; real file-backed drag opens multiple notes, rejects unsupported/synthetic files, preserves an existing dirty tab and original disk content.",
  );
} finally {
  if (instance)
    await instance.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
