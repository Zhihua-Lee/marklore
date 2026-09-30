import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

async function boot(page, text) {
  await installFolio(page);
  await page.addInitScript((text) => {
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          { id: "n", name: "N.md", path: "C:/s/N.md", version: "1", text },
        ],
        restored: [],
        roots: [],
        settings: {},
      }),
    });
  }, text);
  await page.goto("/");
  await page.locator('.modes [data-mode="edit"]').click();
  await page.locator("#editor .cm-content").waitFor();
}

test("editor find: a compact bar that finds as you type, counts and replaces", async ({
  page,
}) => {
  await boot(page, "# T\n\nalpha beta\n\nBeta gamma\n\nbeta end\n");
  await page.locator("#editor .cm-line").first().click();
  await page.keyboard.press("Control+f");
  const bar = page.locator("#editor .folio-search");
  await expect(bar).toBeVisible();
  const find = bar.getByRole("textbox", { name: "查找" });
  await expect(find).toBeFocused();
  // Floats over the editor instead of taking a full-width form.
  const [barBox, editorBox] = [
    await bar.boundingBox(),
    await page.locator("#editor").boundingBox(),
  ];
  expect(barBox.width).toBeLessThan(editorBox.width);
  expect(barBox.height).toBeLessThan(48);

  await page.keyboard.type("beta");
  const count = bar.locator(".folio-search-count");
  await expect(count).toHaveText("1/3");
  // Typing selected the first match after the cursor.
  await expect(
    page.locator("#editor .cm-line").nth(2).locator(".cm-searchMatch-selected"),
  ).toHaveText("beta");
  await page.keyboard.press("Enter");
  await expect(count).toHaveText("2/3");
  await page.keyboard.press("Shift+Enter");
  await expect(count).toHaveText("1/3");

  // Match case narrows the matches, and is shown as pressed.
  await bar.getByRole("checkbox", { name: "区分大小写" }).check();
  await expect(count).toHaveText(/\/2$/);
  await bar.getByRole("checkbox", { name: "区分大小写" }).uncheck();
  await find.fill("zzz");
  await expect(count).toHaveText("无结果");
  await bar.getByRole("checkbox", { name: "正则表达式" }).check();
  await find.fill("(");
  await expect(count).toHaveText("正则有误");
  await find.fill("b.ta");
  await expect(count).toHaveText(/\/3$/);
  await bar.getByRole("checkbox", { name: "正则表达式" }).uncheck();

  // Replace lives behind the expand button.
  await find.fill("beta");
  const replace = bar.getByRole("textbox", { name: "替换为" });
  await expect(replace).toBeHidden();
  await bar.getByRole("button", { name: "显示替换" }).click();
  await expect(replace).toBeFocused();
  await replace.fill("BETA");
  await bar.getByRole("button", { name: "全部替换", exact: true }).click();
  await expect(page.locator("#editor .cm-content")).toContainText("alpha BETA");
  await expect(page.locator("#editor .cm-content")).toContainText("BETA end");

  // Esc closes and returns to the text.
  await find.focus();
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();
  await expect(page.locator("#editor .cm-content")).toBeFocused();
});

test.describe("in English", () => {
  test.use({ locale: "en-US" });
  test("editor find is translated", async ({ page }) => {
    await boot(page, "# T\n\nword\n");
    await page.locator("#editor .cm-line").first().click();
    await page.keyboard.press("Control+f");
    const bar = page.locator("#editor .folio-search");
    await expect(bar.getByRole("textbox", { name: "Find" })).toBeFocused();
    await expect(
      bar.getByRole("checkbox", { name: "Match case" }),
    ).toBeVisible();
    await expect(bar).not.toContainText(/[一-鿿]/);
  });
});

// A plain debounce kept the preview still for as long as typing went on.
test("the preview follows while typing continues", async ({ page }) => {
  await boot(page, "# T\n\nstart\n");
  await page.locator("#editor .cm-line").nth(2).click();
  await page.keyboard.press("End");
  const shown = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.type(` w${i}`);
    await page.waitForTimeout(100);
    shown.push(
      await page
        .locator("#content")
        .evaluate((el) => (el.textContent.match(/ w\d+/g) || []).length),
    );
  }
  // Well before typing stops, the preview already shows most words.
  expect(shown[8]).toBeGreaterThanOrEqual(6);
});
