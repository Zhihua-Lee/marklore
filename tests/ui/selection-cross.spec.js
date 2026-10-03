import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Formatting a selection that crosses other formatting or several blocks:
// the result must stay valid Markdown, in one step to undo.
const source = [
  "# Note",
  "",
  "Hello **bold** world. `code` $x^2$ end.",
  "",
  "倍。[Claude Platform](https://example.com/docs?utm_source=x) 如果你其实是在问。",
  "",
  "Second paragraph with *em* text.",
  "",
  "- item one",
  "- item **two** here",
  "",
  "| A | B |",
  "| - | - |",
  "| left | right |",
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
        settings: { sidebar: false, outline: false },
      }),
      save: async (_id, text) => {
        window.mock.saved.push(text);
        return { version: "2" };
      },
    });
  }, source);
  await page.goto("/");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator("#content h1")).toBeVisible();
}
const tools = (page) => page.getByRole("toolbar", { name: "选中文字格式" });
// Select from the start of one phrase to the end of another, as a drag would.
async function select(page, first, last = first) {
  await page.evaluate(
    ([first, last]) => {
      const content = document.querySelector("#content");
      const find = (word, end) => {
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        for (let node; (node = walker.nextNode());) {
          const at = node.textContent.indexOf(word);
          if (at >= 0) return [node, end ? at + word.length : at];
        }
        throw Error("Missing " + word);
      };
      const range = document.createRange();
      range.setStart(...find(first, false));
      range.setEnd(...find(last, true));
      document.querySelector("#reader").focus();
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    },
    [first, last],
  );
  await expect(tools(page)).toBeVisible();
}
const press = (page, name) =>
  tools(page).getByRole("button", { name, exact: true }).click();
const editorText = (page) =>
  page.evaluate(() => document.querySelector("#editor .cm-content").innerText);

test("crossing a link highlights around the whole link", async ({ page }) => {
  await boot(page);
  await select(page, "倍。", "如果你");
  await expect(
    tools(page).getByRole("button", { name: "链接" }),
  ).toBeDisabled();
  await press(page, "高亮");
  await expect
    .poll(() => editorText(page))
    .toMatch(
      /<mark[^>]*>倍。\[Claude Platform\]\(https:\/\/example\.com\/docs\?utm_source=x\) 如果你<\/mark>其实是在问。/,
    );
  await expect(page.locator("#content mark a")).toHaveText("Claude Platform");
});

test("inside a link only its text is formatted; the link stays whole", async ({
  page,
}) => {
  await boot(page);
  await select(page, "Clau", "Plat");
  await press(page, "加粗");
  await expect
    .poll(() => editorText(page))
    .toContain("[**Claude Plat**form](https://example.com/docs?utm_source=x)");
});

test("bold across a bold edge merges instead of nesting; inside bold toggles off", async ({
  page,
}) => {
  await boot(page);
  await select(page, "ld", "wor");
  await press(page, "加粗");
  await expect.poll(() => editorText(page)).toContain("Hello **bold wor**ld.");
  await select(page, "old wo");
  await press(page, "加粗");
  await expect.poll(() => editorText(page)).toContain("Hello bold world.");
});

test("code and formulas are whole: bold wraps them, code is offered only for plain text", async ({
  page,
}) => {
  await boot(page);
  await select(page, "od");
  await expect(
    tools(page).getByRole("button", { name: "行内代码" }),
  ).toBeDisabled();
  await press(page, "加粗");
  await expect
    .poll(() => editorText(page))
    .toContain("world. **`code`** $x^2$");
  await select(page, "world.", "end.");
  await press(page, "斜体");
  await expect
    .poll(() => editorText(page))
    .toContain("**bold** *world. **`code`** $x^2$ end.*");
});

test("several paragraphs, list items and cells: each block gets its own marks, one undo", async ({
  page,
}) => {
  await boot(page);
  await select(page, "world.", "Second");
  await press(page, "高亮");
  const text = await editorText(page);
  // Each block is wrapped separately; blank lines and the link stay outside.
  expect(text).toMatch(
    /\*\*bold\*\* <mark[^>]*>world\. `code` \$x\^2\$ end\.<\/mark>/,
  );
  expect(text).toMatch(
    /<mark[^>]*>倍。\[Claude Platform\]\([^)]*\) 如果你其实是在问。<\/mark>/,
  );
  expect(text).toMatch(/<mark[^>]*>Second<\/mark> paragraph/);
  await expect(page.locator("#content mark")).toHaveCount(3);
  // One step undoes every block.
  await page.locator("#reader").focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator("#content mark")).toHaveCount(0);

  await select(page, "one", "here");
  await expect(
    tools(page).getByRole("button", { name: "链接" }),
  ).toBeDisabled();
  await press(page, "加粗");
  await expect
    .poll(() => editorText(page))
    .toContain("- item **one**\n- **item two here**");

  await select(page, "left", "right");
  await press(page, "删除线");
  await expect
    .poll(() => editorText(page))
    .toContain("| ~~left~~ | ~~right~~ |");
});
