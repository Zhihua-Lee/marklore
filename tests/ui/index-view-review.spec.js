import { test, expect } from "@playwright/test";
import { setup, item, row, saved, indexText } from "./index-view-setup.js";

// The index view (src/folder-index-view.js) after a code review: reading
// position in long lists, first sentences of pages main already knows or
// that changed, Edit-mode clicks, folders and attachments as entries,
// undo and focus, inline editors kept, large indexes, front matter and
// comments edited in place.

const longIndex = (count) =>
  [
    "# 长目录",
    "",
    ...Array.from(
      { length: count },
      (_, i) => `- [第 ${i + 1} 页](page${i + 1}.md)`,
    ),
    "",
  ].join("\n");
const offsetOf = (page, title) =>
  item(page, title).evaluate(
    (el) =>
      el.getBoundingClientRect().top -
      document.querySelector("#reader").getBoundingClientRect().top,
  );

test("the place read inside a long list is kept across a switch to Edit and back", async ({
  page,
}) => {
  await setup(page, {}, longIndex(160), { wait: false });
  await expect(item(page, "第 160 页")).toBeAttached();
  await item(page, "第 90 页").evaluate((el) =>
    el.scrollIntoView({ block: "start" }),
  );
  await page.waitForTimeout(200);
  const before = await offsetOf(page, "第 90 页");
  await page.keyboard.press("Control+2");
  await expect(page.locator("#panes")).toHaveAttribute("data-mode", "edit");
  await page.waitForTimeout(300);
  expect(Math.abs((await offsetOf(page, "第 90 页")) - before)).toBeLessThan(
    60,
  );
  await page.keyboard.press("Control+1");
  await expect(page.locator("#panes")).toHaveAttribute("data-mode", "read");
  await page.waitForTimeout(300);
  expect(Math.abs((await offsetOf(page, "第 90 页")) - before)).toBeLessThan(
    60,
  );
});

test("a page main already knows still shows its first sentence", async ({
  page,
}) => {
  await setup(page, {}, indexText, { noText: ["符号表.md"] });
  await expect(row(page, "符号表").locator(".ix-excerpt")).toHaveText(
    "本笔记本使用的记号一览。",
  );
});

test("first sentences changed while another note was shown are read again", async ({
  page,
}) => {
  await setup(page);
  await row(page, "第一章 实数").locator(".ix-excerpt").click();
  await expect(
    page.getByRole("tab", { name: "第一章 实数.md", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => {
    window.mock.pages["第一章 实数.md"] = "# 第一章 实数\n\n改写后的第一句。\n";
    window.mock.handlers.links?.();
  });
  await page.getByRole("tab", { name: "_目录.md", exact: true }).click();
  await expect(row(page, "第一章 实数").locator(".ix-excerpt")).toHaveText(
    "改写后的第一句。",
  );
});

test("Edit mode: a double click on a title edits it, a click picks the entry", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press("Control+2");
  const title = row(page, "符号表").locator(".ix-title");
  await title.click();
  await expect(item(page, "符号表")).toBeFocused();
  await title.dblclick();
  await expect(
    row(page, "符号表").locator("input.ix-title-input"),
  ).toBeFocused();
  expect(await page.evaluate(() => window.mock.opened)).toEqual([]);
  await expect(
    page.getByRole("tab", { name: "_目录.md", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  // While the title is typed, the row is not dragged.
  await expect(row(page, "符号表")).toHaveAttribute("draggable", "false");
  await page.keyboard.press("Escape");
  await expect(row(page, "符号表")).toHaveAttribute("draggable", "true");
  // Ctrl+click still opens the page.
  await title.click({ modifiers: ["Control"] });
  await expect
    .poll(() => page.evaluate(() => window.mock.opened))
    .toEqual(["符号表.md"]);
});

test("a folder entry opens the folder's index, or says it has none", async ({
  page,
}) => {
  const text = indexText.replace(
    "- [参考书目](books.md)",
    "- [参考书目](books.md)\n- [图片](图片/)",
  );
  await setup(page, {}, text);
  await row(page, "图片").click();
  await expect(page.locator("#toast")).toContainText("图片");
  await expect(page.locator("#toast")).not.toContainText("不是普通文件");
  await page.evaluate(() => {
    window.mock.lists.img = [
      {
        name: "_目录.md",
        path: "C:/kb/数学分析/图片/_目录.md",
        directory: false,
        index: true,
      },
    ];
    window.mock.pages["图片/_目录.md"] = "- [图](a.md)\n";
  });
  await row(page, "图片").click();
  await expect
    .poll(() => page.evaluate(() => window.mock.opened))
    .toEqual(["图片/_目录.md"]);
});

test("attachments are not missing; .mdown pages are created as notes; a deeper missing link says so", async ({
  page,
}) => {
  const text = indexText.replace(
    "- [参考书目](books.md)",
    [
      "- [参考书目](books.md)",
      "- [课程大纲](syllabus.pdf)",
      "- [旧笔记](old.mdown)",
      "- [深处](sub/gone.md)",
    ].join("\n"),
  );
  await page.addInitScript(() => {
    window.__brokenHrefs = ["sub/gone.md"];
  });
  await setup(page, {}, text, { wait: false });
  await page.evaluate(() => {
    window.mock.brokenHrefs = window.__brokenHrefs;
  });
  await expect(row(page, "第一章 实数").locator(".ix-excerpt")).toBeVisible();
  await expect(item(page, "课程大纲")).not.toHaveClass(/missing/);
  await expect(item(page, "旧笔记")).toHaveClass(/missing/);
  await item(page, "旧笔记").getByRole("button", { name: "创建" }).click();
  await expect
    .poll(() => page.evaluate(() => window.mock.created.at(-1)))
    .toEqual({ id: "nb", name: "old.mdown", kind: "note", text: "# 旧笔记\n" });
  // Shown again after a library change, the deeper link is missing too.
  await page.evaluate(() => window.mock.handlers.library?.());
  await expect(item(page, "深处")).toHaveClass(/missing/);
  await expect(
    item(page, "深处").getByRole("button", { name: "创建" }),
  ).toHaveCount(0);
});

test("undo and redo keep the focus on the entries, from the keys and the toolbar", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press("Control+2");
  await item(page, "第二章 数列极限").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(item(page, "第二章 数列极限")).toBeFocused();
  await page.keyboard.press("Control+z");
  await expect(page.locator("#content .ix-item:focus")).toHaveCount(1);
  expect(await saved(page)).toBe(indexText);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator("#content .ix-item:focus")).toHaveCount(1);
  await page.locator('.edit-history [data-edit="undo"]').click();
  await expect(page.locator("#content .ix-item:focus")).toHaveCount(1);
  // Typing after it does not reach the hidden source.
  await page.keyboard.type("x");
  expect(await saved(page)).toBe(indexText);
});

test("Read mode: a repair is undone with Ctrl+Z", async ({ page }) => {
  await setup(page);
  const missing = item(page, "2.2 单调有界定理");
  await missing.getByRole("button", { name: "移出目录" }).click();
  await expect(item(page, "2.2 单调有界定理")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(item(page, "2.2 单调有界定理")).toHaveCount(1);
});

test("a title being typed survives the folder being listed again", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press("Control+2");
  await item(page, "2.1 收敛的定义").focus();
  await page.keyboard.press("F2");
  const input = row(page, "2.1 收敛的定义").locator("input.ix-title-input");
  await input.fill("收敛");
  // The missing page in the same list appears meanwhile.
  await page.evaluate(() => {
    window.mock.pages["单调有界.md"] = "# 单调有界\n\n单调有界数列必收敛。\n";
    window.mock.handlers.library?.();
  });
  await page.waitForTimeout(400);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("收敛");
  await input.press("Enter");
  expect(await saved(page)).toContain("  - [收敛](2.1%20收敛的定义.md)\n");
  // Shown again once the title is taken.
  await expect(item(page, "2.2 单调有界定理")).not.toHaveClass(/missing/);
});

test("a new page's name left without Enter makes no file", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Control+2");
  await page.locator("#content .ix-new").click();
  const name = page.locator("#content .ix-new-row input");
  await name.fill("草稿");
  await page.locator("#content h1").click();
  await expect(name).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.mock.created)).toEqual([]);
});

test("the fold arrow leaves the keys on its entry", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Control+2");
  await item(page, "第二章 数列极限")
    .locator(":scope > .ix-row .ix-twisty")
    .click();
  await expect(item(page, "第二章 数列极限")).toBeFocused();
});

test("a large index asks about its links in parts main accepts", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Links into a subfolder: shown as links, each asked about.
  await setup(page, {}, longIndex(2300).replace(/\(page/g, "(sub/page"), {
    wait: false,
  });
  // (Counted directly: a filtered locator over thousands of rows is slow.)
  await expect(page.locator("#content .ix-item")).toHaveCount(2300, {
    timeout: 30_000,
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.mock.statusCalls.reduce((a, b) => a + b, 0)),
    )
    .toBeGreaterThanOrEqual(2300);
  expect(
    Math.max(...(await page.evaluate(() => window.mock.statusCalls))),
  ).toBeLessThanOrEqual(2000);
});

test("Edit mode: front matter and comments are edited in place", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press("Control+2");
  // The comment shows as its source, quietly, and edits as Markdown.
  const comment = page.locator("#content .ix-comment");
  await expect(comment).toContainText("由 OneNote 导出生成");
  await comment.dblclick();
  const area = page.locator("#content textarea.ix-block-editor");
  await expect(area).toHaveValue("<!-- 由 OneNote 导出生成 -->");
  await area.fill("<!-- 已整理 -->");
  await area.press("Control+Enter");
  // The properties open as their YAML.
  await page.locator("#content .front-matter").dblclick();
  await expect(area).toHaveValue(/title: 数学分析/);
  await area.press("Escape");
  const text = await saved(page);
  expect(text).toBe(
    indexText.replace("<!-- 由 OneNote 导出生成 -->", "<!-- 已整理 -->"),
  );
});
