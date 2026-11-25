import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

async function boot(page) {
  await installFolio(page);
  await page.addInitScript(() => {
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          {
            id: "n",
            name: "A.md",
            path: "C:/s/A.md",
            version: "1",
            text: "# A\n",
          },
        ],
        restored: [],
        roots: [],
        settings: {},
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
}

test("settings: section links, a fixed title bar and no sideways scrolling", async ({
  page,
}) => {
  await boot(page);
  const dialog = page.locator("#appearance"),
    pane = dialog.locator(".settings-pane"),
    close = page.getByRole("button", { name: "关闭设置" });
  await expect(
    dialog.locator('.settings-nav [aria-current="page"]'),
  ).toHaveText("阅读排版");
  await expect(dialog.locator("#settings-reading")).toBeVisible();
  await expect(dialog.locator("#settings-navigation")).toBeHidden();
  const titleTop = (await close.boundingBox()).y;

  await dialog.getByRole("button", { name: "导航与滚动" }).click();
  await expect(
    dialog.locator('.settings-nav [aria-current="page"]'),
  ).toHaveText("导航与滚动");
  await expect(dialog.locator("#settings-navigation")).toBeVisible();
  await expect(dialog.locator("#settings-reading")).toBeHidden();
  expect(await pane.evaluate((el) => el.scrollTop)).toBe(0);
  const paneTop = (await pane.boundingBox()).y,
    sectionTop = (await dialog.locator("#settings-navigation").boundingBox()).y;
  expect(Math.abs(sectionTop - paneTop)).toBeLessThan(40);
  expect(Math.abs((await close.boundingBox()).y - titleTop)).toBeLessThan(1);
  await expect(dialog.locator("#smooth-scroll")).toBeInViewport();
  // Controls fit: the pane never scrolls sideways.
  expect(
    await pane.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  // Switching back marks the first page again.
  await dialog.getByRole("button", { name: "阅读排版" }).click();
  await expect(
    dialog.locator('.settings-nav [aria-current="page"]'),
  ).toHaveText("阅读排版");
  await expect(dialog.locator("#settings-reading")).toBeVisible();
  await expect(dialog.locator("#settings-navigation")).toBeHidden();
  // The desktop-only section is left out of the browser demo.
  await expect(dialog.getByRole("button", { name: "后台与系统" })).toBeHidden();
  await close.click();
  await expect(dialog).toBeHidden();
});

test("settings on a narrow window: links in a row above the pane", async ({
  page,
}) => {
  await page.setViewportSize({ width: 500, height: 700 });
  await boot(page);
  const nav = page.locator(".settings-nav"),
    pane = page.locator(".settings-pane");
  const [navBox, paneBox] = [await nav.boundingBox(), await pane.boundingBox()];
  expect(navBox.y + navBox.height).toBeLessThanOrEqual(paneBox.y + 1);
  expect(
    await pane.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
});
