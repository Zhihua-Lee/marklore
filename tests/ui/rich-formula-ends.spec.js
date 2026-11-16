import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// In Edit mode, as in Read mode (read-formula-ends.spec.js): a selection
// with an end inside an inline formula takes the whole formula, for the
// format bar and for a mark for the AI; a formula can be selected on its
// own (dragged over, double-clicked, a drag started on it) while a click
// still opens it for editing; and formatting text with part of a bold run
// writes Markdown that reads as what is shown.
const source = [
  "# Formulas",
  "",
  "Alpha text $a+b$ beta words end.",
  "",
  "Only $e=mc^2$ here.",
  "",
  "- List one item",
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
  "核心 $\\mu V = V$ 且 $\\mu \\ge 1$，有界。",
  "",
].join("\n");

async function boot(page) {
  await installFolio(page);
  await page.addInitScript((text) => {
    window.mock = { saved: [] };
    window.folio = folioTest.mock({
      ready: async () => ({
        roots: [],
        restored: [],
        incoming: [
          { id: "n", name: "N.md", path: "C:/t/N.md", text, version: "1" },
        ],
        settings: { sidebar: false, outline: false, richEdit: true },
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
  await page.keyboard.press("Control+2");
  await expect(page.locator("#rich .ProseMirror")).toBeVisible();
  await expect(page.locator("#reader")).toBeHidden();
  await expect(page.locator("#rich .formula .katex").first()).toBeVisible();
}
const editor = (page) => page.locator("#rich .ProseMirror");
const tools = (page) => page.locator(".rich-bubble");

// A point of the editor: the start or end of a phrase (`text`, `at`), or
// the middle or an edge of the i-th formula of the block holding a phrase
// (`formula`, `pos`: "in" | "left" | "right"); in the block holding the
// phrase `block` when given.
async function point(page, spec) {
  return editor(page).evaluate((root, spec) => {
    if (spec.block)
      root = [...root.querySelectorAll("p,li,td,th")].find((b) =>
        b.textContent.includes(spec.block),
      );
    const find = (phrase) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode());) {
        if (node.parentElement.closest(".formula")) continue;
        const at = node.data.indexOf(phrase);
        if (at >= 0) return [node, at];
      }
      throw Error("Missing " + phrase);
    };
    if (spec.text) {
      const [node, at] = find(spec.text);
      const end = spec.at === "end";
      const range = document.createRange();
      const i = end ? at + spec.text.length - 1 : at;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const box = range.getClientRects()[0];
      return {
        x: end ? box.right - 1 : box.left + 1,
        y: box.top + box.height / 2,
      };
    }
    const [node] = find(spec.formula);
    const block = node.parentElement.closest("p,li,td,th");
    const rect = block
      .querySelectorAll(".formula")
      [spec.i || 0].getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    if (spec.pos === "left") return { x: rect.left + 1, y };
    if (spec.pos === "right") return { x: rect.right - 1, y };
    return { x: rect.left + rect.width / 2, y };
  }, spec);
}
async function drag(page, a, b) {
  const p = await point(page, a);
  const q = await point(page, b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 3 });
  await page.mouse.move(q.x, q.y, { steps: 3 });
  await page.mouse.up();
}
// Double-click the first point, Shift+click the second.
async function dblShift(page, a, b) {
  const p = await point(page, a);
  const q = await point(page, b);
  await page.mouse.dblclick(p.x, p.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(q.x, q.y);
  await page.keyboard.up("Shift");
}
// Nothing selected, the caret in the title.
async function reset(page) {
  await editor(page).locator("h1").click();
  await expect(tools(page)).toBeHidden();
}
async function saved(page) {
  const count = await page.evaluate(() => window.mock.saved.length);
  await page.keyboard.press("Control+s");
  await expect
    .poll(() => page.evaluate(() => window.mock.saved.length))
    .toBe(count + 1);
  return page.evaluate(() => window.mock.saved.at(-1));
}
const MARK = '<mark style="background-color: #f2d878; color: #000000">';
async function format(page, name, step) {
  await expect(tools(page), "step " + step).toBeVisible();
  await tools(page).getByRole("button", { name, exact: true }).click();
  const text = await saved(page);
  await page.keyboard.press("Control+z");
  await reset(page);
  return text;
}
// The passage a new mark for the AI would take (Ctrl+Alt+M).
async function quote(page, step) {
  await page.keyboard.press("Control+Alt+m");
  const card = page.locator(".mark-card .mark-quote");
  await expect(card, "step " + step).toBeVisible();
  const text = await card.textContent();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await reset(page);
  return text;
}

test("a drag ending inside an inline formula takes the whole formula", async ({
  page,
}) => {
  await boot(page);
  await reset(page);
  await drag(page, { text: "Alpha" }, { formula: "Alpha" });
  expect(await format(page, "高亮", 1)).toContain(
    `${MARK}Alpha text $a+b$</mark> beta`,
  );
  await drag(page, { text: "Alpha" }, { formula: "Alpha" });
  expect(await quote(page, 2)).toBe("Alpha text $a+b$");
  await drag(page, { text: "Alpha" }, { formula: "Alpha" });
  expect(await format(page, "加粗", 3)).toContain("**Alpha text $a+b$** beta");
  // The \( \) syntax, in a list item.
  await drag(page, { text: "List two" }, { formula: "List two" });
  expect(await format(page, "文字颜色", 4)).toContain(
    '- <span style="color: #b23c36">List two \\(v_2\\)</span> more',
  );
  // In a table cell, a quote, next to CJK text, inside bold.
  await drag(page, { text: "cell" }, { formula: "cell" });
  expect(await quote(page, 5)).toBe("cell one $w$");
  await drag(page, { text: "Quote" }, { formula: "Quote" });
  expect(await quote(page, 6)).toBe("Quote start $q$");
  await drag(page, { text: "核心" }, { formula: "核心", i: 1 });
  expect(await format(page, "加粗", 7)).toContain(
    "**核心 $\\mu V = V$ 且 $\\mu \\ge 1$**，有界。",
  );
  await drag(page, { text: "Some" }, { formula: "Some" });
  expect(await format(page, "高亮", 8)).toContain(
    `${MARK}Some </mark>**${MARK}bold $z$</mark> words** after.`,
  );
  // Starting from the end, back into a formula.
  await drag(page, { text: "words", at: "end" }, { formula: "Alpha" });
  expect(await quote(page, 9)).toBe("$a+b$ beta words");
});

test("formatting text and part of a bold run writes Markdown that reads as shown", async ({
  page,
}) => {
  await boot(page);
  await reset(page);
  const some = [{ text: "Some" }, { text: "bold", at: "end" }];
  await drag(page, ...some);
  expect(await format(page, "高亮", 1)).toContain(
    `${MARK}Some </mark>**${MARK}bold</mark> $z$ words** after.`,
  );
  await drag(page, ...some);
  expect(await format(page, "斜体", 2)).toContain(
    "*Some* ***bold* $z$ words** after.",
  );
  await drag(page, ...some);
  expect(await format(page, "删除线", 3)).toContain(
    "~~Some~~ **~~bold~~ $z$ words** after.",
  );
  // From the bold out into the text after it.
  await drag(
    page,
    { text: "words", block: "Some" },
    { text: "after", at: "end", block: "Some" },
  );
  expect(await format(page, "高亮", 4)).toContain(
    `Some **bold $z$ ${MARK}words</mark>**${MARK} after</mark>.`,
  );
  // Rendered as written: bold and highlight, no stray asterisks.
  await drag(page, ...some);
  await tools(page).getByRole("button", { name: "高亮", exact: true }).click();
  await saved(page);
  await page.keyboard.press("Control+1");
  const para = page.locator("#content p", { hasText: "Some" });
  await expect(para.locator("strong")).toHaveCount(1);
  await expect(para.locator("mark")).toHaveCount(2);
  await expect(para).not.toContainText("*");
});

test("bold over text and part of a bold run extends the bold", async ({
  page,
}) => {
  await boot(page);
  await reset(page);
  await drag(page, { text: "Some" }, { text: "bold", at: "end" });
  expect(await format(page, "加粗", 1)).toContain(
    "**Some bold $z$ words** after.",
  );
  await drag(
    page,
    { text: "words", block: "Some" },
    { text: "after", at: "end", block: "Some" },
  );
  expect(await format(page, "加粗", 2)).toContain(
    "Some **bold $z$ words after**.",
  );
  // Wholly inside the bold, it is taken off.
  await drag(page, { text: "bold" }, { text: "bold", at: "end" });
  expect(await format(page, "加粗", 3)).toContain(
    "Some bold **$z$ words** after.",
  );
});

test("a double click and Shift+click leave the space after the last word out of a highlight", async ({
  page,
}) => {
  await boot(page);
  await reset(page);
  await dblShift(page, { text: "text" }, { text: "beta", at: "end" });
  expect(await format(page, "高亮", 1)).toContain(
    `Alpha ${MARK}text $a+b$ beta</mark> words end.`,
  );
  await dblShift(page, { text: "text" }, { text: "beta", at: "end" });
  expect(await quote(page, 2)).toBe("text $a+b$ beta");
});
