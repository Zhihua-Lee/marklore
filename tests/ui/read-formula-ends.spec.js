import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// In Read mode, a selection with an end in a formula (or right beside one)
// is marked for the AI and formatted as Edit mode does it: an end inside an
// inline formula takes the whole formula, an end inside a display formula
// or a code block stops at the text before (or after) it, and an end left
// at the start of the next block (a paragraph selected by triple click)
// stops at the end of the text selected.
const source = [
  "# Formulas",
  "",
  "Alpha text $a+b$ beta words end.",
  "",
  "Paren gamma \\(c+d\\) delta words.",
  "",
  "Only $e=mc^2$ here.",
  "",
  "Before display line.",
  "",
  "$$\\int_0^1 f(x)\\,dx$$",
  "",
  "After display line.",
  "",
  "Brackets before.",
  "",
  "\\[\\sum_{k=1}^n k\\]",
  "",
  "Brackets after.",
  "",
  "- List one $u_1$ item text",
  "- List two \\(v_2\\) more",
  "",
  "| A | B |",
  "|---|---|",
  "| cell one $w$ tail | other |",
  "",
  "> Quote start $q$ quote end.",
  "",
  "Some **bold $z$ words** after.",
  "",
  "Code before text.",
  "",
  "```js",
  "let x = 1;",
  "```",
  "",
  "Code after text.",
  "",
].join("\n");

async function boot(page) {
  await installFolio(page);
  await page.addInitScript((text) => {
    window.mock = { saved: [], marks: [] };
    window.folio = folioTest.mock({
      ready: async () => ({
        roots: [],
        restored: [],
        incoming: [
          { id: "n", name: "N.md", path: "C:/t/N.md", text, version: "1" },
        ],
        settings: { sidebar: false, outline: false, readingFormat: true },
      }),
      save: async (_id, text) => {
        window.mock.saved.push(text);
        return { version: String(window.mock.saved.length + 1) };
      },
      marks: async () => ({ marks: [], run: null }),
      changeMark: async () => ({ marks: [], run: null }),
    });
  }, source);
  await page.goto("/");
  await expect(page.locator("#content h1")).toBeVisible();
  await expect(page.locator("#content [data-folio-math]")).toHaveCount(0);
}
const tools = (page) => page.getByRole("toolbar", { name: "选中文字格式" });

// A point of the page: the start or end of a phrase of text (`text`, `at`),
// inside the i-th formula of the block holding a phrase (`formula`), inside
// the display formula or code block following a phrase (`after`), or at the
// start of the block holding a phrase (`blockStart`).
async function select(page, start, end) {
  // Nothing selected, and the place in view (scrolling hides the bar), then
  // the selection.
  await page.evaluate(() => getSelection().removeAllRanges());
  await expect(tools(page)).toBeHidden();
  await expect(page.locator(".mark-card")).toHaveCount(0);
  await place(page, start, end, true);
  await page.evaluate(
    () =>
      new Promise((done) => requestAnimationFrame(() => setTimeout(done, 50))),
  );
  await place(page, start, end, false);
}
function place(page, start, end, scroll) {
  return page.evaluate(
    ([start, end, scroll]) => {
      const content = document.querySelector("#content");
      const text = (phrase) => {
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        for (let node; (node = walker.nextNode());) {
          if (node.parentElement.closest(".formula,.math-block,pre")) continue;
          const at = node.data.indexOf(phrase);
          if (at >= 0) return [node, at];
        }
        throw Error("Missing " + phrase);
      };
      // A text node in the middle of the drawn part of an element (its
      // first or last one, at its edge, for `edge`).
      const inside = (el, edge) => {
        const drawn = el.querySelector(".katex-html") || el;
        const walker = document.createTreeWalker(drawn, NodeFilter.SHOW_TEXT);
        const nodes = [];
        for (let node; (node = walker.nextNode());)
          if (node.data.trim()) nodes.push(node);
        if (edge === "first") return [nodes[0], 0];
        if (edge === "last") return [nodes.at(-1), nodes.at(-1).length];
        const node = nodes[Math.floor(nodes.length / 2)];
        return [node, Math.min(1, node.length)];
      };
      const place = (spec) => {
        if (spec.text) {
          const [node, at] = text(spec.text);
          return [node, spec.at === "end" ? at + spec.text.length : at];
        }
        const block = text(
          spec.formula ?? spec.after ?? spec.blockStart,
        )[0].parentElement.closest("p,li,td,blockquote");
        if (spec.blockStart) return [block, 0];
        if (spec.formula)
          return inside(
            block.querySelectorAll(".formula")[spec.i ?? 0],
            spec.edge,
          );
        let next = block.nextElementSibling;
        while (!next.matches(".math-block,.code-block,pre"))
          next = next.nextElementSibling;
        return inside(
          next.matches("pre")
            ? next
            : next.querySelector("pre, .katex") || next,
        );
      };
      const range = document.createRange();
      range.setStart(...place(start));
      range.setEnd(...place(end));
      if (scroll) {
        const at = range.startContainer;
        (at.nodeType === 1 ? at : at.parentElement).scrollIntoView({
          block: "center",
        });
        return;
      }
      document.querySelector("#reader").focus();
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    },
    [start, end, scroll],
  );
}
async function saved(page) {
  await page.locator("#reader").focus();
  const count = await page.evaluate(() => window.mock.saved.length);
  await page.keyboard.press("Control+s");
  await expect
    .poll(() => page.evaluate(() => window.mock.saved.length))
    .toBe(count + 1);
  return page.evaluate(() => window.mock.saved.at(-1));
}
const MARK = '<mark style="background-color: #f2d878; color: #000000">';
async function highlight(page, step) {
  await expect(tools(page), "step " + step).toBeVisible();
  await tools(page).getByRole("button", { name: "高亮", exact: true }).click();
  return saved(page);
}
// The passage a new mark for the AI would take (Ctrl+Alt+M).
async function quote(page, step) {
  await page.keyboard.press("Control+Alt+m");
  const card = page.locator(".mark-card .mark-quote");
  await expect(card, "step " + step).toBeVisible();
  const text = await card.textContent();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  return text;
}

test("a mark for the AI takes a selection with an end in or at a formula", async ({
  page,
}) => {
  await boot(page);
  // Ending inside an inline formula: the whole formula.
  await select(page, { text: "Alpha" }, { formula: "Alpha" });
  expect(await quote(page, 1)).toBe("Alpha text $a+b$");
  // Starting inside one.
  await select(page, { formula: "Alpha" }, { text: "words", at: "end" });
  expect(await quote(page, 2)).toBe("$a+b$ beta words");
  // The \( \) syntax.
  await select(page, { text: "Paren" }, { formula: "Paren" });
  expect(await quote(page, 3)).toBe("Paren gamma \\(c+d\\)");
  // Exactly a formula.
  await select(
    page,
    { formula: "Only", edge: "first" },
    { formula: "Only", edge: "last" },
  );
  expect(await quote(page, 4)).toBe("$e=mc^2$");
  // Starting right after a formula: the formula is not taken.
  await page
    .locator("#content p", { hasText: "Alpha" })
    .locator(".formula")
    .evaluate((formula) => {
      const range = document.createRange();
      range.setStartAfter(formula);
      const after = formula.nextSibling;
      range.setEnd(after.firstChild ?? after, 5);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
  expect(await quote(page, 5)).toBe(" beta");
  // In a list item, a table cell, a quote, inside bold.
  await select(page, { text: "List two" }, { formula: "List two" });
  expect(await quote(page, 6)).toBe("List two \\(v_2\\)");
  await select(page, { text: "cell" }, { formula: "cell" });
  expect(await quote(page, 7)).toBe("cell one $w$");
  await select(
    page,
    { formula: "Quote", edge: "first" },
    { text: "quote end", at: "end" },
  );
  expect(await quote(page, 8)).toBe("$q$ quote end");
  await select(page, { text: "Some" }, { formula: "Some" });
  expect(await quote(page, 9)).toBe("Some **bold $z$");
  // Ending inside a display formula: the whole formula.
  await select(page, { text: "Before" }, { after: "Before display" });
  expect((await quote(page, 10)).trim()).toBe(
    "Before display line.\n\n$$\\int_0^1 f(x)\\,dx$$",
  );
  // A paragraph selected to the start of the next block.
  await select(page, { text: "After" }, { blockStart: "Brackets before" });
  expect(await quote(page, 11)).toBe("After display line.");
});

test("an end inside a display formula or a code block formats the text before it", async ({
  page,
}) => {
  await boot(page);
  // Ending inside $$ … $$: the paragraph before it.
  await select(page, { text: "display" }, { after: "Before display" });
  expect(await highlight(page, 1)).toContain(
    `Before ${MARK}display line.</mark>\n\n$$`,
  );
  // Starting inside \[ … \]: the paragraph after it.
  await select(
    page,
    { after: "Brackets before" },
    { text: "Brackets after", at: "end" },
  );
  expect(await highlight(page, 2)).toContain(
    `\\]\n\n${MARK}Brackets after</mark>.`,
  );
  // Ending inside a code block.
  await select(page, { text: "before text" }, { after: "Code before" });
  expect(await highlight(page, 3)).toContain(
    `Code ${MARK}before text.</mark>\n`,
  );
  // Ending at the start of the next block: no more than what is selected.
  await select(
    page,
    { text: "After display" },
    { blockStart: "Brackets before" },
  );
  expect(await highlight(page, 4)).toContain(
    `${MARK}After display line.</mark>\n\nBrackets`,
  );
});

test("a paragraph selected by triple click before a display formula is highlighted", async ({
  page,
}) => {
  await boot(page);
  const line = page.locator("#content p", { hasText: "Before display" });
  await line.click({ clickCount: 3, position: { x: 30, y: 10 } });
  expect(await highlight(page, 5)).toContain(
    `${MARK}Before display line.</mark>\n\n$$`,
  );
  await line.click({ clickCount: 3, position: { x: 30, y: 10 } });
  expect((await quote(page, 12)).trim()).toBe("Before display line.");
});

test("an end inside a formula inside bold marks only the selection, the bold kept", async ({
  page,
}) => {
  await boot(page);
  await select(page, { text: "Some" }, { formula: "Some" });
  const block = page.locator("#content p", { hasText: "Some" });
  expect(await highlight(page, 6)).toContain(
    `${MARK}Some </mark>**${MARK}bold $z$</mark> words** after.`,
  );
  await expect(block.locator("strong")).toHaveCount(1);
  await expect(block.locator("mark")).toHaveCount(2);
});
