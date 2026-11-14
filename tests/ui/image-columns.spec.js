import { test, expect } from "@playwright/test";
import { boot, editor, saved } from "./rich-helpers.js";
import { sage, slate, shot } from "./image-layout-helpers.js";

// Blocks side by side in Edit mode (src/rich/image-layout.js): an image put
// beside text makes columns (`<div class="columns">`), dragging an image to
// a side of another image or block puts it there, and dragging it out of a
// row or columns makes it stand alone again. One undo step each.

const columns = (left, right, [a, b] = [50, 50]) =>
  `<div class="columns">\n<div class="column" data-width="${a}%">\n\n${left}\n\n</div>\n<div class="column" data-width="${b}%">\n\n${right}\n\n</div>\n</div>`;
// The middle of an element, and a point at its left or right side.
async function point(locator, side = null) {
  const r = await locator.boundingBox();
  const x =
    side === "left"
      ? r.x + 8
      : side === "right"
        ? r.x + r.width - 8
        : r.x + r.width / 2;
  return { x, y: r.y + r.height / 2 };
}
async function dragTo(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test("an image beside the text before it: two columns, taken out again", async ({
  page,
}) => {
  const text = `Intro text, long enough to wrap in its column.\n\n![A](${sage})\n\nEnd.\n`;
  await boot(page, text);
  await editor(page).locator('img[alt="A"]').click();
  const box = page.locator(".rich-image-box");
  await box.getByRole("button", { name: "并排到前一块" }).click();
  const made = await saved(page);
  expect(made).toBe(
    columns("Intro text, long enough to wrap in its column.", `![A](${sage})`) +
      "\n\nEnd.\n",
  );
  const side = await editor(page)
    .locator(".columns")
    .evaluate((el) => {
      const [a, b] = [...el.children].map((c) => c.getBoundingClientRect());
      return a.right <= b.left && Math.abs(a.top - b.top) < 2;
    });
  expect(side).toBe(true);
  await shot(page, "columns", "#rich .columns");
  // Out of its column: one column is no columns.
  await editor(page).locator('img[alt="A"]').click();
  await box.getByRole("button", { name: "移出并排" }).click();
  expect(await saved(page)).toBe(text);
  for (const before of [made, text]) {
    await page.keyboard.press("Control+z");
    expect(await saved(page)).toBe(before);
  }
});

test("the divider between columns moves width from one to the other", async ({
  page,
}) => {
  const text = columns("Some text on the left.", `![A](${slate})`) + "\n";
  await boot(page, text);
  await editor(page).getByText("Some text").click();
  const [a, b] = await editor(page)
    .locator(".columns > .column")
    .evaluateAll((list) =>
      list.map((el) => el.getBoundingClientRect().toJSON()),
    );
  await page.mouse.move((a.right + b.left) / 2, a.top + 10);
  const divider = page.locator(".rich-divider");
  await expect(divider).toBeVisible();
  const at = await point(divider);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 60, at.y, { steps: 6 });
  await page.mouse.up();
  const after = await saved(page);
  const shares = [...after.matchAll(/data-width="([\d.]+)%"/g)].map((m) =>
    Number(m[1]),
  );
  expect(shares[0]).toBeGreaterThan(55);
  expect(shares[0] + shares[1]).toBeCloseTo(100, 5);
  await page.keyboard.press("Control+z");
  expect(await saved(page)).toBe(text);
});

test("dragging an image to a side of another makes a row, and out of it again", async ({
  page,
}) => {
  const text = `![A](${sage})\n\n![B](${slate})\n\nEnd.\n`;
  await boot(page, text);
  const a = editor(page).locator('img[alt="A"]');
  const b = editor(page).locator('img[alt="B"]');
  await b.click();
  await dragTo(page, await point(b), await point(a, "right"));
  const row = await saved(page);
  expect(row).toBe(
    `<img src="${sage}" alt="A" width="49%"> <img src="${slate}" alt="B" width="49%">\n\nEnd.\n`,
  );
  // Out again, below the last line.
  await editor(page).locator('img[alt="B"]').click();
  const end = await editor(page)
    .locator("p", { hasText: "End." })
    .boundingBox();
  await dragTo(page, await point(editor(page).locator('img[alt="B"]')), {
    x: end.x + end.width / 2,
    y: end.y + end.height - 2,
  });
  expect(await saved(page)).toBe(`![A](${sage})\n\nEnd.\n\n![B](${slate})\n`);
  for (const before of [row, text]) {
    await page.keyboard.press("Control+z");
    expect(await saved(page)).toBe(before);
  }
});

test("dragging an image to a side of text makes columns", async ({ page }) => {
  const text = `A paragraph of text.\n\n![A](${sage})\n`;
  await boot(page, text);
  const img = editor(page).locator('img[alt="A"]');
  await img.click();
  await dragTo(
    page,
    await point(img),
    await point(editor(page).getByText("A paragraph"), "left"),
  );
  expect(await saved(page)).toBe(
    columns(`![A](${sage})`, "A paragraph of text.") + "\n",
  );
});
