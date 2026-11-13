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

test("images from the toolbar and from the clipboard go to the caret", async ({
  page,
}) => {
  await boot(page, "First.\n\nSecond.\n");
  await caretAfter(page, "First.");
  await button(page, "插入图片").click();
  await expect(
    editor(page).locator("img:not(.ProseMirror-separator)"),
  ).toHaveCount(1);
  await caretAfter(page, "Second.");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(["x"], "shot.png", { type: "image/png" }));
    document
      .querySelector("#rich .ProseMirror")
      .dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
      );
  });
  await expect(
    editor(page).locator("img:not(.ProseMirror-separator)"),
  ).toHaveCount(2);
  const text = await saved(page);
  expect(text.indexOf("assets/pick.png")).toBeGreaterThan(
    text.indexOf("First."),
  );
  expect(text.indexOf("assets/pick.png")).toBeLessThan(text.indexOf("Second."));
  expect(text.indexOf("assets/pasted.png")).toBeGreaterThan(
    text.indexOf("Second."),
  );
});

test("an image dropped on the note goes where it was dropped", async ({
  page,
}) => {
  await boot(page, "First.\n\nSecond.\n\nThird.\n");
  await caretAfter(page, "Third.");
  await page.evaluate(() => {
    const target = [...document.querySelectorAll("#rich p")][1];
    const box = target.getBoundingClientRect();
    const data = new DataTransfer();
    data.items.add(new File(["x"], "shot.png", { type: "image/png" }));
    target.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: data,
        bubbles: true,
        cancelable: true,
        clientX: box.right - 2,
        clientY: box.top + box.height / 2,
      }),
    );
  });
  await expect(
    editor(page).locator("img:not(.ProseMirror-separator)"),
  ).toHaveCount(1);
  const text = await saved(page);
  expect(text.indexOf("assets/pasted.png")).toBeGreaterThan(
    text.indexOf("Second."),
  );
  expect(text.indexOf("assets/pasted.png")).toBeLessThan(
    text.indexOf("Third."),
  );
});

test("a text color stays visible under a highlight added after it", async ({
  page,
}) => {
  await boot(page, "Paint this word.\n");
  await selectText(page, "this");
  await button(page, "文字颜色").click();
  await selectText(page, "this");
  await button(page, "文字高亮").click();
  // The color inside the highlight, so the highlight's ink does not cover it.
  await expect(editor(page).locator("mark span.rich-html")).toHaveText("this");
  expect(await saved(page)).toMatch(
    /^Paint <mark style="[^"]+"><span style="color: #[\da-f]{6}">this<\/span><\/mark> word\.\n$/,
  );
});

test("a formula block from the toolbar: its $$ lines are not typed into", async ({
  page,
}) => {
  await boot(page, "First.\n\nSecond.\n");
  await caretAfter(page, "First.");
  await button(page, "公式块").click();
  const open = editor(page).locator('pre[data-params="$$"]');
  await expect(open).toHaveAttribute("data-lead", "$$");
  await expect(open.locator("code")).toHaveText("");
  await page.keyboard.type("x^2");
  // Up from its first line leaves it (the $$ line is not a place to type):
  // it is drawn; Down picks it, Enter opens it again at its end.
  await page.keyboard.press("ArrowUp");
  await expect(editor(page).locator(".math-block .katex")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("3");
  await expect(open.locator("code")).toHaveText("x^3");
  await caretAfter(page, "Second.");
  await expect(editor(page).locator(".math-block .katex")).toBeVisible();
  expect(await saved(page)).toBe("First.\n\n$$\nx^3\n$$\n\nSecond.\n");
});

test("a highlight inside colored text shows the text's color", async ({
  page,
}) => {
  await boot(
    page,
    'A <span style="color: #c0392b"><mark style="background-color: #f2d878; color: #1f1f1f">word</mark></span>.\n',
  );
  const color = (sel) =>
    page.locator(sel).evaluate((el) => getComputedStyle(el).color);
  const span = await color("#rich span.rich-html");
  expect(await color("#rich mark")).toBe(span);
  await page.keyboard.press("Control+1");
  expect(await color("#content mark")).toBe(
    await color("#content span[style]"),
  );
});

test("the small toolbar's palette opens with a right click and stays open", async ({
  page,
}) => {
  await boot(page, "Mark these words here.\n");
  await selectText(page, "these words");
  const bubble = page.locator(".rich-bubble");
  await expect(bubble).toBeVisible();
  await bubble.getByRole("button", { name: "高亮" }).click({ button: "right" });
  const palette = page.locator(".text-color-picker");
  await expect(palette).toBeVisible();
  // Still there a moment later: the editor losing the focus to it does not
  // close it.
  await page.waitForTimeout(150);
  await expect(palette).toBeVisible();
  await expect(bubble).toBeVisible();
  await palette.locator("[data-color]").nth(2).click();
  await expect(palette).toHaveCount(0);
  expect(await saved(page)).toMatch(
    /^Mark <mark style="background-color: #[\da-f]{6}(; color: #[\da-f]{6})?">these words<\/mark> here\.\n$/i,
  );
});
