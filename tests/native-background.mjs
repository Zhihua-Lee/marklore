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
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "folio-background-"));
const profile = path.join(temp, "profile"),
  note = path.join(temp, "background.md");
await fs.writeFile(note, "# Background\n\nOriginal note");
let instance;
try {
  instance = await electron.launch({
    ...(process.env.FOLIO_TEST_EXE
      ? { executablePath: process.env.FOLIO_TEST_EXE }
      : {}),
    args: process.env.FOLIO_TEST_EXE
      ? ["--background"]
      : [project, "--background"],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: profile,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await instance.firstWindow();
  await page.locator("#home:not([hidden])").waitFor();
  const visible = () =>
    instance.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    );
  assert.equal(
    await visible(),
    false,
    "background launch must not flash a window",
  );
  assert.equal(
    (await page.evaluate(() => window.folio.desktopStatus())).trayAvailable,
    true,
  );
  // Read-only native status above; OS-changing methods below are mocked. These
  // tests must never change the developer's actual startup/default applications.
  await instance.evaluate(({ app, shell, Tray }) => {
    globalThis.__desktopWrites = [];
    globalThis.__desktopUris = [];
    let startup = false;
    app.getLoginItemSettings = () => ({
      openAtLogin: startup,
      executableWillLaunchAtLogin: startup,
    });
    app.setLoginItemSettings = (options) => {
      globalThis.__desktopWrites.push(options);
      startup = options.openAtLogin;
    };
    shell.openExternal = async (uri) => {
      globalThis.__desktopUris.push(uri);
    };
    const setContextMenu = Tray.prototype.setContextMenu;
    Tray.prototype.setContextMenu = function (menu) {
      globalThis.__desktopTrayMenu = menu;
      return setContextMenu.call(this, menu);
    };
  });
  // Use the native single-instance event; it must both accept a note and restore.
  await instance.evaluate(({ app }, file) => {
    app.emit("second-instance", {}, [process.execPath, file], process.cwd());
  }, note);
  await page.locator("#content h1").waitFor();
  await expect.poll(visible).toBe(true);
  assert.match(await page.locator("#content h1").innerText(), /Background$/);
  await page.locator("#weight").click();
  await expect(page.locator("#association-status")).not.toHaveText("");
  await page.locator("#close-to-tray").check();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.folio.desktopStatus())).closeToTray,
    )
    .toBe(true);
  if (process.env.FOLIO_TEST_EXE) {
    await page.locator("#start-at-login").check();
    await expect
      .poll(() => instance.evaluate(() => globalThis.__desktopWrites.length))
      .toBe(1);
    const [write] = await instance.evaluate(() => globalThis.__desktopWrites);
    assert.deepEqual(write.args, ["--background"]);
    assert.equal(write.name, "Marklore");
    assert.equal(write.openAtLogin, true);
    await page.locator("#manage-defaults").click();
    await expect
      .poll(() => instance.evaluate(() => globalThis.__desktopUris.length))
      .toBe(1);
    assert.deepEqual(await instance.evaluate(() => globalThis.__desktopUris), [
      Number(os.release().split(".")[2]) >= 22000
        ? "ms-settings:defaultapps?registeredAppUser=Marklore"
        : "ms-settings:defaultapps",
    ]);
  }
  await page.screenshot({
    path: path.join(project, ".local", "native-desktop-settings.png"),
  });
  await page.locator("#appearance-close").click();
  await instance.evaluate(() =>
    globalThis.__desktopTrayMenu.items
      .find((item) => item.label === "隐藏到托盘")
      .click(),
  );
  await expect.poll(visible).toBe(false);
  await fs.writeFile(note, "# Background\n\nExternal update while hidden");
  await page.waitForTimeout(500);
  assert.doesNotMatch(
    await page.locator("#content").textContent(),
    /External update while hidden/,
  );
  await instance.evaluate(() =>
    globalThis.__desktopTrayMenu.items
      .find((item) => item.label === "打开 Marklore")
      .click(),
  );
  await expect(page.locator("#content")).toContainText(
    "External update while hidden",
  );
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" UNSAVED BACKGROUND DRAFT");
  await instance.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  await expect.poll(visible).toBe(false);
  let session = JSON.parse(
    await fs.readFile(path.join(profile, "session.json"), "utf8"),
  );
  assert.ok(
    session.tabs.some((tab) => tab.draft?.includes("UNSAVED BACKGROUND DRAFT")),
  );
  assert.equal(
    await fs.readFile(note, "utf8"),
    "# Background\n\nExternal update while hidden",
  );
  await instance.evaluate(() => {
    globalThis.__desktopTrayMenu.items
      .find((item) => item.label === "打开 Marklore")
      .click();
  });
  await expect.poll(visible).toBe(true);
  await expect(page.locator(".cm-content")).toContainText(
    "UNSAVED BACKGROUND DRAFT",
  );
  // Native tray settings route and explicit hide retain session and work even
  // when closing-to-tray is not configured.
  await instance.evaluate(() =>
    globalThis.__desktopTrayMenu.items
      .find((item) => item.label === "后台与默认应用设置…")
      .click(),
  );
  await expect(page.locator("#appearance")).toBeVisible();
  await page.locator("#close-to-tray").uncheck();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.folio.desktopStatus())).closeToTray,
    )
    .toBe(false);
  await page.locator("#hide-to-tray").click();
  await expect.poll(visible).toBe(false);
  await instance.evaluate(({ dialog }) => {
    globalThis.__desktopPrompts = 0;
    dialog.showMessageBox = async () => {
      globalThis.__desktopPrompts++;
      return { response: 0 };
    };
    globalThis.__desktopTrayMenu.items
      .find((item) => item.label === "退出 Marklore")
      .click();
  });
  await expect
    .poll(() => instance.evaluate(() => globalThis.__desktopPrompts))
    .toBe(1);
  await expect.poll(visible).toBe(true);
  session = JSON.parse(
    await fs.readFile(path.join(profile, "session.json"), "utf8"),
  );
  assert.ok(
    session.tabs.some((tab) => tab.draft?.includes("UNSAVED BACKGROUND DRAFT")),
  );
  const exited = instance.waitForEvent("close");
  await instance.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
    globalThis.__desktopTrayMenu.items
      .find((item) => item.label === "退出 Marklore")
      .click();
  });
  await exited;
  console.log(
    "Native background passed: hidden startup, native tray creation/menu, file-open restore, opt-in controls (OS writes mocked), draft preservation, cancel/confirm explicit quit.",
  );
} finally {
  if (instance)
    await instance.evaluate(({ app }) => app.exit(0)).catch(() => {});
  // Only the uniquely-created isolated fixture is removed, never user data.
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
