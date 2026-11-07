import { test, expect } from "@playwright/test";
import { boot, editor, saved, caretAfter } from "./rich-helpers.js";

// Front matter reads as a folded line of the note's properties, not as a
// rule and a heading; emphasis beside CJK text follows Settings → Reading.
const text =
  "---\ntitle: 会议记录\nmodified: 2026-11-06\nonenote_id: abc\n---\n\n# 正文\n\n**定义：**其中 x\n";

test("front matter is a folded line of properties", async ({ page }) => {
  await boot(page, text);
  await page.keyboard.press("Control+1");
  const card = page.locator("#content details.front-matter");
  await expect(card).toBeVisible();
  await expect(card.locator("summary")).toHaveText(
    /属性.*会议记录.*2026-11-06/,
  );
  await expect(page.locator("#content hr")).toHaveCount(0);
  await expect(page.locator("#content h2")).toHaveCount(0);
  await expect(card.locator("dl")).toBeHidden();
  await card.locator("summary").click();
  await expect(card.locator("dd").nth(2)).toHaveText("abc");
  // The outline lists the note's own headings only.
  await expect(page.locator("#outline")).not.toContainText("title");
  // In Edit mode: the same line; a click shows its source in place.
  await page.keyboard.press("Control+2");
  const line = editor(page).locator(".front-matter");
  await expect(line).toContainText("会议记录");
  await line.click();
  await expect(editor(page).locator("pre").first()).toContainText(
    "onenote_id: abc",
  );
  await caretAfter(page, "其中 x");
  expect(await saved(page)).toBe(text);
});

test("bold closed after punctuation before Chinese text, per the setting", async ({
  page,
}) => {
  await boot(page, text);
  await page.keyboard.press("Control+1");
  await expect(page.locator("#content strong")).toHaveCount(0);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.locator("#cjk-emphasis").check();
  await page.getByRole("button", { name: "关闭设置" }).click();
  await expect(page.locator("#content strong")).toHaveText("定义：");
  await page.keyboard.press("Control+2");
  await expect(editor(page).locator("strong")).toHaveText("定义：");
  await caretAfter(page, "其中 x");
  await page.keyboard.type("y");
  expect(await saved(page)).toBe(text.replace("其中 x", "其中 xy"));
});
