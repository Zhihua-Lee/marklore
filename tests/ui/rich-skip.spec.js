import { test, expect } from "@playwright/test";
import { boot, editor, caretAfter } from "./rich-helpers.js";

// Edit mode lets the browser skip blocks off screen, lists too
// (src/rich/rich.css): a long note scrolls and types without laying out
// what is not seen. Skipping must not change the note's layout: a list has
// the same height skipped or not, with the caret in it or not, and as it has
// when read.
const longNote =
  "# Long\n\n" +
  Array.from(
    { length: 40 },
    (_, n) =>
      `## Section ${n}\n\n${"Reading paragraph text. ".repeat(12)}$a_${n}$.\n\n` +
      `- item $x_${n}$ one\n- item two\n\n` +
      `1. loose item\n\n   with a second paragraph $y_${n}$\n\n2. another\n\n` +
      `- outer\n  - inner one\n  - inner last\n\n` +
      `- [ ] task ${n}\n- [x] done\n\n` +
      `Closing paragraph ${n}.\n\n`,
  ).join("");

// Each top-level block's place with lists skipped as they are, then with no
// list skipped.
function layoutDifference(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector("#rich-reader");
    const blocks = [...document.querySelectorAll("#rich .ProseMirror > *")];
    const tops = () =>
      blocks.map((b) => b.getBoundingClientRect().top + scroller.scrollTop);
    // The note's own height, not the scroller's (a whole number of pixels:
    // a skipped list keeps its height to within a hundredth of a pixel, and
    // over a hundred lists that can round the scroller's up by one).
    const note = document.querySelector("#rich .ProseMirror");
    const before = tops(),
      height = note.getBoundingClientRect().height;
    const style = document.createElement("style");
    style.textContent =
      "#rich .ProseMirror > :is(ul, ol) { content-visibility: visible !important }";
    document.head.append(style);
    const after = tops(),
      full = note.getBoundingClientRect().height;
    style.remove();
    return {
      blocks: Math.max(...before.map((top, i) => Math.abs(top - after[i]))),
      height: Math.abs(height - full),
    };
  });
}
const skippedLists = (page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("#rich .ProseMirror > :is(ul, ol)")].filter(
        (list) => getComputedStyle(list).contentVisibility === "auto",
      ).length,
  );

test("lists off screen are skipped in Edit mode without changing the layout", async ({
  page,
}) => {
  await boot(page, longNote);
  await expect.poll(() => skippedLists(page)).toBeGreaterThan(100);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelectorAll("#rich .math-pending").length,
      ),
    )
    .toBe(0);
  await page.evaluate(() => {
    const s = document.querySelector("#rich-reader");
    s.scrollTop = s.scrollHeight / 2;
  });
  await page.waitForTimeout(300);
  const difference = await layoutDifference(page);
  expect(difference.blocks).toBeLessThan(1);
  expect(difference.height).toBeLessThan(1);
});

test("a list keeps its height when the caret leaves it and when skipped", async ({
  page,
}) => {
  await boot(page, longNote);
  await expect.poll(() => skippedLists(page)).toBeGreaterThan(100);
  // Each kind of list in section 20: its height and the next block's top.
  const measure = () =>
    page.evaluate(() => {
      const lists = [
        ...document.querySelectorAll("#rich .ProseMirror > :is(ul, ol)"),
      ].slice(80, 84);
      return lists.map((list) => ({
        height: list.getBoundingClientRect().height,
        next: list.nextElementSibling.getBoundingClientRect().top,
      }));
    });
  await caretAfter(page, "inner last");
  await expect(
    editor(page).locator("> ul.rich-current", { hasText: "inner last" }),
  ).toHaveCount(1);
  const inside = await measure();
  // Down out of the list, onto the task list and the paragraph after it.
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  await expect(
    editor(page).locator("> ul.rich-current", { hasText: "inner last" }),
  ).toHaveCount(0);
  await page.waitForTimeout(100);
  const outside = await measure();
  for (const [i, list] of inside.entries()) {
    expect(Math.abs(list.height - outside[i].height)).toBeLessThan(0.5);
    expect(Math.abs(list.next - outside[i].next)).toBeLessThan(0.5);
  }
  // Scrolled far away, the lists are skipped and keep their heights.
  await page.evaluate(
    () => (document.querySelector("#rich-reader").scrollTop = 0),
  );
  await page.waitForTimeout(200);
  const away = await measure();
  for (const [i, list] of inside.entries())
    expect(Math.abs(list.height - away[i].height)).toBeLessThan(0.5);
});
