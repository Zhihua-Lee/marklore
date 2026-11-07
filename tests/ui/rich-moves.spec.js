import { test, expect } from "@playwright/test";
import { boot, editor, saved, caretAfter } from "./rich-helpers.js";

// The caret gets out of every kind of block with the keyboard: past a table,
// a formula, a code block or a diagram at the end of a note or between two
// of them, it stops between the blocks, and typing there starts a paragraph.
const table = "| a | b |\n|---|---|\n| c1 | c2 |\n";
const table2 = "| x | y |\n|---|---|\n| d1 | d2 |\n";

test("Down past a table at the end of the note, then typing", async ({
  page,
}) => {
  await boot(page, "Intro\n\n" + table);
  await caretAfter(page, "c2");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("after");
  expect(await saved(page)).toBe("Intro\n\n" + table + "\nafter\n");
});

test("Down between two tables", async ({ page }) => {
  await boot(page, "Intro\n\n" + table + "\n" + table2);
  await caretAfter(page, "c2");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("mid");
  expect(await saved(page)).toBe("Intro\n\n" + table + "\nmid\n\n" + table2);
});

test("Up before a table at the start of the note", async ({ page }) => {
  await boot(page, table + "\nOutro\n");
  await caretAfter(page, "a");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("top");
  expect(await saved(page)).toBe("top\n\n" + table + "\nOutro\n");
});

test("Ctrl+End reaches the end of a note that ends with a table", async ({
  page,
}) => {
  await boot(page, "Intro\n\n" + table);
  await caretAfter(page, "Intro");
  await page.keyboard.press("Control+End");
  await page.keyboard.type("end");
  expect(await saved(page)).toBe("Intro\n\n" + table + "\nend\n");
});

test("Down past a display formula at the end of the note", async ({ page }) => {
  await boot(page, "Intro\n\n$$\nx^2\n$$\n");
  await expect(editor(page).locator(".math-block .katex")).toBeVisible();
  await caretAfter(page, "Intro");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("after");
  expect(await saved(page)).toBe("Intro\n\n$$\nx^2\n$$\n\nafter\n");
});

test("Down out of an open formula's source at the end of the note", async ({
  page,
}) => {
  await boot(page, "Intro\n\n$$\nx^2\n$$\n");
  await editor(page).locator(".math-block .katex").click();
  await expect(editor(page).locator("pre")).toContainText("x^2");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.type("after");
  await expect(editor(page).locator(".math-block .katex")).toBeVisible();
  expect(await saved(page)).toBe("Intro\n\n$$\nx^2\n$$\n\nafter\n");
});

test("Down past a code block at the end of the note", async ({ page }) => {
  await boot(page, "Intro\n\n```js\nlet a = 1;\n```\n");
  // (Colored, the code is several runs of text: its end is after ";".)
  await caretAfter(page, ";");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("after");
  expect(await saved(page)).toBe("Intro\n\n```js\nlet a = 1;\n```\n\nafter\n");
});

test("Down past a diagram at the end of the note", async ({ page }) => {
  await boot(page, "Intro\n\n```mermaid\nflowchart LR\n  A --> B\n```\n");
  await caretAfter(page, "Intro");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("after");
  expect(await saved(page)).toBe(
    "Intro\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nafter\n",
  );
});

test("Page Down and Ctrl+Home move the caret through a long note", async ({
  page,
}) => {
  const long =
    Array.from({ length: 80 }, (_, i) => `Line ${i}`).join("\n\n") +
    "\n\n" +
    table;
  await boot(page, long);
  await caretAfter(page, "Line 0");
  for (let i = 0; i < 12; i++) await page.keyboard.press("PageDown");
  await page.keyboard.type("Z");
  const text = await saved(page);
  expect(text).not.toBe(long);
  expect(text.indexOf("Z")).toBeGreaterThan(long.indexOf("Line 40"));
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("A");
  expect((await saved(page)).startsWith("ALine 0")).toBe(true);
});

test("Up and Down in a table go to the cell above or below, then out", async ({
  page,
}) => {
  const t3 = "| a | b |\n|---|---|\n| c1 | c2 |\n| e1 | e2 |\n";
  await boot(page, "Intro\n\n" + t3 + "\nOutro\n");
  await caretAfter(page, "c1");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("!");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("?");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type(" start");
  await caretAfter(page, "e2");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("go ");
  const text = await saved(page);
  expect(text).toMatch(/^Intro start\n\n\| a\? +\| b +\|\n/);
  expect(text).toMatch(/\| e1! +\| e2 +\|\n\ngo Outro\n$/);
});
