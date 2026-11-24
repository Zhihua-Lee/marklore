import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// In Edit mode a display formula is taken whole by a selection, as an
// inline formula is (rich-formula-ends.spec.js) and as Read mode takes it
// (read-formula-ends.spec.js): a drag that ends in it or starts on it, and
// a Shift+click on it, select it whole without opening it; a mark for the
// AI then holds all of it; formatting such a selection formats the text
// around it and leaves the formula as it was. A click still opens it. A
// footnote reference is taken whole the same way.
const source = [
  "# Display",
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
  "Only $e=mc^2$ here.",
  "",
  "A note[^1] and more.",
  "",
  "[^1]: The note.",
  "",
].join("\n");
const DISPLAY = "$$\\int_0^1 f(x)\\,dx$$";
const FOOTNOTE = ".raw-inline[data-kind=footnote]";

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
  await expect(page.locator("#rich .math-block .katex").first()).toBeVisible();
}
const editor = (page) => page.locator("#rich .ProseMirror");
const tools = (page) => page.locator(".rich-bubble");
// A display formula open for editing.
const opened = (page) => editor(page).locator('pre[data-params="$$"]');

// A point of the editor: the start or end of a phrase (`text`, `at`), the
// middle of the display formula after the paragraph holding a phrase
// (`display`), or the middle of the inline piece drawn there (a selector)
// (`inline`).
async function point(page, spec) {
  return editor(page).evaluate((root, spec) => {
    const find = (phrase) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode());) {
        if (node.parentElement.closest(".rich-drawn")) continue;
        const at = node.data.indexOf(phrase);
        if (at >= 0) return [node, at];
      }
      throw Error("Missing " + phrase);
    };
    let el;
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
    if (spec.display) {
      let block = find(spec.display)[0].parentElement.closest("p");
      while (!block.matches(".math-block")) block = block.nextElementSibling;
      el = block.querySelector(".katex-display, .katex") || block;
    } else el = root.querySelector(spec.inline);
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
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
async function click(page, spec, count = 1) {
  const p = await point(page, spec);
  await page.mouse.click(p.x, p.y, { clickCount: count });
}
// Double-click the first point, Shift+click the second.
async function dblShift(page, a, b) {
  await click(page, a, 2);
  const q = await point(page, b);
  await page.keyboard.down("Shift");
  await page.mouse.click(q.x, q.y);
  await page.keyboard.up("Shift");
}
// Nothing selected, the caret in the title (each time at another place,
// so two in a row never make a double click).
let resets = 0;
async function reset(page) {
  const x = 10 + 40 * (resets++ % 4);
  await editor(page)
    .locator("h1")
    .click({ position: { x, y: 10 } });
  await expect(tools(page)).toBeHidden();
  await expect(opened(page)).toHaveCount(0);
  // Removing `.rich-current` re-enables `content-visibility: auto` on visible
  // blocks, leaving Blink one frame of child hit-test lock until painted.
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
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
  await expect(opened(page), "step " + step).toHaveCount(0);
  await tools(page).getByRole("button", { name, exact: true }).click();
  const text = await saved(page);
  await page.keyboard.press("Control+z");
  await reset(page);
  return text;
}
// The passage a new mark for the AI would take (Ctrl+Alt+M).
async function quote(page, step) {
  await expect(opened(page), "step " + step).toHaveCount(0);
  await page.keyboard.press("Control+Alt+m");
  const card = page.locator(".mark-card .mark-quote");
  await expect(card, "step " + step).toBeVisible();
  const text = await card.textContent();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await reset(page);
  return text;
}

test("a drag ending in or starting on a display formula takes it whole", async ({
  page,
}) => {
  await boot(page);
  await reset(page);
  const into = [{ text: "Before" }, { display: "Before display" }];
  await drag(page, ...into);
  expect(await quote(page, 1)).toBe("Before display line.\n\n" + DISPLAY);
  await drag(page, ...into);
  expect(await format(page, "加粗", 2)).toContain(
    `**Before display line.**\n\n${DISPLAY}\n\nAfter display line.`,
  );
  // The \[ \] syntax.
  await drag(page, { text: "Brackets before" }, { display: "Brackets before" });
  expect(await quote(page, 3)).toBe(
    "Brackets before.\n\n\\[\\sum_{k=1}^n k\\]",
  );
  // Started on the formula, on into the text after it.
  const from = [
    { display: "Before display" },
    { text: "After display", at: "end" },
  ];
  await drag(page, ...from);
  expect(await quote(page, 4)).toBe(DISPLAY + "\n\nAfter display");
  await drag(page, ...from);
  expect(await format(page, "高亮", 5)).toContain(
    `${DISPLAY}\n\n${MARK}After display</mark> line.`,
  );
  // Back from the text after it into it.
  await drag(
    page,
    { text: "After display", at: "end" },
    { display: "Before display" },
  );
  expect(await quote(page, 6)).toBe(DISPLAY + "\n\nAfter display");
  // Over it: the text on both sides formatted, the formula as it was.
  await drag(page, { text: "Before" }, { text: "After display", at: "end" });
  expect(await format(page, "斜体", 7)).toContain(
    `*Before display line.*\n\n${DISPLAY}\n\n*After display* line.`,
  );
});

test("a double click and Shift+click on a display formula select it whole, not open", async ({
  page,
}) => {
  await boot(page);
  await reset(page);
  const onto = [{ text: "display line" }, { display: "Before display" }];
  await dblShift(page, ...onto);
  await expect(tools(page)).toBeVisible();
  expect(await quote(page, 1)).toBe("display line.\n\n" + DISPLAY);
  await dblShift(page, ...onto);
  expect(await format(page, "加粗", 2)).toContain(
    `Before **display line.**\n\n${DISPLAY}\n\nAfter`,
  );
  // From a word after it, back over it: the word kept.
  await dblShift(page, { text: "After" }, { display: "Before display" });
  expect(await quote(page, 3)).toBe(DISPLAY + "\n\nAfter");
});

test("a click still opens a display formula for editing", async ({ page }) => {
  await boot(page);
  await reset(page);
  await click(page, { display: "Before display" });
  await expect(opened(page)).toHaveCount(1);
  await expect(opened(page)).toContainText("\\int_0^1 f(x)\\,dx");
  await editor(page)
    .locator("h1")
    .click({ position: { x: 10, y: 10 } });
  await expect(opened(page)).toHaveCount(0);
  expect(await saved(page)).toContain(
    `Before display line.\n\n${DISPLAY}\n\nAfter`,
  );
});

test("Shift+Left from a double-clicked formula runs on leftward, the formula kept", async ({
  page,
}) => {
  await boot(page);
  await reset(page);
  await click(page, { inline: ".formula" }, 2);
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await quote(page, 1)).toBe("y $e=mc^2$");
});

test("a footnote reference is taken whole by a drag and still opens on a click", async ({
  page,
}) => {
  await boot(page);
  await reset(page);
  await drag(page, { text: "A note" }, { inline: FOOTNOTE });
  expect(await quote(page, 1)).toBe("A note[^1]");
  await drag(page, { inline: FOOTNOTE }, { text: "more", at: "end" });
  expect(await quote(page, 2)).toBe("[^1] and more");
  await click(page, { inline: FOOTNOTE });
  await expect(editor(page).locator(".math-src")).toHaveText("[^1]");
});
