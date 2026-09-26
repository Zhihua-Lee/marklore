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
        executable: "D:\\Folio Notes.exe",
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
              m.state.closeToTray = action.value;
              resolve({ ...m.state });
            };
            m.fail = () => reject(Error("Write failed"));
          });
        },
      },
      close: async (intent) => m.actions.push({ intent }),
      report: (message) => m.errors.push(message),
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
