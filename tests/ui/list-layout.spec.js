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

// The same list takes the same room in Read and Edit mode, so nothing below
// it moves on switching: loose lists (their items' paragraphs spaced as
// paragraphs), task lists, and lists starting or ending with a code block,
// a formula, a quote or a heading (Edit mode always contains a list, so the
// margins at its edges cannot collapse into the list's own).
const lists = {
  tight: "- one\n- two\n- three",
  loose: "- one\n\n- two\n\n- three",
  orderedLoose: "1. one\n\n2. two\n\n3. three",
  taskTight: "- [ ] one\n- [x] two\n- [ ] three",
  taskLoose: "- [ ] one\n\n- [x] two\n\n- [ ] three",
  nestedLoose: "- one\n\n  - inner a\n  - inner b\n\n- two",
  twoParagraphs: "- [ ] one\n\n  more of one\n\n- [x] two",
  endsCode: "- one\n- two\n\n  ```js\n  let a = 1;\n  ```",
  startsCode: "- ```js\n  let a = 1;\n  ```\n- two",
  endsFormula: "- one\n- two\n\n  $$\n  x^2 + y^2\n  $$",
  startsFormula: "- $$\n  x^2\n  $$\n- two\n- three",
  nestedEndsCode: "- one\n  - two\n\n    ```js\n    let a = 1;\n    ```",
  endsQuote: "- one\n- two\n\n  > quoted",
  startsQuote: "- > quoted\n- two",
  endsHeading: "- one\n- ## two",
};

test("a list is as tall in Edit mode as when read", async ({ page }) => {
  const text =
    "# Lists\n\n" +
    Object.entries(lists)
      .map(([name, list]) => `Before ${name}.\n\n${list}\n\nAfter ${name}.\n\n`)
      .join("");
  await installFolio(page);
  await page.addInitScript((text) => {
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          {
            id: "lists",
            path: "C:/notes/Lists.md",
            name: "Lists.md",
            text,
            version: "v1",
          },
        ],
        roots: [],
        restored: [],
        settings: { sidebar: false, outline: false, richEdit: true },
      }),
    });
  }, text);
  await page.goto("/");
  await page.locator("#content li").first().waitFor();
  // From the end of each "Before" paragraph to the start of its "After",
  // each shown first (formulas are drawn as they come into view).
  const room = async (root) => {
    const out = {};
    for (const name of Object.keys(lists)) {
      await page.evaluate(
        ({ root, name }) =>
          [...document.querySelectorAll(root + " p")]
            .find((p) => p.textContent.trim() === `Before ${name}.`)
            .scrollIntoView({ block: "start" }),
        { root, name },
      );
      await expect
        .poll(() =>
          page.evaluate(
            (root) =>
              document.querySelectorAll(
                root + " [data-folio-math], " + root + " .math-pending",
              ).length,
            root,
          ),
        )
        .toBe(0);
      await page.waitForTimeout(50);
      out[name] = await page.evaluate(
        ({ root, name }) => {
          const ps = [...document.querySelectorAll(root + " p")];
          const top = (label) =>
            ps.find((p) => p.textContent.trim() === `${label} ${name}.`);
          return (
            top("After").getBoundingClientRect().top -
            top("Before").getBoundingClientRect().bottom
          );
        },
        { root, name },
      );
    }
    return out;
  };
  const read = await room("#content");
  await page.keyboard.press("Control+2");
  await expect(page.locator("#rich-reader")).toBeVisible();
  const edit = await room("#rich .ProseMirror");
  for (const name of Object.keys(lists))
    expect(Math.abs(edit[name] - read[name]), name).toBeLessThan(0.5);
});
