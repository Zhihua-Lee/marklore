import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// A selection that starts or ends inside bold, italic or struck-through text
// and goes on past it, formatted from the format bar in Read mode: only the
// selected text is formatted. The emphasis stays as it was, the new format
// split at its edge, instead of the whole emphasis (and the text in it
// before or after the selection) being formatted too. Bold, italic and
// strike use their Markdown delimiters where those render so, and HTML tags
// where they would not (next to other delimiters, punctuation, CJK text).
const first =
  "**保留幅值与速度耦合的归一化。** 定义 $q_\\mu = w_\\mu/\\mu$、$\\mathcal Q = \\{q_\\mu : \\mu\\in[1,2]\\}$。任取线性空间 $V \\subset H_{xt}$，因 $\\mu V = V$ 且 $\\mu \\ge 1$，有";
const source = [
  "# Note",
  "",
  first,
  "",
  "Plain start then **bold middle words** tail.",
  "",
  "A *one two* and ~~three four~~ end.",
  "",
  "**outer *inner text* more** after it.",
  "",
  "Colour **some strong words** here.",
  "",
  "- item *alpha beta*",
  "- item gamma",
  "",
  "**定义。** 其中 $x$ 为变量，**粗体**结尾。",
  "",
].join("\n");

async function boot(page, text = source, settings = {}) {
  await installFolio(page);
  await page.addInitScript(
    ([text, settings]) => {
      window.mock = { saved: [] };
      window.folio = folioTest.mock({
        ready: async () => ({
          roots: [],
          restored: [],
          incoming: [
            { id: "n", name: "N.md", path: "C:/t/N.md", text, version: "1" },
          ],
          settings: {
            sidebar: false,
            outline: false,
            readingFormat: true,
            ...settings,
          },
        }),
        save: async (_id, text) => {
          window.mock.saved.push(text);
          return { version: String(window.mock.saved.length + 1) };
        },
      });
    },
    [text, settings],
  );
  await page.goto("/");
  await expect(page.locator("#content h1")).toBeVisible();
  await expect(page.locator("#content [data-folio-math]")).toHaveCount(0);
}
const tools = (page) => page.getByRole("toolbar", { name: "选中文字格式" });
// From the start of one phrase to the end of another, as a drag would.
async function select(page, from, to) {
  await page.evaluate(
    ([from, to]) => {
      const content = document.querySelector("#content");
      const find = (word, end) => {
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        for (let node; (node = walker.nextNode());) {
          if (node.parentElement.closest(".formula")) continue;
          const at = node.data.indexOf(word);
          if (at >= 0) return [node, end ? at + word.length : at];
        }
        throw Error("Missing " + word);
      };
      const range = document.createRange();
      range.setStart(...find(from, false));
      range.setEnd(...find(to, true));
      document.querySelector("#reader").focus();
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    },
    [from, to],
  );
  await expect(tools(page)).toBeVisible();
}
// The note's source once saved.
async function saved(page) {
  await page.locator("#reader").focus();
  const count = await page.evaluate(() => window.mock.saved.length);
  await page.keyboard.press("Control+s");
  await expect
    .poll(() => page.evaluate(() => window.mock.saved.length))
    .toBe(count + 1);
  return page.evaluate(() => window.mock.saved.at(-1));
}
// The text of a block's marks (or other elements), formulas left out.
const marked = (block, selector = "mark") =>
  block.evaluate(
    (el, selector) =>
      [...el.querySelectorAll(selector)].map((mark) => {
        const copy = mark.cloneNode(true);
        copy
          .querySelectorAll(".formula")
          .forEach((formula) => formula.remove());
        return copy.textContent;
      }),
    selector,
  );
const MARK = '<mark style="background-color: #f2d878; color: #000000">';

test("a highlight starting inside bold marks only the selection, the bold kept", async ({
  page,
}) => {
  await boot(page);
  const block = page.locator("#content p").first();
  await select(page, "速度", "有");
  await tools(page).getByRole("button", { name: "高亮", exact: true }).click();
  await expect(block.locator("mark")).toHaveCount(2);
  const [inBold, after] = await marked(block);
  expect(inBold).toBe("速度耦合的归一化。");
  expect(after.startsWith(" 定义 ") && after.endsWith("，有")).toBe(true);
  // Every formula after the bold is in the second mark.
  await expect(block.locator("mark .formula")).toHaveCount(5);
  await expect(block.locator("strong")).toHaveText(
    "保留幅值与速度耦合的归一化。",
  );
  expect(await saved(page)).toContain(
    `**保留幅值与${MARK}速度耦合的归一化。</mark>**${MARK} 定义 $q_\\mu`,
  );

  // Again, in another paragraph of the note now rendered again in place:
  // the selection ends inside the bold.
  const second = page.locator("#content p", { hasText: "Plain start" });
  await select(page, "start", "middle");
  await tools(page).getByRole("button", { name: "高亮", exact: true }).click();
  await expect(second.locator("mark")).toHaveCount(2);
  expect(await marked(second)).toEqual(["start then ", "bold middle"]);
  await expect(second.locator("strong")).toHaveText("bold middle words");
  const text = await saved(page);
  expect(text).toContain(
    `Plain ${MARK}start then </mark>**${MARK}bold middle</mark> words** tail.`,
  );
  // The first paragraph is as it was.
  expect(text).toContain(`**保留幅值与${MARK}速度耦合的归一化。</mark>**`);
});

test("ends inside two different emphases, and inside nested ones", async ({
  page,
}) => {
  await boot(page);
  await select(page, "two", "three");
  await tools(page).getByRole("button", { name: "高亮", exact: true }).click();
  const block = page.locator("#content p", { hasText: "A one" });
  await expect(block.locator("mark")).toHaveCount(3);
  expect(await marked(block)).toEqual(["two", " and ", "three"]);
  await expect(block.locator("em")).toHaveText("one two");
  await expect(block.locator("s")).toHaveText("three four");
  expect(await saved(page)).toContain(
    `A *one ${MARK}two</mark>*${MARK} and </mark>~~${MARK}three</mark> four~~ end.`,
  );

  await select(page, "text", "after");
  await tools(page).getByRole("button", { name: "高亮", exact: true }).click();
  const nested = page.locator("#content p", { hasText: "outer" });
  expect(await marked(nested)).toEqual(["text", " more", " after"]);
  await expect(nested.locator("strong")).toHaveText("outer inner text more");
  await expect(nested.locator("em")).toHaveText("inner text");
  expect(await saved(page)).toContain(
    `**outer *inner ${MARK}text</mark>*${MARK} more</mark>**${MARK} after</mark> it.`,
  );
});

test("text colour and several blocks split at the emphasis edge too", async ({
  page,
}) => {
  await boot(page);
  await select(page, "strong", "here");
  await tools(page)
    .getByRole("button", { name: "文字颜色", exact: true })
    .click();
  const block = page.locator("#content p", { hasText: "Colour" });
  expect(await marked(block, "span[style*='color']")).toEqual([
    "strong words",
    " here",
  ]);
  await expect(block.locator("strong")).toHaveText("some strong words");

  // From inside the italic of one list item to the next item.
  await select(page, "beta", "gamma");
  await tools(page).getByRole("button", { name: "高亮", exact: true }).click();
  const items = page.locator("#content li");
  expect(await marked(items.first())).toEqual(["beta"]);
  await expect(items.first().locator("em")).toHaveText("alpha beta");
  expect(await marked(items.nth(1))).toEqual(["item gamma"]);
  expect(await saved(page)).toContain(
    `- item *alpha ${MARK}beta</mark>*\n- ${MARK}item gamma</mark>`,
  );
});

// The same, each without the spaces at its ends: bold, italic and strike
// leave those outside their delimiters.
const words = async (block, selector) =>
  (await marked(block, selector)).map((text) => text.trim());
const press = (page, name) =>
  tools(page).getByRole("button", { name, exact: true }).click();
// What a block shows: no Markdown or HTML syntax left as text.
async function clean(block) {
  const shown = await block.evaluate((el) => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll(".formula").forEach((formula) => formula.remove());
    return copy.textContent;
  });
  expect(shown).not.toMatch(/[*~<>]/);
}

test("italic from inside bold, bold from inside italic, strike from inside bold", async ({
  page,
}) => {
  await boot(page);
  const block = page.locator("#content p").first();
  await select(page, "速度", "有");
  await press(page, "斜体");
  await expect(block.locator("em")).toHaveCount(2);
  const [inBold, after] = await words(block, "em");
  expect(inBold).toBe("速度耦合的归一化。");
  expect(after.startsWith("定义 ") && after.endsWith("，有")).toBe(true);
  await expect(block.locator("strong")).toHaveText(
    "保留幅值与速度耦合的归一化。",
  );
  await expect(block.locator("strong em")).toHaveText("速度耦合的归一化。");
  await expect(block.locator("em .formula")).toHaveCount(5);
  await clean(block);

  // A second format in the note now rendered again: bold from inside the
  // italic, on past it.
  const second = page.locator("#content p", { hasText: "A one" });
  await select(page, "two", "and");
  await press(page, "加粗");
  expect(await words(second, "strong")).toEqual(["two", "and"]);
  await expect(second.locator("em")).toHaveText("one two");
  await clean(second);

  const third = page.locator("#content p", { hasText: "Plain start" });
  await select(page, "middle", "tail");
  await press(page, "删除线");
  expect(await words(third, "s")).toEqual(["middle words", "tail"]);
  await expect(third.locator("strong")).toHaveText("bold middle words");
  await clean(third);
  // In delimiters, which render so here.
  const markdown = await saved(page);
  expect(markdown).toContain(
    "**保留幅值与*速度耦合的归一化。*** *定义 $q_\\mu",
  );
  expect(markdown).toContain(
    "Plain start then **bold ~~middle words~~** ~~tail~~.",
  );
  expect(markdown).toContain("A *one **two*** **and** ~~three four~~ end.");

  // Each earlier change is as it was.
  await expect(block.locator("strong em")).toHaveText("速度耦合的归一化。");
  await expect(second.locator("em")).toHaveText("one two");
  const text = await saved(page);
  expect(text).toContain("- item *alpha beta*\n- item gamma");
  expect(text).toContain("**保留幅值与");
});

test("bold over two emphases, nested emphasis and two list items", async ({
  page,
}) => {
  await boot(page);
  await select(page, "two", "three");
  await press(page, "加粗");
  const block = page.locator("#content p", { hasText: "A one" });
  expect(await words(block, "strong")).toEqual(["two", "and", "three"]);
  await expect(block.locator("em")).toHaveText("one two");
  await expect(block.locator("s")).toHaveText("three four");
  await clean(block);

  await select(page, "text", "after");
  await press(page, "删除线");
  const nested = page.locator("#content p", { hasText: "outer" });
  expect(await words(nested, "s")).toEqual(["text", "more", "after"]);
  await expect(nested.locator("strong")).toHaveText("outer inner text more");
  await expect(nested.locator("em")).toHaveText("inner text");
  await clean(nested);

  await select(page, "beta", "gamma");
  await press(page, "加粗");
  const items = page.locator("#content li");
  expect(await words(items.first(), "strong")).toEqual(["beta"]);
  await expect(items.first().locator("em")).toHaveText("alpha beta");
  expect(await words(items.nth(1), "strong")).toEqual(["item gamma"]);
  await clean(items.first());
  await clean(items.nth(1));
  const markdown = await saved(page);
  expect(markdown).toContain("A *one **two*** **and** ~~**three** four~~ end.");
  expect(markdown).toContain(
    "**outer *inner ~~text~~* ~~more~~** ~~after~~ it.",
  );
  expect(markdown).toContain("- item *alpha **beta***\n- **item gamma**");
});

test("Chinese text and full-width punctuation at the emphasis edge", async ({
  page,
}) => {
  await boot(page);
  const block = page.locator("#content p", { hasText: "其中" });
  await select(page, "义。", "粗");
  await press(page, "斜体");
  expect(await words(block, "em")).toEqual(["义。", "其中  为变量，", "粗"]);
  expect(await words(block, "strong")).toEqual(["定义。", "粗体"]);
  await clean(block);
  // Each piece in delimiters where they render so; the middle one, whose
  // `*` after `。` and before `<` would not open or close, in HTML tags.
  expect(await saved(page)).toContain(
    "**定*义。*** <em>其中 $x$ 为变量，</em>***粗*体**结尾。",
  );

  // Again, to the end of a bold run followed by Chinese text: the run is
  // taken whole, its markers left where they close.
  await select(page, "变量", "体");
  await press(page, "删除线");
  expect(await words(block, "s")).toEqual(["变量，", "粗体"]);
  expect(await words(block, "strong")).toEqual(["定义。", "粗体"]);
  await expect(block.locator("em")).toHaveCount(3);
  await clean(block);

  // Italic again on the text in tags takes it off, tags and all.
  await select(page, "义。", "义。");
  await press(page, "斜体");
  await expect(block.locator("em")).toHaveCount(2);
  expect(await words(block, "strong")).toEqual(["定义。", "粗体"]);
  await clean(block);
  expect(await saved(page)).toContain("**定义。** <em>其中 $x$ 为");
});

test("with bold beside CJK text turned on, the same", async ({ page }) => {
  await boot(page, "# Note\n\n前文**定义：**其中 $x$ 为变量，后文。\n", {
    cjkEmphasis: true,
  });
  const block = page.locator("#content p");
  await expect(block.locator("strong")).toHaveText("定义：");
  await select(page, "义", "变量");
  await press(page, "斜体");
  expect(await words(block, "em")).toEqual(["义：", "其中  为变量"]);
  await expect(block.locator("strong")).toHaveText("定义：");
  await clean(block);
  await select(page, "前文", "定");
  await press(page, "删除线");
  expect(await words(block, "s")).toEqual(["前文", "定"]);
  await expect(block.locator("strong")).toHaveText("定义：");
  await clean(block);
});
