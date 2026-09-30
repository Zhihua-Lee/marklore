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
    dialog.locator('.settings-nav [aria-current="true"]'),
  ).toHaveText("阅读排版");
  const titleTop = (await close.boundingBox()).y;

  await dialog.getByRole("button", { name: "导航与滚动" }).click();
  await expect(
    dialog.locator('.settings-nav [aria-current="true"]'),
  ).toHaveText("导航与滚动");
  // The section starts near the top of the pane, or the pane is scrolled to
  // its end (the last section can be too short to reach the top).
  const paneTop = (await pane.boundingBox()).y,
    sectionTop = (await dialog.locator("#settings-navigation").boundingBox()).y,
    atEnd = await pane.evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
    );
  expect(atEnd || Math.abs(sectionTop - paneTop) < 40).toBe(true);
  expect(Math.abs((await close.boundingBox()).y - titleTop)).toBeLessThan(1);
  await expect(dialog.locator("#smooth-scroll")).toBeInViewport();
  // Controls fit: the pane never scrolls sideways.
  expect(
    await pane.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  // Scrolling back marks the first section again.
  await pane.evaluate((el) => (el.scrollTop = 0));
  await expect(
    dialog.locator('.settings-nav [aria-current="true"]'),
  ).toHaveText("阅读排版");
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
