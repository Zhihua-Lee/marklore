import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

async function boot(page, state) {
  await installFolio(page);
  await page.addInitScript((state) => {
    window.actions = [];
    window.folio = folioTest.mock({
      ...(state && {
        windowState: async () => state,
        windowAction: async (action) => {
          window.actions.push(action);
        },
      }),
    });
  }, state);
  await page.goto("/");
}

test("desktop window controls sit apart at the toolbar's end and act on the window", async ({
  page,
}) => {
  await boot(page, { own: true, fullScreen: false, maximized: false });
  const controls = page.locator(".window-controls");
  await expect(controls).toBeVisible();
  const labels = await controls
    .locator("button")
    .evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label")));
  expect(labels).toEqual(["全屏", "最小化", "最大化", "关闭"]);
  // Flush with the window edge, after every other toolbar control.
  const geometry = await page.evaluate(() => {
    const bar = document.querySelector(".topbar").getBoundingClientRect(),
      group = document
        .querySelector(".window-controls")
        .getBoundingClientRect(),
      others = [...document.querySelectorAll(".topbar button")]
        .filter(
          (b) => !b.closest(".window-controls") && b.getClientRects().length,
        )
        .map((b) => b.getBoundingClientRect().right);
    return {
      gap: bar.right - group.right,
      left: group.left,
      others: Math.max(...others),
      width: group.width,
    };
  });
  expect(Math.abs(geometry.gap)).toBeLessThan(1);
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.others);
  expect(geometry.width).toBeLessThanOrEqual(4 * 34 + 12);
  for (const action of ["fullScreen", "minimize", "maximize", "close"])
    await controls.locator(`[data-window="${action}"]`).click();
  expect(await page.evaluate(() => window.actions)).toEqual([
    "fullScreen",
    "minimize",
    "maximize",
    "close",
  ]);
  // Main reports state changes: maximised shows "restore", full screen keeps
  // only the way out (and close).
  await page.evaluate(() =>
    window.mock.handlers.window({
      own: true,
      maximized: true,
      fullScreen: false,
    }),
  );
  await expect(controls.locator('[data-window="maximize"]')).toHaveAttribute(
    "aria-label",
    "还原",
  );
  await page.evaluate(() =>
    window.mock.handlers.window({
      own: true,
      maximized: false,
      fullScreen: true,
    }),
  );
  await expect(controls.locator('[data-window="fullScreen"]')).toHaveAttribute(
    "aria-label",
    "退出全屏",
  );
  await expect(controls.locator('[data-window="minimize"]')).toBeHidden();
  await expect(controls.locator('[data-window="maximize"]')).toBeHidden();
  await expect(controls.locator('[data-window="close"]')).toBeVisible();
});

test("without the desktop app's own controls the group stays hidden", async ({
  page,
}) => {
  await boot(page, null);
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".window-controls")).toBeHidden();
});
