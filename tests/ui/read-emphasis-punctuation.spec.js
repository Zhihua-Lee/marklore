import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Bold, italic or strike from Read mode's format bar next to punctuation,
// CJK punctuation above all, and next to other emphasis: what is written
// renders as meant (no asterisks shown, nothing else changed). Bold beside
// a bold run joins it, as Edit mode writes it; where the delimiters would
// not open or close, only that piece is written as HTML tags.
const source = [
  "# Emphasis",
  "",
  "中文**加粗**，接着文字。",
  "",
  "前文，接续**粗体**后文。",
  "",
  "甲乙*斜体*，丙丁文字。",
  "",
  "他问「再见」之后离开。",
  "",
  "收尾词语，后面还有。",
  "",
  "Hello, world! Again.",
  "",
  "**Bold**, then more.",
  "",
  "- 列表**加重**，随后。",
  "",
  "| 表格**粗格**，其后 | x |",
  "|---|---|",
  "| y | z |",
  "",
  "> 引用**强调**，继而。",
  "",
  "~~删除~~，然后呢。",
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
}
const tools = (page) => page.getByRole("toolbar", { name: "选中文字格式" });

// Select a phrase of the page's text: in view first (scrolling hides the
// bar), then selected.
async function select(page, phrase) {
  await page.evaluate(() => getSelection().removeAllRanges());
  await expect(tools(page)).toBeHidden();
  for (const scroll of [true, false]) {
    await page.evaluate(
      ([phrase, scroll]) => {
        const walker = document.createTreeWalker(
          document.querySelector("#content"),
          NodeFilter.SHOW_TEXT,
        );
        for (let node; (node = walker.nextNode());) {
          const at = node.data.indexOf(phrase);
          if (at < 0) continue;
          if (scroll)
            return node.parentElement.scrollIntoView({ block: "center" });
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + phrase.length);
          document.querySelector("#reader").focus();
          getSelection().removeAllRanges();
          getSelection().addRange(range);
          return;
        }
        throw Error("Missing " + phrase);
      },
      [phrase, scroll],
    );
    if (scroll)
      await page.evaluate(
        () =>
          new Promise((done) =>
            requestAnimationFrame(() => setTimeout(done, 50)),
          ),
      );
  }
}
// Format the selection, save; the note as saved. Undone after.
async function format(page, name, step) {
  await expect(tools(page), "step " + step).toBeVisible();
  await tools(page).getByRole("button", { name, exact: true }).click();
  await page.locator("#reader").focus();
  const count = await page.evaluate(() => window.mock.saved.length);
  await page.keyboard.press("Control+s");
  await expect
    .poll(() => page.evaluate(() => window.mock.saved.length))
    .toBe(count + 1);
  return page.evaluate(() => window.mock.saved.at(-1));
}
async function undo(page) {
  await page.locator("#reader").focus();
  await page.keyboard.press("Control+z");
}
// The block holding a phrase shows no stray markers.
async function clean(page, phrase) {
  const block = page
    .locator("#content")
    .locator("p, li, td, th", { hasText: phrase })
    .last();
  await expect(block).not.toContainText("*");
  await expect(block).not.toContainText("~");
  return block;
}

test("bold beside a bold run next to CJK punctuation joins it", async ({
  page,
}) => {
  await boot(page);
  await select(page, "，接着");
  expect(await format(page, "加粗", 1)).toContain("中文**加粗，接着**文字。");
  const block = await clean(page, "接着");
  await expect(block.locator("strong")).toHaveText("加粗，接着");
  await undo(page);
  // Italic beside a bold run: its markers would not open there.
  await select(page, "，接着");
  expect(await format(page, "斜体", 2)).toContain(
    "中文**加粗**<em>，接着</em>文字。",
  );
  await clean(page, "接着");
  await undo(page);
  // Italic beside an italic run joins it; bold there is written as tags.
  await select(page, "，丙丁");
  expect(await format(page, "斜体", 3)).toContain("甲乙*斜体，丙丁*文字。");
  await clean(page, "丙丁");
  await undo(page);
  await select(page, "，丙丁");
  expect(await format(page, "加粗", 4)).toContain(
    "甲乙*斜体*<strong>，丙丁</strong>文字。",
  );
  await clean(page, "丙丁");
  await undo(page);
  // Strike beside a struck run joins it.
  await select(page, "，然后");
  expect(await format(page, "删除线", 5)).toContain("~~删除，然后~~呢。");
  await clean(page, "然后");
});

test("emphasis whose markers would not work next to punctuation is written as tags", async ({
  page,
}) => {
  await boot(page);
  // Ending right before a bold run, starting with a comma.
  await select(page, "，接续");
  expect(await format(page, "加粗", 1)).toContain(
    "前文<strong>，接续</strong>**粗体**后文。",
  );
  const block = await clean(page, "接续");
  await expect(block.locator("strong")).toHaveCount(2);
  await undo(page);
  // Ending with a comma before CJK text.
  await select(page, "收尾词语，");
  expect(await format(page, "斜体", 2)).toContain(
    "<em>收尾词语，</em>后面还有。",
  );
  await clean(page, "收尾");
  await undo(page);
  // ASCII punctuation after a letter.
  await select(page, ", world!");
  expect(await format(page, "加粗", 3)).toContain(
    "Hello<strong>, world!</strong> Again.",
  );
  await clean(page, "world");
  await undo(page);
  // Inside 「」 the markers work: they are kept.
  await select(page, "再见");
  expect(await format(page, "加粗", 4)).toContain("他问「**再见**」之后离开。");
  await clean(page, "再见");
});

test("in a list, a table and a quote, bold beside a bold run joins it", async ({
  page,
}) => {
  await boot(page);
  await select(page, "，随后");
  expect(await format(page, "加粗", 1)).toContain("- 列表**加重，随后**。");
  await clean(page, "随后");
  await undo(page);
  await select(page, "，其后");
  expect(await format(page, "加粗", 2)).toContain("| 表格**粗格，其后** | x |");
  await clean(page, "其后");
  await undo(page);
  await select(page, "，继而");
  expect(await format(page, "斜体", 3)).toContain(
    "> 引用**强调**<em>，继而</em>。",
  );
  await clean(page, "继而");
  await undo(page);
  await select(page, ", then");
  expect(await format(page, "加粗", 4)).toContain("**Bold, then** more.");
  await clean(page, "then");
});
