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
