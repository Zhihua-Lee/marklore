import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// A formula is selected whole (src/formula-selection.js): a selection that
// crosses it marks the formula, which shows one flat box in the selection
// colour, and no glyph inside it paints a selection of its own.
const source = [
  "# Formulas",
  "",
  "The energy $E_{k}^{2} = \\frac{1}{2} m v^2$ grows with speed.",
  "",
  "Plain words before $x_1$ and after.",
  "",
  "Before the display formula.",
  "",
  "$$\\int_0^1 \\frac{x^2}{1+x}\\,dx$$",
  "",
  "After the display formula.",
  "",
  "A last paragraph to format.",
].join("\n");

async function boot(page) {
  await installFolio(page);
  await page.addInitScript((text) => {
    window.folio = folioTest.mock({
      ready: async () => ({
        roots: [],
        restored: [],
        incoming: [
          { id: "n", name: "N.md", path: "C:/t/N.md", text, version: "1" },
        ],
        settings: { sidebar: false, outline: false, readingFormat: true },
      }),
      save: async () => ({ version: "2" }),
    });
  }, source);
  await page.goto("/");
  await expect(page.locator("#content .math-block .katex")).toBeVisible();
}

// Selects from the start of `from` to the end of `to` (`to` from its start
// when `before` is set: the selection ends just before it).
function select(page, from, to, { before = false } = {}) {
  return page.evaluate(
    ([from, to, before]) => {
      const find = (phrase) => {
        const walker = document.createTreeWalker(
          document.querySelector("#content"),
          NodeFilter.SHOW_TEXT,
        );
        let node;
        while ((node = walker.nextNode()))
          if (node.data.includes(phrase))
            return [node, node.data.indexOf(phrase)];
        throw Error("not found: " + phrase);
      };
      const [a, i] = find(from),
        [b, j] = find(to);
      const range = document.createRange();
      range.setStart(a, i);
      range.setEnd(b, before ? j : j + to.length);
      document.querySelector("#reader").focus();
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    },
    [from, to, before],
  );
}

const marked = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#content [data-selected-whole]")].map(
      (el) => el.className + ":" + el.textContent.slice(-12),
    ),
  );

// The selection paint of the formula's glyphs, the formula's own background,
// and the selection colour of the text around it.
const paint = (page, selector) =>
  page.locator(selector).evaluate((formula) => {
    const transparent = "rgba(0, 0, 0, 0)";
    const glyphs = [...formula.querySelectorAll(".katex-html *")];
    return {
      glyphs: glyphs.length,
      painted: glyphs.filter(
        (el) =>
          getComputedStyle(el, "::selection").backgroundColor !== transparent,
      ).length,
      box: getComputedStyle(formula).backgroundColor,
      text: getComputedStyle(
        formula.closest("p, .math-block").parentElement,
        "::selection",
      ).backgroundColor,
    };
  });

test("a selection across an inline formula marks the whole formula", async ({
  page,
}) => {
  await boot(page);
  const formula = "#content p:has-text('The energy') .formula";
  // Unmarked: no box (and no rule of its own for the glyphs, which would
  // make restyling a long note costly).
  expect(await paint(page, formula)).toMatchObject({
    box: "rgba(0, 0, 0, 0)",
  });
  await select(page, "energy", "grows");
  await expect(page.locator(formula)).toHaveAttribute("data-selected-whole");
  expect(await marked(page)).toHaveLength(1);
  const shown = await paint(page, formula);
  expect(shown.glyphs).toBeGreaterThan(5);
  expect(shown.painted).toBe(0);
  expect(shown.box).toBe(shown.text);
  expect(shown.box).not.toBe("rgba(0, 0, 0, 0)");

  // Collapsed: no mark.
  await page.evaluate(() => getSelection().collapseToStart());
  await expect.poll(() => marked(page)).toEqual([]);
  // Selected again, then moved to text with no formula: the mark goes.
  await select(page, "energy", "grows");
  await expect.poll(() => marked(page)).toHaveLength(1);
  await select(page, "After the", "formula.");
  await expect.poll(() => marked(page)).toEqual([]);
});

test("a selection ending just before a formula does not mark it", async ({
  page,
}) => {
  await boot(page);
  const formula = page
    .locator("#content p", { hasText: "Plain words" })
    .locator(".formula");
  // At the end of the text right before it.
  await select(page, "Plain", "words before ");
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await marked(page)).toEqual([]);
  // At the boundary before the formula in its paragraph.
  await formula.evaluate((formula) => {
    const range = getSelection().getRangeAt(0);
    range.setEndBefore(formula);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await marked(page)).toEqual([]);
  // Starting just after it.
  await formula.evaluate((formula) => {
    const range = document.createRange();
    range.setStartAfter(formula);
    const block = formula.parentElement;
    range.setEnd(block, block.childNodes.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await marked(page)).toEqual([]);
  // Taking it in: marked.
  await select(page, "Plain", "and after");
  await expect.poll(() => marked(page)).toHaveLength(1);
});

test("a selection across a display formula marks the formula block", async ({
  page,
}) => {
  await boot(page);
  await select(page, "display formula.", "After the");
  await expect(page.locator("#content .math-block")).toHaveAttribute(
    "data-selected-whole",
  );
  expect(await marked(page)).toHaveLength(1);
  const shown = await paint(page, "#content .math-block");
  expect(shown.glyphs).toBeGreaterThan(5);
  expect(shown.painted).toBe(0);
  expect(shown.box).toBe(shown.text);
  // Inside the formula only (a drag within it): still the whole formula.
  await page.evaluate(() => {
    const block = document.querySelector("#content .math-block .katex-html");
    const range = document.createRange();
    range.selectNodeContents(block);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await expect.poll(() => marked(page)).toHaveLength(1);
  await page.evaluate(() => getSelection().removeAllRanges());
  await expect.poll(() => marked(page)).toEqual([]);
});

test("formatting after a formula was selected keeps the other blocks", async ({
  page,
}) => {
  await boot(page);
  // Every block of the note, to see which are put in anew.
  await page.evaluate(() => {
    window.blocks = [...document.querySelectorAll("#content p, .math-block")];
  });
  await select(page, "display formula.", "After the");
  await expect.poll(() => marked(page)).toHaveLength(1);
  const tools = page.getByRole("toolbar", { name: "选中文字格式" });
  await expect(async () => {
    await select(page, "last", "last");
    await expect(tools).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15000 });
  await tools.getByRole("button", { name: "加粗", exact: true }).click();
  await expect(page.locator("#content p strong")).toHaveText("last");
  const kept = await page.evaluate(() =>
    window.blocks.map((block) => block.isConnected),
  );
  // The formatted paragraph alone is new.
  expect(kept.filter((connected) => !connected)).toHaveLength(1);
  expect(kept.at(-1)).toBe(false);
  expect(await marked(page)).toEqual([]);
});
