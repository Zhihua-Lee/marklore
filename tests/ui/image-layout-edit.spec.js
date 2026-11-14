import { test, expect } from "@playwright/test";
import { boot, editor, saved } from "./rich-helpers.js";
import { sage, slate, shot } from "./image-layout-helpers.js";

// Changing an image's layout in Edit mode (src/rich/image-layout.js): each
// action is one change to the note and one step to undo.

const width = (text) => Number(/width="([\d.]+)%"/.exec(text)?.[1]);
// Drag from the middle of `locator` by dx (and dy).
async function drag(page, locator, dx, dy = 0) {
  const at = await locator.boundingBox();
  const x = at.x + at.width / 2;
  const y = at.y + at.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

test("an image's handles change its width; its box aligns it and resets it, each one undo step", async ({
  page,
}) => {
  const text = `Text.\n\n![Pic](${sage})\n\nEnd.\n`;
  await boot(page, text);
  await editor(page).locator('img[alt="Pic"]').click();
  const box = page.locator(".rich-image-box");
  await expect(box).toBeVisible();
  // At its own size: nothing to reset.
  await expect(box.getByRole("button", { name: "原始大小" })).toBeHidden();
  const handle = page.locator('.rich-image-handle[data-side="right"]');
  await expect(handle).toBeVisible();
  await drag(page, handle, -150);
  const resized = await saved(page);
  expect(resized).toMatch(
    /^Text\.\n\n<img src="data:[^"]+" alt="Pic" width="[\d.]+%">\n\nEnd\.\n$/,
  );
  // 600px wide and centred: 150px from one side takes 300px off.
  const column = await editor(page)
    .locator("p.image-line")
    .evaluate((p) => p.clientWidth);
  expect(width(resized)).toBeCloseTo((300 / column) * 100, 0);
  await shot(page, "resize", "#rich .image-line");

  await box.getByRole("button", { name: "靠右" }).click();
  await expect(box.getByRole("button", { name: "靠右" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const right = await saved(page);
  expect(right).toBe(
    resized.replace(/<img [^>]+>/, (tag) => `<p align="right">${tag}</p>`),
  );
  const gap = await editor(page)
    .locator('img[alt="Pic"]')
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return Math.abs(
        Math.round(el.parentElement.getBoundingClientRect().right - r.right),
      );
    });
  expect(gap).toBe(0);
  await shot(page, "align-right", "#rich .image-line");

  await box.getByRole("button", { name: "原始大小" }).click();
  const natural = await saved(page);
  expect(natural).toBe(right.replace(/ width="[\d.]+%"/, ""));
  await box.getByRole("button", { name: "居中" }).click();
  // Neither resized nor aligned: Markdown again.
  expect(await saved(page)).toBe(text);

  // Each step undone on its own.
  for (const before of [natural, right, resized, text]) {
    await page.keyboard.press("Control+z");
    expect(await saved(page)).toBe(before);
  }
});

test("images put beside each other make a row; its divider and taking one out each undo in one step", async ({
  page,
}) => {
  const text = `Intro.\n\n![A](${sage})\n\n![B](${slate})\n\nEnd.\n`;
  await boot(page, text);
  const box = page.locator(".rich-image-box");
  // The first image has no image before it.
  await editor(page).locator('img[alt="A"]').click();
  await expect(box).toBeVisible();
  await expect(box.getByRole("button", { name: "并排到前一块" })).toBeHidden();
  await editor(page).locator('img[alt="B"]').click();
  await box.getByRole("button", { name: "并排到前一块" }).click();
  const row = await saved(page);
  expect(row).toBe(
    `Intro.\n\n<img src="${sage}" alt="A" width="49%"> <img src="${slate}" alt="B" width="49%">\n\nEnd.\n`,
  );
  const tops = () =>
    editor(page)
      .locator(".image-row img:not(.ProseMirror-separator)")
      .evaluateAll((list) =>
        list.map((el) => Math.round(el.getBoundingClientRect().top)),
      );
  const [a, b] = await tops();
  expect(a).toBe(b);
  await shot(page, "row", "#rich .image-row");

  // The divider between them: half way, then dragged right.
  const [ra, rb] = await editor(page)
    .locator(".image-row img:not(.ProseMirror-separator)")
    .evaluateAll((list) =>
      list.map((el) => el.getBoundingClientRect().toJSON()),
    );
  await page.mouse.move((ra.right + rb.left) / 2, ra.top + 40);
  const divider = page.locator(".rich-divider");
  await expect(divider).toBeVisible();
  await drag(page, divider, 68);
  const moved = await saved(page);
  const shares = [...moved.matchAll(/width="([\d.]+)%"/g)].map((m) =>
    Number(m[1]),
  );
  expect(shares[0]).toBeGreaterThan(55);
  expect(shares[0] + shares[1]).toBeCloseTo(98, 5);

  // Taken out: each image alone again, at its own size.
  await editor(page).locator('img[alt="A"]').click();
  await box.getByRole("button", { name: "移出并排" }).click();
  expect(await saved(page)).toBe(
    `Intro.\n\n![B](${slate})\n\n![A](${sage})\n\nEnd.\n`,
  );
  for (const before of [moved, row, text]) {
    await page.keyboard.press("Control+z");
    expect(await saved(page)).toBe(before);
  }
});

test("an image among text has handles but no alignment", async ({ page }) => {
  await boot(page, `Before ![Pic](${slate}) after.\n`);
  await editor(page).locator('img[alt="Pic"]').click();
  const box = page.locator(".rich-image-box");
  await expect(box).toBeVisible();
  await expect(box.getByRole("button", { name: "靠右" })).toBeHidden();
  await expect(page.locator(".rich-image-handle").first()).toBeVisible();
});
