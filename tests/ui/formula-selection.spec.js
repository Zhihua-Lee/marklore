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

// Watches every frame (after its animation-frame callbacks and layout, before
// it is painted: ResizeObserver callbacks run there) and every selection
// change as it is told: a formula the selection takes in paints no selection
// glyph by glyph, and is marked (its flat box) in every frame that shows it.
function watchFrames(page) {
  return page.evaluate(() => {
    const transparent = "rgba(0, 0, 0, 0)";
    const seen = (window.seen = { frames: 0, changes: 0, crossed: 0, bad: [] });
    // An engine whose selection styles do not pass down to children (older
    // Chromium) has the page's selection colour on every element: there the
    // mark alone clears the glyphs, so only frames can be asked of it.
    const inherits = [...document.styleSheets].some((sheet) =>
      [...sheet.cssRules].some(
        (rule) => rule.selectorText === ":root::selection",
      ),
    );
    const check = (when) => {
      const selection = getSelection();
      if (!selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      for (const formula of document.querySelectorAll(
        "#content :is(.formula, .math-block)",
      )) {
        const inner = document.createRange();
        inner.selectNodeContents(formula);
        if (
          range.compareBoundaryPoints(Range.START_TO_END, inner) <= 0 ||
          range.compareBoundaryPoints(Range.END_TO_START, inner) >= 0
        )
          continue;
        seen.crossed++;
        const glyph = formula.querySelector(".katex-html .mord");
        const marked = formula.hasAttribute("data-selected-whole");
        const hidden =
          getComputedStyle(glyph, "::selection").backgroundColor ===
          transparent;
        // As the change is told, before any frame shows it, the glyphs paint
        // no selection; by the frame that shows it, the mark is in too.
        if (when === "frame" ? !marked || !hidden : inherits && !hidden)
          seen.bad.push({ when, formula: formula.className, marked, hidden });
      }
    };
    document.addEventListener("selectionchange", () => {
      seen.changes++;
      check("change");
    });
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:0;top:0;height:1px;width:1px;pointer-events:none";
    document.body.append(probe);
    new ResizeObserver(() => {
      seen.frames++;
      check("frame");
    }).observe(probe);
    let width = 1;
    const tick = () => {
      probe.style.width = (width = 3 - width) + "px";
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const seen = (page) => page.evaluate(() => window.seen);

// Where `phrase` starts in the text (`end`: where it ends), in the page.
const at = (page, phrase, end = false) =>
  page.evaluate(
    ([phrase, end]) => {
      const walker = document.createTreeWalker(
        document.querySelector("#content"),
        NodeFilter.SHOW_TEXT,
      );
      let node;
      while ((node = walker.nextNode()) && !node.data.includes(phrase));
      const range = document.createRange(),
        i = node.data.indexOf(phrase) + (end ? phrase.length : 0);
      range.setStart(node, i);
      range.setEnd(node, i);
      const rect = range.getBoundingClientRect();
      return { x: rect.left, y: rect.top + rect.height / 2 };
    },
    [phrase, end],
  );

test("a formula is shown selected whole from the first frame the selection reaches it", async ({
  page,
}) => {
  await boot(page);
  await watchFrames(page);

  // Dragging across the inline formula, a few pixels a move.
  const from = await at(page, "The energy"),
    to = await at(page, "grows", true);
  await page.mouse.move(from.x + 1, from.y);
  await page.mouse.down();
  for (let x = from.x + 1; x <= to.x; x += 4) {
    await page.mouse.move(x, from.y);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.mouse.up();
  await expect.poll(() => marked(page)).toHaveLength(1);
  // Dragging down onto the display formula.
  const below = await at(page, "Before the display"),
    after = await at(page, "After the display", true);
  await page.mouse.move(below.x + 1, below.y);
  await page.mouse.down();
  for (let y = below.y; y <= after.y; y += 3) {
    await page.mouse.move(after.x, y);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.mouse.up();
  await expect.poll(() => marked(page)).toHaveLength(1);

  // Shift+arrows from the text before the inline formula past it.
  // (Read mode has no caret: the keys extend a selection already made.)
  await select(page, "Plain", "Plain");
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press("Shift+ArrowRight");
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await expect.poll(() => marked(page)).toHaveLength(1);
  // Shift+Down from the line before the display formula.
  await select(page, "Before", "Before");
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Shift+ArrowDown");
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await expect.poll(() => marked(page)).toHaveLength(1);
  // A triple click on the paragraph (a double click on a formula opens
  // its source to edit).
  const energy = await at(page, "energy");
  await page.mouse.click(energy.x + 2, energy.y, { clickCount: 3 });
  await expect.poll(() => marked(page)).toHaveLength(1);
  // Select all.
  await page.keyboard.press("Control+A");
  await expect.poll(() => marked(page)).toHaveLength(3);
  for (let i = 0; i < 3; i++)
    await page.evaluate(() => new Promise(requestAnimationFrame));

  const { frames, changes, crossed, bad } = await seen(page);
  expect(frames).toBeGreaterThan(50);
  expect(changes).toBeGreaterThan(20);
  expect(crossed).toBeGreaterThan(50);
  expect(bad).toEqual([]);
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
