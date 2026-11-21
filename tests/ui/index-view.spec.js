import { test, expect } from "@playwright/test";
import { setup, item, row, saved, indexText } from "./index-view-setup.js";

// A folder's index file (_目录.md) reads as the folder's pages: a row per
// entry with its fold arrow, title, file name (when it differs) and first
// sentence; the rest of the note renders as any note. Edit mode rearranges
// the list with small edits of the text; Source mode shows it as written.

test("Read mode: the list as rows, the rest of the note as written", async ({
  page,
}) => {
  await setup(page);
  const content = page.locator("#content");
  // Title, intro and the second list's heading render as in a note; the
  // comment shows nothing; the outline lists the headings.
  await expect(content.locator("h1")).toContainText("数学分析");
  await expect(content).toContainText("本笔记本按章节整理课堂笔记");
  await expect(content).not.toContainText("由 OneNote 导出生成");
  await expect(content.locator("ul")).toHaveCount(0);
  await expect(content.locator(".ix-list")).toHaveCount(2);
  // The appendix list sits in the appendix's section.
  await expect(
    content.locator(".note-section[data-level='2'] .ix-list"),
  ).toHaveCount(1);
  const levels = await content
    .locator(".ix-item")
    .evaluateAll((items) =>
      items.map((el) => [
        el.querySelector(":scope > .ix-row > .ix-title").textContent,
        el.getAttribute("aria-level"),
      ]),
    );
  expect(levels).toEqual([
    ["第一章 实数", "1"],
    ["1.1 有理数的稠密性", "2"],
    ["1.2 确界原理", "2"],
    ["例题：确界的计算", "3"],
    ["第二章 数列极限", "1"],
    ["2.1 收敛的定义", "2"],
    ["2.2 单调有界定理", "2"],
    ["第三章 函数极限", "1"],
    ["符号表", "1"],
    ["参考书目", "1"],
  ]);
  // The page's first sentence (front matter and heading skipped), and the
  // file name where it is not the title.
  await expect(row(page, "1.2 确界原理").locator(".ix-excerpt")).toHaveText(
    "非空有上界的数集必有上确界。",
  );
  await expect(row(page, "参考书目").locator(".ix-file")).toHaveText(
    "books.md",
  );
  await expect(row(page, "第一章 实数").locator(".ix-file")).toHaveCount(0);
  // A missing page says so, with its repairs.
  const missing = item(page, "2.2 单调有界定理");
  await expect(missing).toHaveClass(/missing/);
  await expect(missing.locator(".ix-missing")).toHaveText("不存在");
  await expect(missing.getByRole("button", { name: "创建" })).toBeVisible();
  // Files not in the index, folded under a quiet separator.
  const tray = content.locator(".ix-unlisted");
  await expect(tray.locator(".ix-unlisted-toggle")).toHaveText(
    "未列入目录（3）",
  );
  await expect(tray.locator(".ix-unlisted-item").first()).toBeHidden();
  await tray.locator(".ix-unlisted-toggle").click();
  await expect(tray.locator(".ix-unlisted-item")).toHaveText([
    "图片/",
    "习题课 3.md",
    "期中复习.md",
  ]);
  // No editing controls in Read mode.
  await expect(content.locator(".ix-tools")).toHaveCount(0);
  // Source mode shows the Markdown as written.
  await page.keyboard.press("Control+3");
  await expect(page.locator("#editor .cm-content")).toContainText(
    "- [第一章 实数](第一章%20实数.md)",
  );
  await expect(page.locator("#editor .cm-content")).toContainText(
    "<!-- 由 OneNote 导出生成 -->",
  );
  await expect(page.locator("#reader")).toBeHidden();
  expect(await saved(page)).toBe(indexText);
});

test("clicking a row opens the page; arrows fold and move", async ({
  page,
}) => {
  await setup(page);
  // The title, or the row beside it.
  await row(page, "1.1 有理数的稠密性").locator(".ix-excerpt").click();
  await expect(
    page.getByRole("tab", { name: "1.1 有理数的稠密性.md", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "_目录.md", exact: true }).click();
  const chapter = item(page, "第一章 实数");
  await chapter.locator(":scope > .ix-row > .ix-twisty").click();
  await expect(chapter).toHaveAttribute("aria-expanded", "false");
  await expect(row(page, "1.1 有理数的稠密性")).toBeHidden();
  // Keyboard: → unfolds, ↓ steps into the children, ← goes back up.
  await chapter.focus();
  await page.keyboard.press("ArrowRight");
  await expect(row(page, "1.1 有理数的稠密性")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "1.1 有理数的稠密性")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(chapter).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(chapter).toHaveAttribute("aria-expanded", "false");
  // The fold stays when the note is shown again.
  await page.keyboard.press("Control+2");
  await expect(item(page, "第一章 实数")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.locator("#rich .ProseMirror")).toBeHidden();
});

test("Edit mode: Tab, Shift+Tab, Alt+Shift+arrows and Alt+arrows edit only the lines moved", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press("Control+2");
  await expect(page.locator("#content .ix-tools").first()).toBeAttached();
  await item(page, "第二章 数列极限").focus();
  await page.keyboard.press("Tab");
  await expect(item(page, "第二章 数列极限")).toHaveAttribute(
    "aria-level",
    "2",
  );
  await expect(item(page, "第二章 数列极限")).toBeFocused();
  let text = await saved(page);
  expect(text).toBe(
    indexText.replace(
      "- [第二章 数列极限](第二章%20数列极限.md)\n  - [2.1 收敛的定义](2.1%20收敛的定义.md)\n  - [2.2 单调有界定理](单调有界.md)\n",
      "  - [第二章 数列极限](第二章%20数列极限.md)\n    - [2.1 收敛的定义](2.1%20收敛的定义.md)\n    - [2.2 单调有界定理](单调有界.md)\n",
    ),
  );
  await page.keyboard.press("Shift+Tab");
  await expect(item(page, "第二章 数列极限")).toHaveAttribute(
    "aria-level",
    "1",
  );
  expect(await saved(page)).toBe(indexText);
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await expect(item(page, "第二章 数列极限")).toHaveAttribute(
    "aria-level",
    "2",
  );
  await page.keyboard.press("Alt+Shift+ArrowLeft");
  await expect(item(page, "第二章 数列极限")).toHaveAttribute(
    "aria-level",
    "1",
  );
  // Alt+↓: past the next entry at its level, sub-pages with it.
  await page.keyboard.press("Alt+ArrowDown");
  text = await saved(page);
  expect(text).toBe(
    indexText.replace(
      "- [第二章 数列极限](第二章%20数列极限.md)\n  - [2.1 收敛的定义](2.1%20收敛的定义.md)\n  - [2.2 单调有界定理](单调有界.md)\n- [第三章 函数极限](第三章%20函数极限.md)\n",
      "- [第三章 函数极限](第三章%20函数极限.md)\n- [第二章 数列极限](第二章%20数列极限.md)\n  - [2.1 收敛的定义](2.1%20收敛的定义.md)\n  - [2.2 单调有界定理](单调有界.md)\n",
    ),
  );
  await expect(item(page, "第二章 数列极限")).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  expect(await saved(page)).toBe(indexText);
  // Each step undoes on its own.
  await page.keyboard.press("Control+z");
  await expect
    .poll(() =>
      page.locator("#content .ix-item > .ix-row > .ix-title").allTextContents(),
    )
    .toEqual([
      "第一章 实数",
      "1.1 有理数的稠密性",
      "1.2 确界原理",
      "例题：确界的计算",
      "第三章 函数极限",
      "第二章 数列极限",
      "2.1 收敛的定义",
      "2.2 单调有界定理",
      "符号表",
      "参考书目",
    ]);
});

test("Edit mode: drag before, after and onto an entry", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Control+2");
  const source = row(page, "符号表");
  const goal = row(page, "第三章 函数极限");
  await source.dragTo(goal, {
    targetPosition: { x: 40, y: (await goal.boundingBox()).height / 2 },
  });
  await expect(item(page, "符号表")).toHaveAttribute("aria-level", "2");
  let text = await saved(page);
  expect(text).toContain(
    "- [第三章 函数极限](第三章%20函数极限.md)\n  - [符号表](符号表.md)\n\n## 附录\n\n- [参考书目](books.md)\n",
  );
  // Before the first chapter (into another list: its indentation).
  const first = row(page, "第一章 实数");
  await row(page, "参考书目").dragTo(first, {
    targetPosition: { x: 40, y: 2 },
  });
  text = await saved(page);
  expect(text).toContain(
    "<!-- 由 OneNote 导出生成 -->\n\n- [参考书目](books.md)\n- [第一章 实数](第一章%20实数.md)\n",
  );
  expect(text).toContain("## 附录\n\n");
});

test("Edit mode: new sub-page, title in place, remove from the index, undo", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press("Control+2");
  // A new page under 2.1.
  await row(page, "2.1 收敛的定义").hover();
  await row(page, "2.1 收敛的定义")
    .getByRole("button", { name: "新建子页" })
    .click();
  const name = page.locator("#content .ix-new-row input");
  await expect(name).toBeFocused();
  await name.fill("2.1.1 例题");
  await name.press("Enter");
  await expect(item(page, "2.1.1 例题")).toHaveAttribute("aria-level", "3");
  expect(await page.evaluate(() => window.mock.created)).toEqual([
    { id: "nb", name: "2.1.1 例题.md", kind: "note", text: "" },
  ]);
  let text = await saved(page);
  expect(text).toContain(
    "  - [2.1 收敛的定义](2.1%20收敛的定义.md)\n    - [2.1.1 例题](2.1.1%20例题.md)\n  - [2.2",
  );
  // The title edited in place: only the link text changes.
  await item(page, "符号表").focus();
  await page.keyboard.press("F2");
  const input = row(page, "符号表").locator("input.ix-title-input");
  await expect(input).toBeFocused();
  await input.fill("记号与约定");
  await input.press("Enter");
  await expect(item(page, "记号与约定")).toBeFocused();
  text = await saved(page);
  expect(text).toContain("- [记号与约定](符号表.md)\n");
  // Removed from the index: its line goes, its file stays (offered again
  // under "not in the index"); its sub-pages move up a level.
  await row(page, "第一章 实数").hover();
  await row(page, "第一章 实数")
    .getByRole("button", { name: "移出目录（不删除文件）" })
    .click();
  await expect(item(page, "1.1 有理数的稠密性")).toHaveAttribute(
    "aria-level",
    "1",
  );
  text = await saved(page);
  expect(text).toContain(
    "<!-- 由 OneNote 导出生成 -->\n\n- [1.1 有理数的稠密性](1.1%20有理数的稠密性.md)\n- [1.2 确界原理](1.2%20确界原理.md)\n  - [例题：确界的计算]",
  );
  await expect(page.locator("#content .ix-unlisted-toggle")).toHaveText(
    "未列入目录（4）",
  );
  // Ctrl+Z takes back the last change only.
  await item(page, "1.1 有理数的稠密性").focus();
  await page.keyboard.press("Control+z");
  await expect(item(page, "第一章 实数")).toBeVisible();
  text = await saved(page);
  expect(text).toContain("- [记号与约定](符号表.md)\n");
  expect(text).toContain("- [第一章 实数](第一章%20实数.md)\n");
  // Delete removes the focused entry too.
  await item(page, "参考书目").focus();
  await page.keyboard.press("Delete");
  await expect(item(page, "参考书目")).toHaveCount(0);
});

test("missing page: create, point elsewhere, or remove", async ({ page }) => {
  await setup(page);
  const missing = () => item(page, "2.2 单调有界定理");
  // Point it at a file of the folder (Read mode repairs too).
  await missing().getByRole("button", { name: "改为指向…" }).click();
  const select = missing().locator("select.ix-relocate");
  await select.selectOption("期中复习.md");
  await expect(missing()).not.toHaveClass(/missing/);
  await page.keyboard.press("Control+2");
  let text = await saved(page);
  expect(text).toContain("  - [2.2 单调有界定理](期中复习.md)\n");
  // Undo, then create the file it names.
  await missing().focus();
  await page.keyboard.press("Control+z");
  await expect(missing()).toHaveClass(/missing/);
  await missing().getByRole("button", { name: "创建" }).click();
  await expect(missing()).not.toHaveClass(/missing/);
  expect(await page.evaluate(() => window.mock.created.at(-1))).toEqual({
    id: "nb",
    name: "单调有界.md",
    kind: "note",
    text: "",
  });
  // The text is unchanged by creating.
  expect(await saved(page)).toBe(indexText);
});

test("files not in the index are added at the end, or dragged in place", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press("Control+2");
  await page.locator("#content .ix-unlisted-toggle").click();
  const tray = page.locator("#content .ix-unlisted");
  await tray
    .locator(".ix-unlisted-item", { hasText: "期中复习.md" })
    .getByRole("button", { name: "加入目录" })
    .click();
  await expect(item(page, "期中复习")).toBeVisible();
  let text = await saved(page);
  expect(text).toBe(
    indexText.replace(
      "- [参考书目](books.md)\n",
      "- [参考书目](books.md)\n- [期中复习](期中复习.md)\n",
    ),
  );
  await expect(page.locator("#content .ix-unlisted-toggle")).toHaveText(
    "未列入目录（2）",
  );
  // A file made by another program shows once the folder changes.
  await page.evaluate(() => {
    window.mock.pages["外部新建.md"] = "# 外部\n";
    window.mock.handlers.library();
  });
  await expect(page.locator("#content .ix-unlisted-toggle")).toHaveText(
    "未列入目录（3）",
  );
  // A folder dragged under a chapter.
  const goal = row(page, "第三章 函数极限");
  await tray.locator(".ix-unlisted-item", { hasText: "图片/" }).dragTo(goal, {
    targetPosition: { x: 40, y: (await goal.boundingBox()).height / 2 },
  });
  text = await saved(page);
  expect(text).toContain(
    "- [第三章 函数极限](第三章%20函数极限.md)\n  - [图片](图片/)\n",
  );
  // A new page at the end of the list.
  await page.getByRole("button", { name: "新建页面" }).click();
  const name = page.locator("#content .ix-new-row input");
  await name.fill("期末复习");
  await name.press("Enter");
  await expect(item(page, "期末复习")).toBeVisible();
  text = await saved(page);
  expect(text).toContain(
    "- [期中复习](期中复习.md)\n- [期末复习](期末复习.md)\n",
  );
});

test("Edit mode: prose is edited as Markdown in place; the list never touched", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press("Control+2");
  const intro = page.locator("#content p", { hasText: "本笔记本按章节" });
  await intro.dblclick();
  const area = page.locator("#content textarea.ix-block-editor");
  await expect(area).toBeFocused();
  await expect(area).toHaveValue(
    "本笔记本按章节整理课堂笔记，顺序与 OneNote 中一致。",
  );
  await area.fill("按章节整理的**课堂笔记**。");
  await area.press("Control+Enter");
  await expect(page.locator("#content p strong")).toHaveText("课堂笔记");
  const text = await saved(page);
  expect(text).toBe(
    indexText.replace(
      "本笔记本按章节整理课堂笔记，顺序与 OneNote 中一致。",
      "按章节整理的**课堂笔记**。",
    ),
  );
  // Esc leaves it as it was.
  await page.locator("#content h2").dblclick();
  await expect(area).toHaveValue("## 附录");
  await area.press("Escape");
  await expect(area).toHaveCount(0);
  await expect(page.locator("#content h2")).toBeVisible();
  // A double click in Read mode opens the block's Markdown in Edit mode.
  await page.keyboard.press("Control+1");
  await page.locator("#content h2").dblclick();
  await expect(page.locator("#panes")).toHaveAttribute("data-mode", "edit");
  await expect(area).toHaveValue("## 附录");
  await area.press("Escape");
});

test("the source pane beside it, and dark theme", async ({ page }) => {
  await setup(page, { editSplit: true, theme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // Missing in a muted red that reads on the dark page.
  const tag = item(page, "2.2 单调有界定理").locator(".ix-missing");
  // As sRGB 0–255 (a color-mix() result reads as color(srgb r g b)).
  const [r, g, b] = await tag.evaluate((el) => {
    const canvas = document.createElement("canvas").getContext("2d");
    canvas.fillStyle = getComputedStyle(el).color;
    canvas.fillRect(0, 0, 1, 1);
    return [...canvas.getImageData(0, 0, 1, 1).data];
  });
  expect(r).toBeGreaterThan(g + 40);
  expect(r + g + b).toBeGreaterThan(400);
  await page.keyboard.press("Control+2");
  await expect(page.locator("#editor-pane")).toBeVisible();
  await expect(page.locator("#content .ix-list").first()).toBeVisible();
  // An edit in the view shows in the source pane.
  await item(page, "第三章 函数极限").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#editor .cm-content")).toContainText(
    "  - [第三章 函数极限](第三章%20函数极限.md)",
  );
});

test("'point elsewhere' offers the same choices as the tree's repair", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    window.mock.repair = {
      target: "C:/kb/数学分析/单调有界.md",
      name: "单调有界.md",
      missing: true,
      creatable: true,
      candidates: [
        {
          path: "C:/kb/其他/单调有界 2.md",
          name: "单调有界 2.md",
          rel: "../其他/单调有界 2.md",
          reason: "renamed",
        },
        {
          path: "C:/kb/数学分析/期中复习.md",
          name: "期中复习.md",
          rel: "期中复习.md",
          reason: "unlisted",
        },
      ],
    };
  });
  const missing = () => item(page, "2.2 单调有界定理");
  await missing().getByRole("button", { name: "改为指向…" }).click();
  const select = missing().locator("select.ix-relocate");
  await expect(select.locator("option")).toHaveText([
    "选择文件…",
    "../其他/单调有界 2.md（刚被改名或移动到这里）",
    "期中复习.md（这个文件夹中未列入目录的笔记）",
  ]);
  expect(await page.evaluate(() => window.mock.repairAsked)).toEqual([
    ["C:/kb/数学分析/_目录.md", "单调有界.md"],
  ]);
  await select.selectOption({ index: 1 });
  await page.keyboard.press("Control+2");
  expect(await saved(page)).toContain(
    "  - [2.2 单调有界定理](../其他/单调有界%202.md)\n",
  );
});
