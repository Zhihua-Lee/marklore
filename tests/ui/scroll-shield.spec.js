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

  // A real wheel raises it. It lowers 150 ms after scrolling stops, which a
  // loaded machine can pass before polling, so record the raise itself.
  await page.evaluate(() => {
    window.raised = null;
    new MutationObserver(() => {
      const shield = document.querySelector("#reader > .scroll-shield");
      if (shield.classList.contains("raised") && !window.raised) {
        const r = document.querySelector("#reader").getBoundingClientRect();
        window.raised = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        )?.className;
      }
    }).observe(document.querySelector("#reader > .scroll-shield"), {
      attributes: true,
    });
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  // While raised, what is under the pointer is the shield itself.
  await expect
    .poll(() => page.evaluate(() => window.raised))
    .toBe("scroll-shield raised");
  // Settles shortly after the scroll ends.
  await expect(shield).not.toHaveClass(/raised/, { timeout: 2000 });

  // Scrolling keys raise it; moving the pointer (to hover or click) lowers it
  // at once. Checked synchronously in the page, independent of timing.
  expect(
    await page.evaluate(() => {
      const reader = document.querySelector("#reader"),
        shield = reader.querySelector(".scroll-shield");
      reader.dispatchEvent(
        new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }),
      );
      const byKey = shield.classList.contains("raised");
      document.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true }),
      );
      const afterMove = shield.classList.contains("raised");
      reader.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      const byWheel = shield.classList.contains("raised");
      document.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true }),
      );
      return [byKey, afterMove, byWheel, shield.classList.contains("raised")];
    }),
  ).toEqual([true, false, true, false]);
  // It takes no space and is not a scroll anchor.
  expect(
    await shield.evaluate((el) => [
      el.getBoundingClientRect().height,
      getComputedStyle(el).overflowAnchor,
    ]),
  ).toEqual([0, "none"]);
});
