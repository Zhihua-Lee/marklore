import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";
async function boot(page, text = "Hello 中文") {
  await installFolio(page);
  await page.addInitScript((text) => {
    window.mock = { handlers: {}, images: [], saved: [] };
    window.folio = folioTest.mock({
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
        settings: {
          sidebar: false,
          outline: false,
          ...JSON.parse(localStorage.getItem("editor-test-settings") || "{}"),
        },
      }),
      session: async (value) => {
        window.mock.session = value;
        localStorage.setItem(
          "editor-test-settings",
          JSON.stringify(value.settings),
        );
      },
      save: async (_id, text) => {
        window.mock.saved.push(text);
        return { version: "v2" };
      },
      pickImage: async (id) => {
        window.mock.images.push(id);
        return { url: "assets/image.png", label: "My picture" };
      },
    });
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
test("grouped color/highlight tools render, clear, undo and adapt to dark mode", async ({
  page,
}) => {
  await boot(page, "Hello **中文**");
  await selectAll(page);
  await page
    .getByRole("button", { name: "文字高亮", exact: true })
    .click({ button: "right" });
  await page.getByRole("button", { name: "黄色", exact: true }).click();
  await expect(page.locator("#content mark strong")).toHaveText("中文");
  await expect(page.locator("#content mark")).toHaveCSS(
    "background-color",
    "rgb(242, 216, 120)",
  );
  await page
    .getByRole("button", { name: "文字颜色", exact: true })
    .click({ button: "right" });
  await page.getByRole("button", { name: "蓝色", exact: true }).click();
  await expect(page.locator('#content span[style*="--folio-color"]')).toHaveCSS(
    "color",
    "rgb(40, 107, 160)",
  );
  await page
    .getByRole("button", { name: "文字颜色", exact: true })
    .click({ button: "right" });
  await page.getByRole("button", { name: "恢复默认颜色", exact: true }).click();
  await expect(
    page.locator('#content span[style*="--folio-color"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await expect(page.locator('#content span[style*="--folio-color"]')).toHaveCSS(
    "color",
    "rgb(143, 198, 238)",
  );
  await expect(page.locator("#content mark")).toHaveCSS(
    "background-color",
    "rgb(101, 86, 40)",
  );
  await expect(page.locator(".editing-tools > .edit-tool-group")).toHaveCount(
    4,
  );
  await page.setViewportSize({ width: 600, height: 800 });
  expect(
    await page
      .locator(".editing-tools")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: ".local/editing-colors-v017.png" });
});

test("left click applies remembered color, right click opens anchored palette and keyboard dismisses it", async ({
  page,
}) => {
  await boot(page, "Selected 中文");
  await selectAll(page);
  const highlight = page.getByRole("button", { name: "文字高亮", exact: true });
  await highlight.click();
  await expect(page.locator("#content mark")).toHaveText("Selected 中文");
  await expect(page.locator(".text-color-picker")).toHaveCount(0);
  await highlight.click({ button: "right" });
  const palette = page.getByRole("dialog", { name: "高亮调色板" });
  await expect(palette).toBeVisible();
  expect(
    await page.evaluate(() => document.querySelectorAll("dialog[open]").length),
  ).toBe(0);
  const rects = await page.evaluate(() => {
    const b = document
        .querySelector('[data-edit="highlight"]')
        .getBoundingClientRect(),
      p = document.querySelector(".text-color-picker").getBoundingClientRect();
    return { gap: p.top - b.bottom, width: p.width };
  });
  expect(rects.gap).toBeGreaterThanOrEqual(0);
  expect(rects.gap).toBeLessThan(12);
  expect(rects.width).toBeLessThan(230);
  await page.screenshot({ path: ".local/color-palette-v018.png" });
  await page.getByRole("button", { name: "粉色", exact: true }).click();
  await expect(highlight).toHaveCSS("--selected-color", "#efc4d1");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await highlight.click();
  await expect(page.locator("#content mark")).toHaveCSS(
    "background-color",
    "rgb(239, 196, 209)",
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.mock.session?.settings.highlightColor),
    )
    .toBe("#efc4d1");
  await page.reload();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(highlight).toHaveCSS("--selected-color", "#efc4d1");
  await selectAll(page);
  await highlight.click();
  await expect(page.locator("#content mark")).toHaveCSS(
    "background-color",
    "rgb(239, 196, 209)",
  );
  await highlight.focus();
  await page.keyboard.press("ArrowDown");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(highlight).toBeFocused();
  await highlight.click({ button: "right" });
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(palette).toHaveCount(0);
});

test("inline formula and divider are direct toolbar controls", async ({
  page,
}) => {
  await boot(page, "x^2");
  await selectAll(page);
  await expect(page.getByRole("combobox", { name: "更多格式" })).toHaveCount(0);
  await page.getByRole("button", { name: "行内公式", exact: true }).click();
  await expect(page.locator("#content .formula .katex")).toHaveCount(1);
  await page.locator("#editor .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.getByRole("button", { name: "分割线", exact: true }).click();
  await expect(page.locator("#content hr")).toHaveCount(1);
});

test("table styles, adaptive measure and motion-free hover remain selectable and persistent", async ({
  page,
}) => {
  await boot(
    page,
    "# Table\n\n| Name | Value |\n| :--- | ---: |\n| Alpha | $x^2$ |\n| Beta | 中文说明 |\n\n```mermaid\nflowchart LR\nA --> B\n```",
  );
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  const wrapper = page.locator("#content .table-scroll"),
    table = page.locator("#content table");
  await expect(wrapper).toHaveCSS("border-radius", "8px");
  const sizes = await wrapper.evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    parent: el.parentElement.clientWidth,
  }));
  expect(sizes.width).toBeLessThan(sizes.parent);
  const original = await wrapper.boundingBox();
  const shadow = await wrapper.evaluate((el) => getComputedStyle(el).boxShadow);
  await page.locator("#content tbody tr").first().hover();
  await expect
    .poll(() => wrapper.evaluate((el) => getComputedStyle(el).boxShadow))
    .not.toBe(shadow);
  expect(await wrapper.boundingBox()).toEqual(original);
  await expect(table).toHaveCSS("transform", "none");
  await page.screenshot({ path: ".local/table-soft-hover-v018.png" });
  await page.locator("#content .diagram svg").waitFor();
  const chart = page.locator("#content .code-block:has(.diagram)");
  const chartBox = await chart.boundingBox();
  await chart.hover();
  await expect
    .poll(() => chart.evaluate((el) => getComputedStyle(el).boxShadow))
    .not.toBe("none");
  expect(await chart.boundingBox()).toEqual(chartBox);
  await page.locator("#theme").click();
  await page.locator("#content tbody tr").first().hover();
  await page.screenshot({ path: ".local/table-dark-hover-v018.png" });
  await page.locator("#theme").click();
  await page.getByRole("button", { name: "外观与布局", exact: true }).click();
  await page.getByRole("combobox", { name: "表格风格" }).selectOption("grid");
  await page.getByRole("combobox", { name: "表格宽度" }).selectOption("full");
  await page.getByRole("button", { name: "关闭外观设置" }).click();
  await expect(wrapper).toHaveCSS("border-radius", "0px");
  // Chromium snaps CSS borders to device pixels at the current reading zoom.
  expect(
    await page
      .locator("#content td")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).borderRightWidth)),
  ).toBeGreaterThan(0);
  expect((await wrapper.boundingBox()).width).toBeGreaterThan(sizes.width);
  await expect
    .poll(() => page.evaluate(() => window.mock.session?.settings.tableStyle))
    .toBe("grid");
  await page.reload();
  await expect(wrapper).toHaveCSS("border-radius", "0px");
  await page.getByRole("button", { name: "外观与布局", exact: true }).click();
  await page.getByRole("combobox", { name: "表格风格" }).selectOption("plain");
  await page.getByRole("button", { name: "关闭外观设置" }).click();
  await expect(page.locator("#content td").first()).toHaveCSS(
    "border-right-width",
    "0px",
  );
  await expect(wrapper).toHaveCSS("box-shadow", "none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(wrapper).toHaveCSS("transition-duration", "0s");
  await page.setViewportSize({ width: 600, height: 800 });
  expect(
    await page
      .locator("#content")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: ".local/tables-v018.png" });
});

test("read mode has no local editing entry; edit mode offers grouped local color tools", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await page.locator("#content p").hover();
  await expect(page.locator("#block-edit-launch")).toBeHidden();
  await expect(page.locator(".block-edit-hover")).toHaveCount(0);
  await page.locator("#reader").focus();
  await page.keyboard.press("Alt+Enter");
  await expect(page.locator(".block-editor")).toHaveCount(0);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator("#content p").hover();
  await page.getByRole("button", { name: "就地编辑此块", exact: true }).click();
  await page.locator(".block-editor .cm-content").click();
  await page.keyboard.press("Control+a");
  await page
    .getByRole("button", { name: "就地文字高亮", exact: true })
    .click({ button: "right" });
  await page.getByRole("button", { name: "粉色", exact: true }).click();
  await expect(page.locator(".block-editor .cm-content")).toContainText(
    "<mark",
  );
  await page
    .getByRole("button", { name: "就地文字颜色", exact: true })
    .click({ button: "right" });
  await page.getByRole("button", { name: "绿色", exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator("#content mark")).toHaveText("Hello 中文");
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await page.locator("#content p").hover();
  await expect(page.locator("#block-edit-launch")).toBeHidden();
});
test("color preserves heading structure, clean outline labels and literal code", async ({
  page,
}) => {
  await boot(page, "## Hello 中文");
  await selectAll(page);
  await page
    .getByRole("button", { name: "文字颜色", exact: true })
    .click({ button: "right" });
  await page.getByRole("button", { name: "红色", exact: true }).click();
  await expect(page.locator("#content h2")).toContainText("Hello 中文");
  await expect(page.locator("#content h2")).toHaveAttribute("id", "hello-中文");
  const label = await page.evaluate(async () => {
    const { renderHeadingLabel } = await import("/src/markdown.js").then(
      async (m) => (await m.loadMath(), m),
    );
    const el = document.createElement("div");
    el.innerHTML = renderHeadingLabel(
      '<span style="color:red">Hello</span> `<span>` <img src=x onerror=alert(1)>',
    );
    return {
      text: el.textContent,
      active: el.querySelectorAll("img,[onerror]").length,
    };
  });
  expect(label).toEqual({ text: "Hello <span> ", active: 0 });
});
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
  const header = page.locator("#content th").nth(1),
    headerText = header.locator("[data-text-from]"),
    headerSort = header.locator(".table-sort");
  await expect(headerText).toHaveText("Value");
  await expect(headerSort).toHaveAttribute("aria-label", "按Value排序");
  await expect(headerSort).toBeEnabled();
  await expect(header).toHaveAttribute("aria-sort", "none");
  await expect(page.locator("#content td").first()).toHaveText("Alpha");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.insertText("Result");
  await expect(headerText).toHaveText("Result");
  await expect(headerSort).toHaveAttribute("aria-label", "按Result排序");
  await expect(headerSort).toBeEnabled();
  await expect(header).toHaveAttribute("aria-sort", "none");
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
