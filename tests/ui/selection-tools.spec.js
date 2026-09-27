import { test, expect } from "@playwright/test";

async function boot(
  page,
  text = "# Note\n\nHello 中文 selection.\n\nOther paragraph.",
) {
  await page.addInitScript((text) => {
    window.mock = { saved: [], handlers: {} };
    const file = {
      id: "note",
      name: "Note.md",
      path: "C:/test/Note.md",
      text,
      version: "v1",
    };
    window.folio = {
      ready: async () => ({
        roots: [],
        restored: [],
        incoming: [file],
        settings: { sidebar: false, outline: false },
      }),
      on: (name, fn) => (window.mock.handlers[name] = fn),
      read: async () => ({ unchanged: true }),
      list: async () => [],
      save: async (_id, text) => {
        window.mock.saved.push(text);
        return { version: "v2" };
      },
      session: async (state) => (window.mock.session = state),
      pickFiles: async () => [
        {
          ...file,
          id: "other",
          name: "Other.md",
          path: "C:/test/Other.md",
          text: "# Other\n\nHello",
        },
      ],
    };
  }, text);
  await page.goto("/");
  await expect(page.locator("#content h1")).toBeVisible();
}
const tools = (page) => page.getByRole("toolbar", { name: "选中文字格式" });
async function select(page, word, selector = "#content p") {
  await page
    .locator(selector)
    .filter({ hasText: word })
    .first()
    .evaluate((el, word) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const offset = node.textContent.indexOf(word);
        if (offset < 0) continue;
        document.querySelector("#reader").focus();
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + word.length);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        return;
      }
      throw Error("Missing word");
    }, word);
}
async function save(page) {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  return page.evaluate(() => window.mock.saved.at(-1));
}

test("preview selection formats source, keeps selection for a second action and supports undo", async ({
  page,
}) => {
  await boot(page);
  await select(page, "中文");
  await expect(tools(page)).toBeHidden();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await select(page, "中文");
  await expect(tools(page)).toBeVisible();
  await tools(page).getByRole("button", { name: "加粗", exact: true }).click();
  await expect(page.locator("#content strong")).toHaveText("中文");
  await expect(tools(page)).toBeVisible();
  await tools(page).getByRole("button", { name: "斜体", exact: true }).click();
  await expect(
    page.locator("#content strong em, #content em strong"),
  ).toHaveText("中文");
  await page.keyboard.press("Control+z");
  await expect(page.locator("#content em")).toHaveCount(0);
  await expect(page.locator("#content strong")).toHaveText("中文");
  expect(await save(page)).toBe(
    "# Note\n\nHello **中文** selection.\n\nOther paragraph.",
  );
});

test("floating colors remember choices, link input stays local, Escape dismisses", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await select(page, "中文");
  await tools(page)
    .getByRole("button", { name: "高亮", exact: true })
    .click({ button: "right" });
  await page.getByRole("button", { name: "黄色", exact: true }).click();
  await expect(page.locator("#content mark")).toHaveText("中文");
  await select(page, "selection");
  await tools(page).getByRole("button", { name: "高亮", exact: true }).click();
  await expect(page.locator("#content mark")).toHaveCount(2);
  await select(page, "Hello");
  await tools(page).getByRole("button", { name: "链接", exact: true }).click();
  await tools(page)
    .getByRole("textbox", { name: "链接地址" })
    .fill("chapter.md#part");
  await tools(page)
    .getByRole("button", { name: "应用链接", exact: true })
    .click();
  await expect(page.locator("#content a")).toHaveText("Hello");
  await expect(page.locator("#content a")).toHaveAttribute(
    "href",
    "chapter.md#part",
  );
  await select(page, "Other");
  await expect(tools(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tools(page)).toBeHidden();
  expect(await page.evaluate(() => window.getSelection().toString())).toBe("");
});

test("unsafe code and partial rich ranges do not become source edits; mode and tab changes dismiss", async ({
  page,
}) => {
  await boot(
    page,
    '# Note\n\nHello **bold** world. `code` $x^2$\n\n<span style="color: #123456">color</span>',
  );
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await select(page, "code");
  await expect(tools(page)).toBeHidden();
  await select(page, "color");
  await expect(tools(page)).toBeHidden(); // old renderer mapping hits the HTML attribute; never edit it
  await select(page, "bold");
  await expect(tools(page)).toBeVisible();
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(tools(page)).toBeHidden();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await select(page, "Hello");
  await expect(tools(page)).toBeVisible();
  await page.getByRole("button", { name: "打开文件", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Other.md", exact: true }),
  ).toBeVisible();
  await expect(tools(page)).toBeHidden();
});

test("actual drag and double-click select naturally; toolbar fits narrow and dark views", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const rect = await page
    .locator("#content p")
    .first()
    .evaluate((el) => {
      const node = el.querySelector("[data-text-from]").firstChild;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 5);
      const r = range.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
  await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, {
    steps: 6,
  });
  await expect(tools(page)).toBeHidden();
  await page.mouse.up();
  await expect(tools(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.dblclick(rect.x + 15, rect.y + rect.height / 2);
  await expect(tools(page)).toBeVisible();
  await expect(page.locator("#editor .cm-content")).not.toBeFocused();
  await page.setViewportSize({ width: 700, height: 660 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await select(page, "中文");
  await expect(tools(page)).toBeVisible();
  const bounds = await tools(page).boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(700);
  await page.screenshot({ path: ".local/selection-tools-dark-v020.png" });
});

test("read double-click follows the clicked word through reflow and highlights both panes", async ({
  page,
}) => {
  const text =
    "# Long\n\n" +
    Array.from(
      { length: 55 },
      (_, i) =>
        `## Section ${i}\n\nParagraph ${i} has repeated text for wrapping 中文文字内容。 **target${i}** End.\n\n`,
    ).join("");
  await boot(page, text);
  const target = page
    .locator("#content strong")
    .filter({ hasText: /^target37$/ });
  await target.scrollIntoViewIfNeeded();
  await target.dblclick();
  await expect(
    page.getByRole("button", { name: "编辑", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#editor .cm-content")).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...(CSS.highlights.get("folio-location") || [])]
          .map((r) => r.toString())
          .join(""),
      ),
    )
    .toBe("target37");
  const box = await target.boundingBox(),
    reader = await page.locator("#reader").boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(reader.y);
  expect(box.y + box.height).toBeLessThan(reader.y + reader.height);
  await page.keyboard.insertText("REPLACED");
  expect(await save(page)).toBe(text.replace("target37", "REPLACED"));
});
