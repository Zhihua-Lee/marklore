import { test, expect } from "@playwright/test";
import {
  setup,
  item,
  row,
  saved,
  onenoteIndex,
  onenotePages,
} from "./index-view-setup.js";

// The index view's structure at a glance (src/folder-index-view.css) on a
// OneNote-style notebook of four levels: top-level entries as section
// heads, the second level as the body, deeper levels smaller and quieter,
// equal steps in, one line per entry, counts on folded entries; and
// dragging an entry near the reader's edge scrolls it.
const open = (page, settings = {}) =>
  setup(page, settings, onenoteIndex, { folder: onenotePages });
const looks = (page, title) =>
  item(page, title).evaluate((el) => {
    const row = el.querySelector(":scope > .ix-row");
    const title = row.querySelector(".ix-title");
    const style = getComputedStyle(title);
    return {
      size: parseFloat(style.fontSize),
      weight: Number(style.fontWeight),
      color: style.color,
      left: title.getBoundingClientRect().left,
      arrow: row.firstElementChild.getBoundingClientRect().left,
      top: el.getBoundingClientRect().top,
      height: row.getBoundingClientRect().height,
    };
  });

for (const theme of ["light", "dark"])
  test(`levels read by size, weight, ink and equal steps (${theme})`, async ({
    page,
  }) => {
    await open(page, { theme });
    for (const mode of ["read", "edit"]) {
      if (mode === "edit") {
        await page.keyboard.press("Control+2");
        await expect(page.locator("#content .ix-tools").first()).toBeAttached();
      }
      const part = await looks(page, "第一部分 数学基础");
      const chapter = await looks(page, "1 希尔伯特空间");
      const section = await looks(page, "1.2 完备性");
      const example = await looks(page, "例：L² 空间");
      // Each level smaller (or lighter) than the one above.
      expect(part.size).toBeGreaterThan(chapter.size);
      expect(part.weight).toBeGreaterThan(chapter.weight);
      expect(chapter.weight).toBeGreaterThan(section.weight);
      expect(section.size).toBeGreaterThan(example.size);
      expect(example.color).not.toBe(chapter.color);
      // Every level steps in by the same amount: its arrow under its
      // parent's title.
      expect(Math.abs(chapter.arrow - part.left)).toBeLessThan(1.5);
      expect(Math.abs(section.arrow - chapter.left)).toBeLessThan(1.5);
      expect(Math.abs(example.arrow - section.left)).toBeLessThan(1.5);
      // Rows of a level keep one height; a new part has space above it.
      const next = await looks(page, "1.3 正交基");
      const neighbour = await looks(page, "1.1 内积与范数");
      expect(Math.abs(next.height - neighbour.height)).toBeLessThan(1);
      const last = await looks(page, "3 狄拉克符号");
      const second = await looks(page, "第二部分 波动力学");
      expect(second.top - (last.top + last.height)).toBeGreaterThan(8);
      // The first sentence: muted, smaller, on one line.
      const excerpt = await row(page, "1.1 内积与范数")
        .locator(".ix-excerpt")
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            size: parseFloat(style.fontSize),
            color: style.color,
            wrap: style.whiteSpace,
          };
        });
      expect(excerpt.size).toBeLessThan(neighbour.size);
      expect(excerpt.color).not.toBe(chapter.color);
      expect(excerpt.wrap).toBe("nowrap");
    }
    // A flat list (no levels) keeps body-size titles.
    const flat = await looks(page, "常用公式");
    const chapter = await looks(page, "1 希尔伯特空间");
    expect(flat.size).toBe(chapter.size);
  });

test("a folded entry says how many pages it holds", async ({ page }) => {
  await open(page);
  const part = item(page, "第二部分 波动力学");
  const count = part.locator(":scope > .ix-row > .ix-count");
  await expect(count).toBeHidden();
  await part.locator(":scope > .ix-row > .ix-twisty").click();
  await expect(count).toBeVisible();
  await expect(count).toHaveText("11 页");
  // Unfolded: gone again.
  await part.locator(":scope > .ix-row > .ix-twisty").click();
  await expect(count).toBeHidden();
  // One page under it (its own wording, "1 page" in English).
  const chapter = item(page, "2.2 厄米算符与本征值");
  await chapter.locator(":scope > .ix-row > .ix-twisty").click();
  await expect(chapter.locator(":scope > .ix-row > .ix-count")).toHaveText(
    "1 页",
  );
});

test("dragging an entry near the reader's edge scrolls it to entries off screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page);
  // Every first sentence in (the view is drawn again as they come).
  await expect(row(page, "习题索引").locator(".ix-excerpt")).toBeAttached();
  await expect(row(page, "11 变分法").locator(".ix-excerpt")).toBeAttached();
  await page.keyboard.press("Control+2");
  await expect(page.locator("#content .ix-tools").first()).toBeAttached();
  const reader = page.locator("#reader");
  const scrolled = () => reader.evaluate((el) => el.scrollTop);
  await reader.evaluate((el) => (el.scrollTop = 0));
  const box = await reader.boundingBox();
  const x = box.x + box.width / 2;
  const bottom = Math.round(box.y + box.height - 8),
    top = Math.round(box.y + 6),
    middle = Math.round(box.y + box.height / 2);
  let tremble = 0;
  const dragTo = async (y) => {
    await page.mouse.move(x + (tremble++ % 2), y);
    await page.waitForTimeout(40);
  };
  const start = async (title) => {
    const at = await row(page, title).boundingBox();
    await page.mouse.move(at.x + 60, at.y + at.height / 2);
    await page.mouse.down();
    await page.mouse.move(at.x + 70, at.y + at.height / 2 + 6);
  };
  await start("1.1 内积与范数");
  // Held at the bottom edge: the reader scrolls down.
  for (let i = 0; i < 20 && (await scrolled()) < 200; i++) await dragTo(bottom);
  expect(await scrolled()).toBeGreaterThan(200);
  // In the middle it stops (the test's moves reach the page late), short
  // of the end.
  const settle = async (y) => {
    let still = -1;
    await expect
      .poll(async () => {
        const before = await scrolled();
        await dragTo(y);
        await page.waitForTimeout(200);
        still = await scrolled();
        return still - before;
      })
      .toBe(0);
    return still;
  };
  const end = await reader.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(await settle(middle)).toBeLessThan(end - 100);
  // Down again until the list's last chapter shows, dropped after it.
  const goal = row(page, "11 变分法");
  const shown = async () => {
    const at = await goal.boundingBox();
    return (
      at && at.y > box.y + 60 && at.y + at.height < box.y + box.height - 60
    );
  };
  for (let i = 0; i < 40 && !(await shown()); i++) await dragTo(bottom);
  await settle(middle);
  expect(await shown()).toBe(true);
  const at = await goal.boundingBox();
  const drop = Math.round(at.y + at.height * 0.9);
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(at.x + 60 + (i % 2), drop);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  const text = await saved(page);
  expect(text.indexOf("[1.1 内积与范数]")).toBeGreaterThan(
    text.indexOf("[11 变分法]"),
  );
  // Held at the top edge: back up.
  const before = await scrolled();
  await start("10 微扰论");
  for (let i = 0; i < 20 && (await scrolled()) > before - 150; i++)
    await dragTo(top);
  expect(await scrolled()).toBeLessThan(before - 150);
  // Let go outside the list: nothing changes.
  await page.mouse.move(x, 4);
  await page.mouse.up();
});
