import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

async function boot(page, settings = {}) {
  await installFolio(page);
  await page.addInitScript((settings) => {
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          {
            id: "n",
            name: "A.md",
            path: "C:/s/A.md",
            version: "1",
            text: "# A\n\nText.\n",
          },
        ],
        restored: [],
        roots: [],
        settings,
      }),
    });
  }, settings);
  await page.goto("/");
  await page.locator("#weight").click();
  await expect(page.locator("#appearance")).toBeVisible();
}

test("shows one settings page at a time, fixed dialog size, aria-current='page', and scrolls to top on switch", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  const dialog = page.locator("#appearance");
  const pane = dialog.locator(".settings-pane");
  const nav = dialog.locator(".settings-nav");

  const startBox = await dialog.boundingBox();
  expect(startBox.width).toBeCloseTo(640, 0);
  expect(startBox.height).toBeCloseTo(520, 0);

  // Only Reading typography is visible; inactive fieldsets carry hidden and are out of tab order.
  await expect(pane.locator("> fieldset:not([hidden])")).toHaveCount(1);
  await expect(dialog.locator("#settings-reading")).toBeVisible();
  await expect(dialog.locator("#settings-export")).toHaveAttribute(
    "hidden",
    "",
  );
  await expect(nav.locator('[aria-current="page"]')).toHaveText("阅读排版");
  await expect(
    dialog.locator("#settings-reading .settings-page-desc"),
  ).not.toBeEmpty();
  if (process.env.VITE_TYPO_LAB === "1") {
    await expect(
      dialog.locator("#settings-reading #typo-lab-open"),
    ).toBeVisible();
  }

  const tabbableIds = await page.evaluate(() => {
    const els = [
      ...document.querySelectorAll(
        "#appearance button, #appearance input, #appearance select, #appearance textarea",
      ),
    ];
    return els
      .filter((el) => el.offsetParent !== null && !el.closest("[hidden]"))
      .map((el) => el.id || el.textContent.trim());
  });
  expect(tabbableIds).not.toContain("export-toc");
  expect(tabbableIds).not.toContain("smooth-scroll");

  // Scroll down on a tall page, then switch to a short page and verify scrollTop resets and box stays 640x520.
  await pane.evaluate((el) => (el.scrollTop = 120));
  await nav.getByRole("button", { name: "导出" }).click();
  await expect(pane.locator("> fieldset:not([hidden])")).toHaveCount(1);
  await expect(dialog.locator("#settings-export")).toBeVisible();
  await expect(dialog.locator("#settings-reading")).toHaveAttribute(
    "hidden",
    "",
  );
  await expect(nav.locator('[aria-current="page"]')).toHaveText("导出");
  expect(await pane.evaluate((el) => el.scrollTop)).toBe(0);

  const shortBox = await dialog.boundingBox();
  expect(Math.abs(shortBox.width - startBox.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(shortBox.height - startBox.height)).toBeLessThanOrEqual(1);
});

test("supports keyboard navigation (ArrowUp/Down, Enter/Space, Ctrl+PageUp/Down) and Esc close", async ({
  page,
}) => {
  await boot(page);
  const dialog = page.locator("#appearance");
  const nav = dialog.locator(".settings-nav");

  // Up/Down move focus across visible nav buttons; Enter / Space open that page.
  const firstNav = nav.locator("button:not([hidden])").first();
  await firstNav.focus();
  await page.keyboard.press("ArrowDown");
  await expect(nav.locator("button:not([hidden])").nth(1)).toBeFocused();
  // Moving focus alone does not switch the open page until Enter/Space.
  await expect(dialog.locator("#settings-reading")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(dialog.locator("#settings-theme")).toBeVisible();
  await expect(nav.locator('[aria-current="page"]')).toHaveText("主题与语言");

  await page.keyboard.press("ArrowDown");
  await expect(nav.locator("button:not([hidden])").nth(2)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(dialog.locator("#settings-tables")).toBeVisible();

  await page.keyboard.press("ArrowUp");
  await expect(nav.locator("button:not([hidden])").nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.locator("#settings-theme")).toBeVisible();

  // Ctrl+PageDown / PageUp work even when focus is on a control inside the pane.
  await dialog.locator("#color-theme").focus();
  await expect(dialog.locator("#color-theme")).toBeFocused();
  await page.keyboard.press("Control+PageDown");
  await expect(dialog.locator("#settings-tables")).toBeVisible();
  await expect(nav.locator('[aria-current="page"]')).toHaveText("表格");

  await page.keyboard.press("Control+PageUp");
  await expect(dialog.locator("#settings-theme")).toBeVisible();
  await expect(nav.locator('[aria-current="page"]')).toHaveText("主题与语言");

  // Esc closes whether focus is in pane control or search input.
  await dialog.locator("#settings-search").focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("remembers the last opened settings page across close and reload", async ({
  page,
}) => {
  await boot(page);
  const dialog = page.locator("#appearance");
  await dialog
    .locator('.settings-nav button[data-section="settings-editing"]')
    .click();
  await expect(dialog.locator("#settings-editing")).toBeVisible();

  await dialog.locator("#appearance-close").click();
  await expect(dialog).toBeHidden();

  await page.locator("#weight").click();
  await expect(dialog.locator("#settings-editing")).toBeVisible();
  await expect(
    dialog.locator('.settings-nav [aria-current="page"]'),
  ).toHaveText("编辑");

  await page.reload();
  await page.locator("#weight").click();
  await expect(dialog.locator("#settings-editing")).toBeVisible();
  await expect(
    dialog.locator('.settings-nav [aria-current="page"]'),
  ).toHaveText("编辑");
});

test("cross-page search groups matches by page, restores previous page on clear, and opens + highlights clicked row", async ({
  page,
}) => {
  await boot(page);
  const dialog = page.locator("#appearance");
  const search = dialog.locator("#settings-search");
  const results = dialog.locator("#settings-search-results");

  await expect(search).toHaveAttribute("placeholder", "搜索设置");
  // Start on 导出 so we verify clearing search returns to 导出.
  await dialog
    .locator('.settings-nav button[data-section="settings-export"]')
    .click();
  await expect(dialog.locator("#settings-export")).toBeVisible();

  // Case-insensitive match against note text on 阅读排版 (CommonMark).
  await search.fill("commonmark");
  await expect(results).toBeVisible();
  await expect(dialog.locator("#settings-export")).toBeHidden();
  await expect(results.locator(".settings-search-group-title")).toHaveText([
    "阅读排版",
  ]);
  await expect(results.locator(".settings-search-item")).toContainText(
    "中文旁的粗体与斜体",
  );
  expect(
    await dialog
      .locator(".settings-pane")
      .evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(0);

  // Clearing returns to the page that was open (导出).
  await search.fill("");
  await expect(results).toBeHidden();
  await expect(dialog.locator("#settings-export")).toBeVisible();
  await expect(
    dialog.locator('.settings-nav [aria-current="page"]'),
  ).toHaveText("导出");

  // Search Chinese substring across another page and click result.
  await search.fill("平滑");
  await expect(results.locator(".settings-search-group-title")).toHaveText([
    "导航与滚动",
  ]);
  await results.locator(".settings-search-item").first().click();

  await expect(results).toBeHidden();
  await expect(search).toHaveValue("");
  await expect(dialog.locator("#settings-navigation")).toBeVisible();
  await expect(
    dialog.locator('.settings-nav [aria-current="page"]'),
  ).toHaveText("导航与滚动");
  await expect(
    dialog.locator("#settings-navigation .setting.setting-highlight"),
  ).toContainText("平滑滚动");
});

test.describe("English settings pages", () => {
  test.use({ locale: "en-US" });

  test("translated settings pages and search work cleanly in English", async ({
    page,
  }) => {
    await boot(page, { language: "en" });
    const dialog = page.locator("#appearance");
    await expect(dialog.locator("#settings-search")).toHaveAttribute(
      "placeholder",
      "Search settings",
    );
    await expect(
      dialog.locator('.settings-nav [aria-current="page"]'),
    ).toHaveText("Reading typography");
    // No Chinese characters should leak in visible nav items or open page copy.
    const navText = await dialog.locator(".settings-nav").innerText();
    expect(navText).not.toMatch(/[\u3400-\u9fff]/);
    const pageText = await dialog.locator("#settings-reading").innerText();
    expect(pageText).not.toMatch(/[\u3400-\u9fff]/);
    await dialog.locator("#settings-search").fill("scroll");
    await expect(
      dialog.locator("#settings-search-results .settings-search-group-title"),
    ).toHaveText(["Navigation & scrolling"]);
    await dialog.locator("#settings-search").fill("");
    await expect(dialog.locator("#settings-reading")).toBeVisible();
  });
});
