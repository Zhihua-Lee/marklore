import { test, expect } from "@playwright/test";

async function boot(page, state = {}) {
  await page.goto("/");
  await page.evaluate(async (state) => {
    const { wireDesktopSettings } = await import("/src/desktop-settings.js");
    window.desktopMock = {
      state: {
        closeToTray: false,
        startup: false,
        supported: true,
        trayAvailable: true,
        executable: "D:\\Marklore.exe",
        defaults: [],
        ...state,
      },
      actions: [],
      errors: [],
      handlers: {},
    };
    const m = window.desktopMock;
    wireDesktopSettings({
      api: {
        on: (name, fn) => (m.handlers[name] = fn),
        desktopStatus: async () => ({ ...m.state }),
        desktopAction: (action) => {
          m.actions.push(action);
          return new Promise((resolve, reject) => {
            m.finish = () => {
              if (action.type === "otherFormats")
                m.state.otherFormats = action.value;
              else m.state.closeToTray = action.value;
              resolve({ ...m.state });
            };
            m.fail = () => reject(Error("Write failed"));
          });
        },
      },
      close: async (intent) => m.actions.push({ intent }),
      report: (message) => m.errors.push(message),
      formatsChanged: () => m.actions.push({ formatsChanged: true }),
    });
  }, state);
  await page.locator("#weight").click();
  await expect(page.locator("#association-status")).not.toHaveText("");
}

test("system settings preserve the toggled value while pending and roll back failed writes", async ({
  page,
}) => {
  await boot(page);
  await page.locator("#close-to-tray").check();
  await expect(page.locator("#close-to-tray")).toBeChecked();
  await expect(page.locator("#start-at-login")).toBeDisabled();
  await page.evaluate(() => window.desktopMock.finish());
  await expect(page.locator("#close-to-tray")).toBeEnabled();
  await page.locator("#close-to-tray").uncheck();
  await page.evaluate(() => window.desktopMock.fail());
  await expect(page.locator("#close-to-tray")).toBeChecked();
  expect(await page.evaluate(() => window.desktopMock.errors)).toEqual([
    "Write failed",
  ]);
  await page.locator("#hide-to-tray").click();
  await page.locator("#quit-app").click();
  expect(await page.evaluate(() => window.desktopMock.actions)).toEqual([
    { type: "background", value: true },
    { type: "background", value: false },
    { intent: "hide" },
    { intent: "quit" },
  ]);
});

test("missing tray disables hide; an old startup registration offers an explicit update", async ({
  page,
}) => {
  await boot(page, { trayAvailable: false, startupOtherVersion: true });
  await expect(page.locator("#hide-to-tray")).toBeDisabled();
  await expect(page.locator("#close-to-tray")).toBeDisabled();
  await expect(page.locator("#start-at-login")).toBeChecked();
  await expect(page.locator("#update-startup")).toBeVisible();
  await page.locator("#update-startup").click();
  expect(await page.evaluate(() => window.desktopMock.actions)).toEqual([
    { type: "startup", value: true },
  ]);
});

test("other formats are off by default; turning them on shows their associations apart from Markdown's", async ({
  page,
}) => {
  await boot(page, {
    registered: true,
    registeredHere: true,
    otherFormats: false,
    defaults: [
      { extension: ".md", ours: true, known: true },
      { extension: ".markdown", ours: false, known: true },
      { extension: ".diff", other: true, ours: false, known: false },
      { extension: ".patch", other: true, ours: false, known: true },
    ],
  });
  const toggle = page.getByRole("checkbox", { name: "其他格式：diff / patch" });
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("#association-status")).not.toContainText(".diff");
  await expect(page.locator("#other-formats-status")).toHaveText(
    "打开 .diff / .patch（统一 diff），只读查看；不进笔记库",
  );
  await toggle.check();
  await page.evaluate(() => window.desktopMock.finish());
  await expect(toggle).toBeChecked();
  await expect(page.locator("#other-formats-status")).toHaveText(
    ".diff：未读取到用户默认项；.patch：其他应用",
  );
  await expect
    .poll(() => page.evaluate(() => window.desktopMock.actions))
    .toEqual([{ type: "otherFormats", value: true }, { formatsChanged: true }]);
});

test("the version row checks, then downloads and installs in one click", async ({
  page,
}) => {
  await boot(page);
  // The browser preview has no updater: the rows stay hidden.
  await expect(page.locator("#update-action")).toBeHidden();
  await boot(page, {
    checkUpdates: false,
    update: {
      current: "0.3.0",
      kind: "folder",
      latest: "0.3.1",
      available: true,
    },
  });
  await expect(page.locator("#update-status")).toHaveText(
    "v0.3.0，有新版本 v0.3.1；更新后自动重新打开",
  );
  await expect(page.locator("#update-notes")).toBeVisible();
  await page.locator("#update-action").click();
  await page.evaluate(() =>
    window.desktopMock.handlers.update({
      state: {
        current: "0.3.0",
        kind: "folder",
        latest: "0.3.1",
        available: true,
        downloading: true,
        progress: 42,
      },
    }),
  );
  await expect(page.locator("#update-status")).toHaveText(
    "正在下载 v0.3.1… 42%",
  );
  await page.evaluate(() => {
    const m = window.desktopMock;
    m.state.update = { ...m.state.update, ready: "0.3.1", progress: 100 };
    m.finish();
  });
  await expect
    .poll(() => page.evaluate(() => window.desktopMock.actions))
    .toEqual([{ type: "updateDownload" }, { type: "updateApply" }]);
  await page.evaluate(() =>
    window.desktopMock.handlers.update({
      result: { updated: true, version: "0.3.1" },
    }),
  );
  expect(await page.evaluate(() => window.desktopMock.errors)).toEqual([
    "已更新到 v0.3.1",
  ]);
});
