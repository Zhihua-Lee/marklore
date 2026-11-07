import { test, expect } from "@playwright/test";
import { boot, editor, saved, caretAfter, selectText } from "./rich-helpers.js";

// One toolbar over the top of the panes, for both editors: in Edit mode it
// acts on the note as drawn. It floats: the note does not move between
// Read and Edit.

const button = (page, name) =>
  page.locator(".editing-tools").getByRole("button", { name, exact: true });

test("the note stays in place between Read and Edit", async ({ page }) => {
  await boot(page, "First line.\n\nSecond line.\n");
  const editing = await editor(page).locator("p").first().boundingBox();
  await expect(page.locator(".editing-tools")).toBeVisible();
  // The toolbar covers nothing of the note at its top.
  const bar = await page.locator(".editing-tools").boundingBox();
  expect(bar.y + bar.height).toBeLessThan(editing.y);
  await page.keyboard.press("Control+1");
  await expect(page.locator(".editing-tools")).toBeHidden();
  const reading = await page.locator("#content p").first().boundingBox();
  expect(Math.abs(reading.y - editing.y)).toBeLessThan(1);
  expect(Math.abs(reading.x - editing.x)).toBeLessThan(1);
});

test("text styles and paragraph styles from the toolbar", async ({ page }) => {
  await boot(page, "Make this bold.\n\nA heading\n\nan item\n\nquoted\n");
  await selectText(page, "this");
  await button(page, "粗体").click();
  await selectText(page, "Make");
  await button(page, "斜体").click();
  // The selection (and its small toolbar) goes with the caret moved.
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".rich-bubble")).toBeHidden();
  await caretAfter(page, "A heading");
  await page.locator(".editing-tools select").selectOption({ label: "标题 2" });
  await caretAfter(page, "an item");
  await button(page, "无序列表").click();
  await caretAfter(page, "quoted");
  await button(page, "引用").click();
  await expect(editor(page).locator("strong")).toHaveText("this");
  await expect(editor(page).locator("h2")).toHaveText("A heading");
  expect(await saved(page)).toBe(
    "*Make* **this** bold.\n\n## A heading\n\n- an item\n\n> quoted\n",
  );
});

test("lists switch kind and task boxes come and go", async ({ page }) => {
  await boot(page, "- one\n- two\n");
  await selectText(page, "one\ntwo".split("\n")[0]);
  await caretAfter(page, "one");
  await button(page, "有序列表").click();
  expect(await saved(page)).toBe("1. one\n2. two\n");
  await button(page, "任务列表").click();
  await expect(editor(page).locator("input[type=checkbox]")).toHaveCount(1);
  expect(await saved(page)).toBe("1. [ ] one\n2. two\n");
  await button(page, "任务列表").click();
  expect(await saved(page)).toBe("1. one\n2. two\n");
});

test("highlight and text color from the toolbar", async ({ page }) => {
  await boot(page, "Paint this and that.\n");
  await selectText(page, "this");
  await button(page, "文字高亮").click();
  await expect(editor(page).locator("mark")).toHaveText("this");
  await selectText(page, "that");
  await button(page, "文字颜色").click();
  await expect(editor(page).locator("span.rich-html")).toHaveText("that");
  const text = await saved(page);
  expect(text).toMatch(
    /^Paint <mark style="background-color: #[\da-f]{6}; color: #[\da-f]{6}">this<\/mark> and <span style="color: #[\da-f]{6}">that<\/span>\.\n$/,
  );
});

test("a table, a code block and a link from the toolbar's forms", async ({
  page,
}) => {
  await boot(page, "Start\n\nEnd\n");
  await caretAfter(page, "Start");
  await button(page, "插入表格").click();
  const dialog = page.locator("#edit-insert");
  await dialog.getByLabel("列数").fill("2");
  await dialog.getByLabel("正文行数").fill("1");
  await dialog.getByRole("button", { name: "插入" }).click();
  await expect(editor(page).locator("table tr")).toHaveCount(2);
  await caretAfter(page, "End");
  await button(page, "代码块").click();
  await dialog.getByLabel("语言").fill("python");
  await dialog.getByRole("button", { name: "插入" }).click();
  await expect(editor(page).locator("pre")).toHaveCount(1);
  await page.keyboard.type("x = 1");
  // No selection: the link form, its text linked at the caret.
  await caretAfter(page, "Start");
  await button(page, "插入链接").click();
  await dialog.getByLabel("显示文字").fill("Docs");
  await dialog.getByLabel("链接或文件路径").fill("https://example.com");
  await dialog.getByRole("button", { name: "插入" }).click();
  await expect(editor(page).locator("a")).toHaveText("Docs");
  const text = await saved(page);
  expect(text).toContain("Start[Docs](https://example.com)");
  expect(text).toMatch(/\|[^|\n]+\|[^|\n]+\|\n\| *-+ *\| *-+ *\|/);
  expect(text).toContain("```python\nx = 1\n```");
});

test("formulas from the toolbar open for typing", async ({ page }) => {
  await boot(page, "Start\n");
  await caretAfter(page, "Start");
  await button(page, "行内公式").click();
  await page.keyboard.type("a^2");
  await page.keyboard.press("End");
  await expect(editor(page).locator(".formula .katex")).toBeVisible();
  await button(page, "公式块").click();
  await page.keyboard.type("b^2");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("ArrowDown");
  await expect(editor(page).locator(".math-block .katex")).toBeVisible();
  const text = await saved(page);
  expect(text).toContain("$a^2$");
  expect(text).toContain("$$\nb^2\n$$");
});

test("with the source pane shown, the toolbar acts where typed last", async ({
  page,
}) => {
  await boot(page, "Word here.\n", { editSplit: true });
  await page.locator("#editor .cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+End");
  await button(page, "粗体").click();
  await expect(page.locator("#editor .cm-content")).toContainText(
    "**Word here.**",
  );
  // The editor follows the source pane.
  await expect(editor(page).locator("strong")).toHaveText("Word here.");
  await selectText(page, "Word");
  await button(page, "斜体").click();
  await expect(page.locator("#editor .cm-content")).toContainText(
    "***Word* here.**",
  );
});

test("clicking into another block moves nothing", async ({ page }) => {
  await boot(page, "# Plan\n\nSend it on Friday.\n\nAsk Ana.\n");
  const tops = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#rich .ProseMirror > *")].map((el) =>
        Math.round(el.getBoundingClientRect().top),
      ),
    );
  const before = await tops();
  const p = await editor(page).locator("p").first().boundingBox();
  await page.mouse.move(p.x + 2, p.y + p.height / 2);
  await page.mouse.down();
  // The block the caret left is not drawn smaller or larger for a frame.
  expect(await tops()).toEqual(before);
  await page.mouse.up();
  expect(await tops()).toEqual(before);
});
