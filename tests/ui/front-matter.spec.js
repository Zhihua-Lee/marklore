import { test, expect } from "@playwright/test";
import { boot, editor, saved, caretAfter } from "./rich-helpers.js";

// Front matter reads as a folded line of the note's properties (its date,
// notebook and section), not as a rule and a heading; unfolded, a row per
// property, changed in place in Edit mode. Emphasis beside CJK text
// follows Settings → Reading.
const text =
  "---\ntitle: 会议记录\nmodified: 2026-11-06 14:32\nnotebook: 数学笔记\nsection: 第一学期\ntags: [a, b]\nonenote_id: abc\n---\n\n# 正文\n\n**定义：**其中 x\n";

test("front matter is a folded line of properties", async ({ page }) => {
  await boot(page, text);
  await page.keyboard.press("Control+1");
  const card = page.locator("#content details.front-matter");
  await expect(card).toBeVisible();
  const line = card.locator("summary").first();
  await expect(line.locator(".fm-when")).toHaveText(
    "2026年11月6日星期五 14:32",
  );
  await expect(line.locator(".fm-place")).toHaveText("数学笔记 › 第一学期");
  await expect(line.locator(".fm-count")).toHaveText("6 项属性");
  await expect(page.locator("#content hr")).toHaveCount(0);
  await expect(page.locator("#content h2")).toHaveCount(0);
  await expect(card.locator(".fm-rows")).toBeHidden();
  await line.click();
  const row = (key) => card.locator(`.fm-row[data-key="${key}"]`);
  await expect(row("title")).toHaveText("标题会议记录");
  await expect(row("modified").locator(".fm-value")).toHaveText(
    "2026年11月6日 14:32",
  );
  await expect(row("tags").locator(".fm-pill")).toHaveText(["a", "b"]);
  // An exporter's id waits under "1 more".
  await expect(row("onenote_id")).toBeHidden();
  await card.locator(".fm-more > summary").click();
  await expect(row("onenote_id").locator(".fm-value")).toHaveText("abc");
  // The outline lists the note's own headings only.
  await expect(page.locator("#outline")).not.toContainText("title");
});

test("properties change in place in Edit mode", async ({ page }) => {
  await boot(page, text);
  await page.keyboard.press("Control+2");
  const card = editor(page).locator("details.front-matter");
  await expect(card.locator(".fm-when")).toHaveText(
    "2026年11月6日星期五 14:32",
  );
  await card.locator("summary").first().click();
  const row = (key) => card.locator(`.fm-row[data-key="${key}"]`);
  // A value: click, type, Enter.
  await row("title").locator(".fm-value").click();
  const field = row("title").locator("input");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("会议记录");
  await field.fill("周会: 第 3 次");
  await field.press("Enter");
  await expect(row("title").locator(".fm-value")).toHaveText("周会: 第 3 次");
  // A list is edited as items separated by commas.
  await row("tags").locator(".fm-value").click();
  await row("tags").locator("input").fill("a, b, 新");
  await row("tags").locator("input").press("Enter");
  // Esc drops a change.
  await row("section").locator(".fm-value").click();
  await row("section").locator("input").fill("x");
  await row("section").locator("input").press("Escape");
  await expect(row("section").locator(".fm-value")).toHaveText("第一学期");
  // Added at the bottom; removed by its ×.
  await card.getByRole("button", { name: "添加属性" }).click();
  await card.locator(".fm-new input").first().fill("author");
  await card.locator(".fm-new input").first().press("Enter");
  await card.locator(".fm-new input").nth(1).fill("李");
  await card.locator(".fm-new input").nth(1).press("Enter");
  await expect(row("author")).toHaveText(/作者\s*李/);
  await card.locator(".fm-more > summary").click();
  await row("onenote_id").hover();
  await row("onenote_id").locator(".fm-delete").click();
  await expect(row("onenote_id")).toHaveCount(0);
  await caretAfter(page, "其中 x");
  expect(await saved(page)).toBe(
    text
      .replace("title: 会议记录", 'title: "周会: 第 3 次"')
      .replace("tags: [a, b]", "tags: [a, b, 新]")
      .replace("onenote_id: abc\n", "author: 李\n"),
  );
  // The whole front matter as source, in place.
  await card.getByRole("button", { name: "编辑源码" }).click();
  await expect(editor(page).locator("pre").first()).toContainText("author: 李");
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
