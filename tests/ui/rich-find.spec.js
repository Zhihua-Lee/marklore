import { test, expect } from "@playwright/test";
import { boot, editor, saved, caretAfter } from "./rich-helpers.js";

// Find and replace in Edit mode (Ctrl+F): the source pane's bar, over the
// note as drawn. Replacing keeps the formatting at the match and the rest
// of the note as written.
const text =
  "# Cats\n\nThe **cat** sat. A cat and a Cat.\n\n- one cat $x$\n- concatenate\n";

test("finds as you type, counts, steps, and keeps the matches marked", async ({
  page,
}) => {
  await boot(page, text);
  await caretAfter(page, "Cats");
  await page.keyboard.press("Control+f");
  const bar = page.locator("#rich-find");
  await expect(bar.locator(".folio-search")).toBeVisible();
  await bar.getByLabel("查找", { exact: true }).fill("cat");
  // Cats, cat (bold), cat, Cat, cat, concatenate: case-insensitive.
  await expect(bar.locator(".folio-search-count")).toHaveText(/\/6$/);
  await expect(editor(page).locator(".rich-find")).toHaveCount(6);
  await bar.getByLabel("区分大小写").check();
  await expect(bar.locator(".folio-search-count")).toHaveText(/\/4$/);
  await bar.getByLabel("全字匹配").check();
  await expect(bar.locator(".folio-search-count")).toHaveText(/\/3$/);
  await bar.getByLabel("查找", { exact: true }).press("Enter");
  await expect(editor(page).locator(".rich-find-current")).toHaveCount(1);
  await bar.getByLabel("查找", { exact: true }).press("Escape");
  await expect(bar.locator(".folio-search")).toBeHidden();
  await expect(editor(page).locator(".rich-find")).toHaveCount(0);
  expect(await saved(page)).toBe(text);
});

test("replace one and replace all keep formatting and the rest", async ({
  page,
}) => {
  await boot(page, text);
  await caretAfter(page, "Cats");
  await page.keyboard.press("Control+f");
  const bar = page.locator("#rich-find");
  await bar.getByLabel("查找", { exact: true }).fill("cat");
  await bar.getByLabel("区分大小写").check();
  await bar.getByLabel("全字匹配").check();
  await bar.getByRole("button", { name: "显示替换" }).click();
  await bar.getByLabel("替换为").fill("dog");
  // The first match after the caret is the bold one.
  await bar.getByLabel("替换为").press("Enter");
  await expect(editor(page).locator("strong")).toHaveText("dog");
  await bar.getByRole("button", { name: "全部替换" }).click();
  expect(await saved(page)).toBe(
    "# Cats\n\nThe **dog** sat. A dog and a Cat.\n\n- one dog $x$\n- concatenate\n",
  );
});

test("a regular expression with groups", async ({ page }) => {
  await boot(page, "2024-01-05 and 2025-12-31\n");
  await caretAfter(page, "and");
  await page.keyboard.press("Control+f");
  const bar = page.locator("#rich-find");
  await bar.getByLabel("正则表达式").check();
  await bar
    .getByLabel("查找", { exact: true })
    .fill("(\\d{4})-(\\d\\d)-(\\d\\d)");
  await expect(bar.locator(".folio-search-count")).toHaveText(/\/2$/);
  await bar.getByRole("button", { name: "显示替换" }).click();
  await bar.getByLabel("替换为").fill("$3.$2.$1");
  await bar.getByRole("button", { name: "全部替换" }).click();
  expect(await saved(page)).toBe("05.01.2024 and 31.12.2025\n");
});
