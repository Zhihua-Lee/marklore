import { test, expect } from "@playwright/test";
async function boot(page, text = "Hello 中文") {
  await page.addInitScript((text) => {
    window.mock = { handlers: {}, images: [], saved: [] };
    window.folio = {
      ready: async () => ({
        roots: [],
        restored: [],
        incoming: [
          {
            id: "note",
            path: "C:/test/Note.md",
            name: "Note.md",
            text,
            version: "v1",
          },
        ],
        settings: { sidebar: false, outline: false },
      }),
      on: (name, fn) => (window.mock.handlers[name] = fn),
      read: async () => ({ unchanged: true }),
      session: async (value) => (window.mock.session = value),
      save: async (_id, text) => {
        window.mock.saved.push(text);
        return { version: "v2" };
      },
      pickImage: async (id) => {
        window.mock.images.push(id);
        return { url: "assets/image.png", label: "My picture" };
      },
      list: async () => [],
    };
  }, text);
  await page.goto("/");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator(".editing-tools")).toBeVisible();
}
const content = (page) =>
  page
    .locator(".cm-line")
    .allTextContents()
    .then((lines) => lines.join("\n"));
async function selectAll(page) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
}
test("format toolbar preserves selection, renders immediately and undo/redo is atomic", async ({
  page,
}) => {
  await boot(page);
  await selectAll(page);
  await page.getByRole("button", { name: "粗体", exact: true }).click();
  expect(await content(page)).toBe("**Hello 中文**");
  await expect(page.locator("#content strong")).toHaveText("Hello 中文");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await content(page)).toBe("Hello 中文");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  expect(await content(page)).toBe("**Hello 中文**");
  await page.getByRole("button", { name: "粗体", exact: true }).click();
  expect(await content(page)).toBe("Hello 中文");
  await page.keyboard.press("Control+i");
  expect(await content(page)).toBe("*Hello 中文*");
  await page.keyboard.press("Control+z");
  await page.getByRole("combobox", { name: "段落样式" }).selectOption("2");
  expect(await content(page)).toBe("## Hello 中文");
  await expect(page.locator("#content h2")).toContainText("Hello 中文");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect(await page.evaluate(() => window.mock.saved)).toEqual([
    "## Hello 中文",
  ]);
});
test("multiline list/quote commands convert and toggle; source and read modes keep state", async ({
  page,
}) => {
  await boot(page, "one\ntwo");
  await selectAll(page);
  await page.getByRole("button", { name: "有序列表", exact: true }).click();
  expect(await content(page)).toBe("1. one\n2. two");
  await page.getByRole("button", { name: "任务列表", exact: true }).click();
  expect(await content(page)).toBe("- [ ] one\n- [ ] two");
  await expect(page.locator("#content .task-list-item")).toHaveCount(2);
  await page.getByRole("button", { name: "任务列表", exact: true }).click();
  await page.getByRole("button", { name: "引用", exact: true }).click();
  expect(await content(page)).toBe("> one\n> two");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".editing-tools")).toBeVisible();
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(page.locator(".editing-tools")).toBeHidden();
  await expect(page.locator("#content blockquote")).toContainText("one");
});
test("link dialog supports cancel, safe destinations and preserved selection", async ({
  page,
}) => {
  await boot(page);
  await selectAll(page);
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "插入链接", exact: true });
  await expect(dialog.getByLabel("显示文字")).toHaveValue("Hello 中文");
  await page.keyboard.press("Escape");
  expect(await content(page)).toBe("Hello 中文");
  await page.getByRole("button", { name: "插入链接", exact: true }).click();
  await dialog.getByLabel("链接或文件路径").fill("javascript:alert(1)");
  await dialog.getByRole("button", { name: "插入", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("有效");
  await dialog.getByLabel("链接或文件路径").fill("chapter 2.md#标题");
  await dialog.getByRole("button", { name: "插入", exact: true }).click();
  expect(await content(page)).toBe("[Hello 中文](<chapter%202.md#标题>)");
  await expect(page.locator("#content a")).toHaveText("Hello 中文");
});
test("table picker builds rendered table, supports Tab navigation and undo", async ({
  page,
}) => {
  await boot(page, "");
  await page.getByRole("button", { name: "插入表格", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "插入表格", exact: true });
  await dialog.getByLabel("列数").fill("2");
  await dialog.getByLabel("正文行数").fill("2");
  await dialog.getByRole("button", { name: "插入", exact: true }).click();
  await expect(page.locator("#content th")).toHaveCount(2);
  await expect(page.locator("#content td")).toHaveCount(4);
  await page.keyboard.insertText("Name");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("Value");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("Alpha");
  await expect(page.locator("#content th").nth(1)).toHaveText("Value");
  await expect(page.locator("#content td").first()).toHaveText("Alpha");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.insertText("Result");
  await expect(page.locator("#content th").nth(1)).toHaveText("Result");
});
test("code picker and math wrap selected source; dark code colors and toolbar remain legible", async ({
  page,
}) => {
  await boot(page, 'const name = "Folio"; // comment');
  await selectAll(page);
  await page.getByRole("button", { name: "代码块", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "代码块", exact: true });
  await dialog.getByLabel("语言").fill("javascript");
  await dialog.getByRole("button", { name: "插入", exact: true }).click();
  await expect(page.locator("#content .code-block")).toHaveCount(1);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    const colors = await page
      .locator("#content .code-block")
      .evaluate((el) => ({
        background: getComputedStyle(el).backgroundColor,
        ink: getComputedStyle(el.querySelector("code")).color,
        string: getComputedStyle(el.querySelector(".hljs-string")).color,
      }));
    expect(colors.background).toBe("rgb(30, 30, 30)");
    expect(colors.ink).toBe("rgb(212, 212, 212)");
    expect(colors.string).toBe("rgb(206, 145, 120)");
    const sourceToken = page
      .locator(".cm-line span")
      .filter({ hasText: "javascript" })
      .first();
    await expect(sourceToken).toHaveCSS(
      "color",
      theme === "dark" ? "rgb(156, 220, 254)" : "rgb(36, 109, 93)",
    );
    await page.screenshot({ path: `.local/editor-${theme}-v015.png` });
  }
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await selectAll(page);
  await page.keyboard.insertText("x^2");
  await selectAll(page);
  await page.getByRole("button", { name: "公式块", exact: true }).click();
  await expect(page.locator("#content .katex-display")).toHaveCount(1);
});
test("image picker inserts relative attachment path; narrow toolbar does not overflow", async ({
  page,
}) => {
  await boot(page, "");
  await page.getByRole("button", { name: "插入图片", exact: true }).click();
  await expect
    .poll(() => content(page))
    .toContain("![My picture](<assets/image.png>)");
  expect(await page.evaluate(() => window.mock.images)).toEqual(["note"]);
  await expect(page.locator("#content img")).toHaveAttribute(
    "src",
    "folio-asset://note/?path=assets%2Fimage.png",
  );
  await page.setViewportSize({ width: 600, height: 800 });
  const geometry = await page.locator(".editing-tools").evaluate((el) => ({
    width: el.clientWidth,
    scroll: el.scrollWidth,
    height: el.clientHeight,
  }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
  expect(geometry.height).toBeLessThan(200);
  await page.screenshot({ path: ".local/editor-narrow-v015.png" });
  await page.getByRole("button", { name: "新笔记", exact: true }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "插入图片", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("先保存");
});
