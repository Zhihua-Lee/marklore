import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// The format bar in Read mode is the reader's choice: off by default, so
// selecting text while reading stays plain; on, the page can be marked up
// (highlight, color, bold...) without leaving Read mode.
async function boot(page) {
  await installFolio(page);
  await page.addInitScript(() => {
    window.mock = { saved: [], handlers: {} };
    window.folio = folioTest.mock({
      ready: async () => ({
        roots: [],
        restored: [],
        incoming: [
          {
            id: "note",
            name: "Note.md",
            path: "C:/test/Note.md",
            text: "# Note\n\nEnergy is the same in both domains.\n",
            version: "v1",
          },
        ],
        settings: { sidebar: false, outline: false },
      }),
      save: async (_id, text) => {
        window.mock.saved.push(text);
        return { version: "v2" };
      },
      session: async (state) => (window.mock.session = state),
    });
  });
  await page.goto("/");
  await expect(page.locator("#content h1")).toBeVisible();
}
const tools = (page) => page.getByRole("toolbar", { name: "选中文字格式" });
const mode = (page) =>
  page.locator('.modes [aria-pressed="true"]').getAttribute("data-mode");
async function select(page, phrase) {
  await page.locator("#content p").evaluate((el, phrase) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && !node.textContent.includes(phrase));
    const at = node.textContent.indexOf(phrase);
    document.querySelector("#reader").focus();
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + phrase.length);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }, phrase);
}

test("Read mode marks up the page only once its format bar is turned on", async ({
  page,
}) => {
  await boot(page);
  await select(page, "the same");
  await page.waitForTimeout(300);
  await expect(tools(page)).toBeHidden();

  await page.getByRole("button", { name: "设置", exact: true }).click();
  const option = page.getByRole("checkbox", { name: "阅读模式中的格式栏" });
  await expect(option).not.toBeChecked();
  await option.check();
  await page.getByRole("button", { name: "关闭设置" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.mock.session?.settings.readingFormat),
    )
    .toBe(true);

  await select(page, "the same");
  await expect(tools(page)).toBeVisible();
  await tools(page).getByRole("button", { name: "高亮", exact: true }).click();
  await expect(page.locator("#content mark")).toHaveText("the same");
  expect(await mode(page)).toBe("read");
  await page.keyboard.press("Control+s");
  await expect
    .poll(() => page.evaluate(() => window.mock.saved.at(-1)))
    .toMatch(/<mark[^>]*>the same<\/mark>/);

  // Double-click selects a word for the bar and stays in Read mode;
  // Alt+double-click still goes to the source.
  const word = page.locator("#content p");
  const box = await word.boundingBox();
  await page.mouse.dblclick(box.x + 12, box.y + box.height / 2);
  await expect(tools(page)).toBeVisible();
  expect(await mode(page)).toBe("read");
  await page.keyboard.down("Alt");
  await page.mouse.dblclick(box.x + 12, box.y + box.height / 2);
  await page.keyboard.up("Alt");
  await expect.poll(() => mode(page)).toBe("edit");
});
