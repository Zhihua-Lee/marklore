import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Lists that mix plain, numbered and task items: every item's text starts at
// the same place as its siblings', at every depth. A task's box hangs where a
// bullet would be instead of pushing its text right.
const text = [
  "- bullet one\n- [ ] task two\n- [x] task three\n- bullet four",
  "1. first\n2. second\n   - nested bullet\n   - [ ] nested task\n3. third\n   1. nested number",
  "- outer\n  1. inner one\n     - deep bullet\n     - [ ] deep task",
  "",
].join("\n\n");

test("plain, numbered and task items line up in a mixed list", async ({
  page,
}) => {
  await installFolio(page);
  await page.addInitScript(
    ({ text }) => {
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [
            {
              id: "one",
              path: "C:/notes/One.md",
              name: "One.md",
              text,
              version: "v1",
            },
          ],
          roots: [],
          restored: [],
          settings: { sidebar: false, outline: false },
        }),
      });
    },
    { text },
  );
  await page.goto("/");
  await page.locator("#content li").first().waitFor();
  // Where each item's own text starts, and how deep the item is.
  const items = await page.evaluate(() =>
    [...document.querySelectorAll("#content li")].map((li) => {
      const run = li.querySelector(":scope > [data-text-from]");
      const range = document.createRange();
      range.setStart(run.firstChild, run.textContent.search(/\S/));
      range.setEnd(run.firstChild, run.textContent.search(/\S/) + 1);
      let depth = 0;
      for (let at = li.parentElement; at; at = at.parentElement)
        if (at.tagName === "LI") depth++;
      return {
        text: run.textContent.trim(),
        depth,
        x: range.getBoundingClientRect().left,
      };
    }),
  );
  expect(items.length).toBe(14);
  for (const depth of [0, 1, 2]) {
    const level = items.filter((item) => item.depth === depth);
    expect(level.length, `items at depth ${depth}`).toBeGreaterThan(1);
    for (const item of level)
      expect(Math.abs(item.x - level[0].x), item.text).toBeLessThan(1.5);
  }
  // Deeper items still start further right.
  const at = (depth) => items.find((item) => item.depth === depth).x;
  expect(at(1)).toBeGreaterThan(at(0) + 10);
  expect(at(2)).toBeGreaterThan(at(1) + 10);
});
