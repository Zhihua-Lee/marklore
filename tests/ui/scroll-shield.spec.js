import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

const note =
  "# Long\n\n" +
  Array.from(
    { length: 30 },
    (_, n) =>
      `## Part ${n}\n\n${"Reading text with $x_${n}^2$ inline. ".repeat(30)}\n\n`,
  ).join("");

// Hover hit tests after each scroll step are expensive on formula-heavy notes;
// the reader answers them with a transparent shield while wheel-scrolling.
test("wheel scrolling raises the hover shield; jumps and a moving pointer do not keep it", async ({
  page,
}) => {
  await installFolio(page);
  await page.addInitScript((text) => {
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          {
            id: "n",
            name: "Long.md",
            path: "C:/s/Long.md",
            version: "1",
            text,
          },
        ],
        restored: [],
        roots: [],
        settings: {},
      }),
    });
  }, note);
  await page.goto("/");
  await expect(page.locator("#content h2").first()).toBeVisible();
  const shield = page.locator("#reader > .scroll-shield");
  const box = await page.locator("#reader").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // A programmatic scroll (outline jump, restore) never raises it.
  await page
    .locator("#outline")
    .getByRole("button", { name: "Part 20", exact: true })
    .click();
  await expect(shield).not.toHaveClass(/raised/);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await expect(shield).toHaveClass(/raised/);
  // What is under the pointer while it is raised is the shield itself.
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.className,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    ),
  ).toBe("scroll-shield raised");
  // Settles shortly after the scroll ends.
  await expect(shield).not.toHaveClass(/raised/, { timeout: 2000 });

  // Moving the pointer (to hover or click) lowers it immediately.
  await page.mouse.wheel(0, 300);
  await expect(shield).toHaveClass(/raised/);
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2);
  await expect(shield).not.toHaveClass(/raised/);
  // It takes no space and is not a scroll anchor.
  expect(
    await shield.evaluate((el) => [
      el.getBoundingClientRect().height,
      getComputedStyle(el).overflowAnchor,
    ]),
  ).toEqual([0, "none"]);
});
