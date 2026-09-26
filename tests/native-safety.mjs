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
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "folio-native-safety-"));
const source = path.join(temp, "source.md"),
  target = path.join(temp, "target.md"),
  profile = path.join(temp, "profile");
await fs.writeFile(source, "# Source\n\nOriginal source");
await fs.writeFile(target, "# Target\n\nOriginal target");
let instance;
try {
  instance = await electron.launch({
    ...(process.env.FOLIO_TEST_EXE
      ? { executablePath: process.env.FOLIO_TEST_EXE }
      : {}),
    args: process.env.FOLIO_TEST_EXE ? [source] : [project, source],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: profile,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await instance.firstWindow();
  await page.locator("#content h1").waitFor();
  await instance.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: paths,
      });
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: paths[1],
      });
    },
    [source, target],
  );
  const [sourceDoc, targetDoc] = await page.evaluate(() =>
    window.folio.pickFiles(),
  );

  // The rejected destination must not be opened, initialized or overwritten.
  const excludedError = await page.evaluate(async (id) => {
    try {
      await window.folio.saveAs("MUST NOT WRITE", "new.md", [id]);
      return "unexpected success";
    } catch (error) {
      return error.message;
    }
  }, targetDoc.id);
  assert.match(excludedError, /目标已在其他标签页打开/);
  assert.equal(
    await fs.readFile(target, "utf8"),
    "# Target\n\nOriginal target",
  );

  // Let the initial UI recovery write settle, then prove rejection is non-mutating.
  await page.waitForTimeout(900);
  await page.evaluate(
    (doc) =>
      window.folio.session({
        tabs: [{ fileId: doc.id, name: doc.name }],
        roots: [],
        active: doc.path,
      }),
    sourceDoc,
  );
  const recoveryBefore = await fs.readFile(
    path.join(profile, "session.json"),
    "utf8",
  );
  const sessionError = await page.evaluate(async () => {
    try {
      await window.folio.session({
        tabs: Array.from({ length: 101 }, (_, i) => ({
          name: `${i}.md`,
          draft: "UNSAVED",
        })),
      });
      return "unexpected success";
    } catch (error) {
      return error.message;
    }
  });
  assert.match(sessionError, /最多恢复 100 个标签/);
  assert.equal(
    await fs.readFile(path.join(profile, "session.json"), "utf8"),
    recoveryBefore,
  );

  // A dirty source triggers the real cancelled-quit flow; the clean target must
  // still receive filesystem notifications after Electron's before-quit event.
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" UNSAVED DRAFT");
  await instance.evaluate(({ BrowserWindow }, doc) => {
    BrowserWindow.getAllWindows()[0].webContents.send("folio:open", [doc]);
  }, targetDoc);
  await page.getByRole("tab", { name: "target.md", exact: true }).waitFor();
  await instance.evaluate(({ app, dialog }) => {
    globalThis.__safetyQuitPrompts = 0;
    dialog.showMessageBox = async (_window, options) => {
      if (options.message === "有未保存的笔记")
        globalThis.__safetyQuitPrompts++;
      return { response: 0 };
    };
    app.quit();
  });
  const deadline = Date.now() + 5000;
  while (!(await instance.evaluate(() => globalThis.__safetyQuitPrompts))) {
    assert.ok(Date.now() < deadline, "cancelled quit confirmation did not run");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await fs.writeFile(target, "# Target\n\nWATCHER AFTER CANCELLED QUIT");
  await page.waitForFunction(() =>
    document
      .querySelector("#content")
      ?.textContent.includes("WATCHER AFTER CANCELLED QUIT"),
  );
  assert.equal(
    await fs.readFile(source, "utf8"),
    "# Source\n\nOriginal source",
  );
  console.log(
    "Native safety passed: SaveAs excludes open destinations before write; oversized session preserves recovery; cancelled quit retains filesystem watcher.",
  );
} finally {
  if (instance)
    await instance.evaluate(({ app }) => app.exit(0)).catch(() => {});
  // Only this uniquely created fixture is removed; all junction tests live elsewhere.
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
