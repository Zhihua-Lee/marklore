import { test, expect } from "@playwright/test";
import { boot, editor, saved, caretAfter, compose } from "./rich-helpers.js";

// Typing Markdown (Settings → Editing, on by default): what is typed goes
// into the note as typed, and becomes formatting once it reads as such, as
// in Typora. Off, typed symbols stay literal (escaped in the note).

test("typed **bold**, *italic*, ~~strike~~ and `code` become formatting", async ({
  page,
}) => {
  await boot(page, "Start\n");
  await caretAfter(page, "Start");
  await page.keyboard.type(" **bold** then *it* and ~~gone~~ or `x+1` end");
  await expect(editor(page).locator("strong")).toHaveText("bold");
  await expect(editor(page).locator("em")).toHaveText("it");
  await expect(editor(page).locator("s, del")).toHaveText("gone");
  await expect(editor(page).locator("p code")).toHaveText("x+1");
  // Typing on after a closed mark is plain again.
  await expect(editor(page).locator("p")).toHaveText(
    "Start bold then it and gone or x+1 end",
  );
  expect(await saved(page)).toBe(
    "Start **bold** then *it* and ~~gone~~ or `x+1` end\n",
  );
});

test("symbols that make no formatting stay as typed, without escapes", async ({
  page,
}) => {
  await boot(page, "Start\n");
  await caretAfter(page, "Start");
  await page.keyboard.type(" 2*3 = 6, a_b_c, 50% #tag [x] <3");
  expect(await saved(page)).toBe("Start 2*3 = 6, a_b_c, 50% #tag [x] <3\n");
});

test("a literal \\* already in the note stays literal", async ({ page }) => {
  await boot(page, "Keep \\*this\\* plain.\n");
  await caretAfter(page, "plain.");
  await page.keyboard.type(" And **new**");
  await expect(editor(page).locator("em")).toHaveCount(0);
  await expect(editor(page).locator("strong")).toHaveText("new");
  expect(await saved(page)).toBe("Keep \\*this\\* plain. And **new**\n");
});

test("formatting typed around Chinese typed with the IME", async ({ page }) => {
  await boot(page, "开头\n");
  await caretAfter(page, "开头");
  await page.keyboard.type("**");
  await compose(page, "重点");
  await page.keyboard.type("**");
  await compose(page, "结尾");
  await expect(editor(page).locator("strong")).toHaveText("重点");
  expect(await saved(page)).toBe("开头**重点**结尾\n");
});

test("typing in a list item and a table cell", async ({ page }) => {
  await boot(page, "- one\n- two\n\n| a | b |\n|---|---|\n| c | d |\n");
  await caretAfter(page, "two");
  await page.keyboard.type(" **b**");
  await expect(editor(page).locator("li strong")).toHaveText("b");
  await caretAfter(page, "d");
  await page.keyboard.type(" *e*");
  await expect(editor(page).locator("td em")).toHaveText("e");
  expect(await saved(page)).toBe(
    "- one\n- two **b**\n\n| a | b |\n|---|---|\n| c | d *e* |\n",
  );
});

test("pasted Markdown text is read as Markdown", async ({ page }) => {
  await boot(page, "Start\n");
  await caretAfter(page, "Start");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", " **p** and `c`");
    document
      .querySelector("#rich .ProseMirror")
      .dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
      );
  });
  await expect(editor(page).locator("strong")).toHaveText("p");
  await expect(editor(page).locator("p code")).toHaveText("c");
  expect(await saved(page)).toBe("Start **p** and `c`\n");
});

test("with the setting off, typed symbols stay literal", async ({ page }) => {
  await boot(page, "Start\n", { typeMarkdown: false });
  await caretAfter(page, "Start");
  await page.keyboard.type(" **x**");
  await expect(editor(page).locator("strong")).toHaveCount(0);
  expect(await saved(page)).toBe("Start \\*\\*x\\*\\*\n");
});

test("formulas wait while the input method composes", async ({ page }) => {
  test.setTimeout(60000);
  // Enough formulas that typesetting them all takes a while.
  const formulas = Array.from(
    { length: 600 },
    (_, i) => `$\\frac{a_{${i}}}{b} + \\sqrt{c_{${i}}}$`,
  ).join(" ");
  await boot(page, "开头\n\n" + formulas + "\n");
  const total = 600;
  const count = () => page.locator("#rich .katex").count();
  await caretAfter(page, "开头");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "zhong",
    selectionStart: 5,
    selectionEnd: 5,
  });
  const before = await count();
  expect(before).toBeLessThan(total);
  // Idle time passes mid-composition: the page around it is left alone.
  await page.waitForTimeout(800);
  expect(await count()).toBe(before);
  await cdp.send("Input.insertText", { text: "中" });
  await expect.poll(count, { timeout: 30000 }).toBe(total);
  expect((await saved(page)).startsWith("开头中\n")).toBe(true);
});

test("## and more: a heading's level is typed in full before the space", async ({
  page,
}) => {
  await boot(page, "Start\n");
  await caretAfter(page, "Start");
  await page.keyboard.press("Enter");
  await page.keyboard.type("### Third");
  await expect(editor(page).locator("h3")).toHaveText("Third");
  await page.keyboard.press("Enter");
  // Alone, the symbols stay text: no heading, list or quote yet.
  await page.keyboard.type("#x -y >z");
  await expect(editor(page).locator("h1, ul, blockquote")).toHaveCount(0);
  expect(await saved(page)).toBe("Start\n\n### Third\n\n#x -y >z\n");
});

test("x typed between two $ makes a formula, open until the caret leaves", async ({
  page,
}) => {
  await boot(page, "Start\n");
  await caretAfter(page, "Start");
  await page.keyboard.type(" $$");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("x");
  // Its source shows while the caret is in it; typing goes on in it.
  await expect(editor(page).locator(".math-src")).toHaveText("$x$");
  await page.keyboard.type("^2");
  await expect(editor(page).locator(".math-src")).toHaveText("$x^2$");
  await page.keyboard.press("End");
  await expect(editor(page).locator(".formula .katex")).toBeVisible();
  expect(await saved(page)).toBe("Start $x^2$\n");
});

test("Enter after ```, $$ or --- makes a code block, a formula or a rule", async ({
  page,
}) => {
  await boot(page, "Start\n");
  await caretAfter(page, "Start");
  await page.keyboard.press("Enter");
  await page.keyboard.type("```js");
  await page.keyboard.press("Enter");
  await page.keyboard.type("let a;");
  await expect(editor(page).locator("pre")).toHaveText("let a;");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("---");
  await page.keyboard.press("Enter");
  await expect(editor(page).locator("hr")).toHaveCount(1);
  await page.keyboard.type("$$");
  await page.keyboard.press("Enter");
  await page.keyboard.type("y");
  await page.keyboard.press("Control+Home");
  await expect(editor(page).locator(".math-block .katex")).toBeVisible();
  expect(await saved(page)).toBe(
    "Start\n\n```js\nlet a;\n```\n\n---\n\n$$\ny\n$$\n",
  );
});

test("Left and Right step out of inline code and back in", async ({ page }) => {
  await boot(page, "Use `code`\n");
  await caretAfter(page, "code");
  // At the end of the code, typing goes into it: its ring shows.
  await expect(editor(page).locator(".rich-code-in")).toHaveCount(1);
  await page.keyboard.press("ArrowRight");
  await expect(editor(page).locator(".rich-code-in")).toHaveCount(0);
  await page.keyboard.type("!");
  expect(await saved(page)).toBe("Use `code`!\n");
  await page.keyboard.press("ArrowLeft");
  // Arrived from outside: still outside; one more step goes in.
  await expect(editor(page).locator(".rich-code-in")).toHaveCount(0);
  await page.keyboard.press("ArrowLeft");
  await expect(editor(page).locator(".rich-code-in")).toHaveCount(1);
  await page.keyboard.type("s");
  expect(await saved(page)).toBe("Use `codes`!\n");
});

test("a line starting with inline code: Left steps out before it", async ({
  page,
}) => {
  await boot(page, "`a` b\n");
  await caretAfter(page, " b");
  await page.keyboard.press("Home");
  await expect(editor(page).locator(".rich-code-in")).toHaveCount(1);
  await page.keyboard.press("ArrowLeft");
  await expect(editor(page).locator(".rich-code-in")).toHaveCount(0);
  await page.keyboard.type("x");
  expect(await saved(page)).toBe("x`a` b\n");
});

test("Markdown typed through the input method becomes formatting", async ({
  page,
}) => {
  await boot(page, "Start\n");
  await caretAfter(page, "Start");
  // In Chinese mode, symbols come composed too, one by one.
  for (const piece of ["*", "*", "粗体", "*", "*"]) await compose(page, piece);
  await expect(editor(page).locator("strong")).toHaveText("粗体");
  expect(await saved(page)).toBe("Start**粗体**\n");
});
