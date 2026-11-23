import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";
import {
  setup as setupIndex,
  item,
  row,
  indexText,
} from "./index-view-setup.js";

// A note's leading level-one heading names it: it reads as the page's
// title (no fold arrow, rail or summary; its `##` sections the top level),
// and the outline (本文目录) lists the sections under it, indented below the
// shallowest level, the part being read marked. A folder's index file lists
// its first two levels of entries there too, each scrolling to its row; its
// guide lines fold its entries as a note's section lines fold sections.

const filler = (n) =>
  Array.from({ length: n }, (_, i) => `Paragraph ${i} of reading text.`).join(
    "\n\n",
  );
const long = [
  "---",
  "title: Long note",
  "tags: [a]",
  "---",
  "",
  "# Long note",
  "",
  "Intro text.",
  "",
  '<a id="intro-anchor"></a>',
  "",
  "**Key idea**: the opening claim.",
  "",
  "## Alpha",
  "",
  filler(12),
  "",
  "### Alpha one",
  "",
  filler(12),
  "",
  "## Beta",
  "",
  filler(40),
  "",
  "## Gamma",
  "",
  "Short end.",
  "",
].join("\n");

async function boot(page, text = long, settings = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, settings }) => {
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [
            {
              id: "long",
              name: "Long.md",
              path: "C:/synthetic/Long.md",
              version: "v1",
              text,
            },
          ],
          restored: [],
          roots: [],
          settings: { sidebar: false, outline: true, ...settings },
        }),
      });
    },
    { text, settings },
  );
  await page.goto("/");
  await expect(page.locator("#content h1").first()).toBeVisible();
}
const outline = (page) => page.locator("#outline");
const entries = (page) =>
  outline(page).locator(":scope > button:not(.outline-anchor)");

test("the leading heading is the page's title, not a section", async ({
  page,
}) => {
  await boot(page);
  const title = page.locator("#content h1");
  await expect(title).toHaveClass(/note-title/);
  await expect(title).toHaveAttribute("id", "long-note");
  // Directly in the page: no section, fold, rail or summary around it.
  expect(
    await title.evaluate((h) => [
      h.parentElement.id,
      Boolean(h.querySelector(".fold, .section-summary")),
    ]),
  ).toEqual(["content", false]);
  await expect(
    page.locator("#content .note-section[data-level='1']"),
  ).toHaveCount(0);
  // The `##` sections are the top level: no inset, still foldable.
  const alpha = page
    .locator("#content > .note-section[data-level='2']")
    .first();
  await expect(alpha).toHaveAttribute("data-fold-key", "alpha");
  expect(await alpha.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe(
    "0px",
  );
  // Old folds of the title's section are let go; a section fold is kept.
  await alpha.locator(":scope > h2 > .fold").click();
  await expect(alpha).toHaveClass(/collapsed/);
  await alpha.locator(":scope > h2 > .fold").click();
  await expect(alpha).not.toHaveClass(/collapsed/);
});

test("several level-one headings stay foldable sections", async ({ page }) => {
  await boot(page, "# Part I\n\nOne.\n\n## a\n\nText.\n\n# Part II\n\nTwo.\n");
  await expect(
    page.locator("#content > .note-section[data-level='1']"),
  ).toHaveCount(2);
  await expect(page.locator("#content .note-title")).toHaveCount(0);
  await expect(entries(page)).toHaveText(["Part I", "a", "Part II"]);
  await expect(entries(page).nth(1)).toHaveAttribute("data-depth", "1");
});

test("the outline leaves out the title, indents from the shallowest level and marks where the reader is", async ({
  page,
}) => {
  await boot(page);
  await expect(entries(page)).toHaveText([
    "Alpha",
    "Alpha one",
    "Beta",
    "Gamma",
  ]);
  const depths = await entries(page).evaluateAll((list) =>
    list.map((b) => [b.dataset.depth, b.style.paddingLeft]),
  );
  expect(depths).toEqual([
    ["0", "12px"],
    ["1", "24px"],
    ["0", "12px"],
    ["0", "12px"],
  ]);
  // Quiet levels: the top one a little firmer.
  const weights = await entries(page).evaluateAll((list) =>
    list.map((b) => getComputedStyle(b).fontWeight),
  );
  expect(weights).toEqual(["500", "400", "500", "500"]);
  // At the top, nothing is marked yet; scrolled to Beta, Beta is.
  await expect(outline(page).locator("[aria-current]")).toHaveCount(0);
  await page.locator("#content h2", { hasText: "Beta" }).evaluate((h) => {
    const reader = document.querySelector("#reader");
    reader.scrollTop +=
      h.getBoundingClientRect().top - reader.getBoundingClientRect().top - 10;
  });
  await expect(outline(page).locator('[aria-current="location"]')).toHaveText(
    "Beta",
  );
  // A little further back: Alpha one.
  await page.locator("#content h3", { hasText: "Alpha one" }).evaluate((h) => {
    const reader = document.querySelector("#reader");
    reader.scrollTop +=
      h.getBoundingClientRect().top - reader.getBoundingClientRect().top + 60;
  });
  await expect(outline(page).locator('[aria-current="location"]')).toHaveText(
    "Alpha one",
  );
  // Gamma, near the end, cannot reach the top: clicked, it stays marked.
  await entries(page).filter({ hasText: "Gamma" }).click();
  await page.waitForTimeout(600);
  await expect(outline(page).locator('[aria-current="location"]')).toHaveText(
    "Gamma",
  );
  // Scrolled by hand, the place read decides again.
  await page.locator("#reader").hover();
  await page.mouse.wheel(0, -1200);
  await expect(
    outline(page).locator('[aria-current="location"]'),
  ).not.toHaveText("Gamma");
});

test("in Edit mode the outline marks the section being edited", async ({
  page,
}) => {
  await boot(page, long, { richEdit: true, editSplit: false });
  await page.keyboard.press("Control+2");
  const editor = page.locator("#rich .ProseMirror");
  await expect(editor.locator("h2", { hasText: "Beta" })).toBeVisible();
  await editor.locator("h2", { hasText: "Beta" }).evaluate((h) => {
    const pane = document.querySelector("#rich-reader");
    pane.scrollTop +=
      h.getBoundingClientRect().top - pane.getBoundingClientRect().top - 10;
  });
  await expect(outline(page).locator('[aria-current="location"]')).toHaveText(
    "Beta",
  );
});

test("an anchor before the first section is listed at the top, at the top level", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("combobox", { name: "目录中的引用点" })
    .selectOption("all");
  await page.getByRole("button", { name: "关闭设置" }).click();
  const order = await outline(page)
    .locator(":scope > button")
    .evaluateAll((list) =>
      list.map((b) => [
        b.dataset.anchor || b.textContent.trim(),
        b.style.paddingLeft,
      ]),
    );
  expect(order).toEqual([
    ["intro-anchor", "12px"],
    ["Alpha", "12px"],
    ["Alpha one", "24px"],
    ["Beta", "12px"],
    ["Gamma", "12px"],
  ]);
});

test("an empty outline says so in the interface's language", async ({
  page,
}) => {
  await boot(page, "# Only a title\n\nText.\n");
  await expect(entries(page)).toHaveCount(0);
  expect(
    await outline(page).evaluate(
      (nav) => getComputedStyle(nav, "::after").content,
    ),
  ).toBe('"暂无标题"');
});

test("an index file's outline lists two levels of entries and scrolls to their rows", async ({
  page,
}) => {
  await setupIndex(page, { outline: true });
  // Its title left out; two levels of entries, the appendix heading in its
  // place with its entries under it.
  await expect(entries(page)).toHaveText([
    "第一章 实数",
    "1.1 有理数的稠密性",
    "1.2 确界原理",
    "第二章 数列极限",
    "2.1 收敛的定义",
    "2.2 单调有界定理",
    "第三章 函数极限",
    "附录",
    "符号表",
    "参考书目",
  ]);
  const depths = await entries(page).evaluateAll((list) =>
    list.map((b) => b.dataset.depth),
  );
  expect(depths).toEqual(["0", "1", "1", "0", "1", "1", "0", "0", "1", "1"]);
  // A click scrolls to the row (folded entries above it unfolded); the page
  // does not open.
  await item(page, "第一章 实数")
    .locator(":scope > .ix-row > .ix-twisty")
    .click();
  await expect(item(page, "第一章 实数")).toHaveClass(/closed/);
  await entries(page).filter({ hasText: "1.2 确界原理" }).click();
  await expect(item(page, "第一章 实数")).not.toHaveClass(/closed/);
  await expect(row(page, "1.2 确界原理")).toBeInViewport();
  await expect(outline(page).locator('[aria-current="location"]')).toHaveText(
    "1.2 确界原理",
  );
  expect(await page.evaluate(() => window.mock.opened)).toEqual([]);
  await expect(page.getByRole("tab")).toHaveCount(1);
});

test("an index file's guide lines fold its entries, as section lines do", async ({
  page,
}) => {
  await setupIndex(page);
  const chapter = item(page, "第一章 实数");
  const rail = chapter.locator(":scope > .ix-children > .ix-rail");
  await expect(rail).toHaveAttribute("aria-expanded", "true");
  // The line is drawn as a section's: 1px, the same quiet ink.
  const [line, section] = await page.evaluate(() => {
    const el = document.querySelector("#content .ix-rail");
    const style = getComputedStyle(el, "::before");
    const probe = document.createElement("section");
    probe.className = "note-section";
    document.querySelector("#content").append(probe);
    const guide = getComputedStyle(probe).getPropertyValue("--section-guide");
    probe.remove();
    return [
      [style.width, style.backgroundColor],
      getComputedStyle(el.closest(".ix-item")).getPropertyValue(
        "--section-guide",
      ) === guide,
    ];
  });
  expect(line[0]).toBe("1px");
  expect(section).toBe(true);
  // Pointing at the entry marks its arrow and line with the accent.
  await row(page, "1.1 有理数的稠密性").hover();
  await expect(chapter).toHaveClass(/section-hover/);
  // A click on the line folds the entry's pages; on the arrow, unfolds.
  const box = await rail.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(chapter).toHaveClass(/closed/);
  await expect(row(page, "1.1 有理数的稠密性")).toBeHidden();
  await expect(
    chapter.locator(":scope > .ix-row > .ix-twisty"),
  ).toHaveAttribute("aria-expanded", "false");
  // Kept like a section's fold: with the tab, through another rendering.
  await expect
    .poll(() =>
      page.evaluate(() => window.mock.session?.tabs?.[0]?.folds ?? []),
    )
    .toContain("ix:第一章 实数.md");
  await page.keyboard.press("Control+3");
  await page.keyboard.press("Control+1");
  await expect(item(page, "第一章 实数")).toHaveClass(/closed/);
  await item(page, "第一章 实数")
    .locator(":scope > .ix-row > .ix-twisty")
    .click();
  await expect(item(page, "第一章 实数")).not.toHaveClass(/closed/);
  // The keys too: the entry focused, ← folds and → unfolds.
  await item(page, "第二章").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "第二章")).toHaveClass(/closed/);
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "第二章")).not.toHaveClass(/closed/);
});

test("folding the last section of an index file leaves its footer shown", async ({
  page,
}) => {
  await setupIndex(page);
  const footer = page.locator("#content .ix-footer");
  await expect(footer).toBeVisible();
  expect(await footer.evaluate((el) => el.parentElement.id)).toBe("content");
  await page
    .locator("#content .note-section[data-level='2'] > h2 > .fold")
    .click();
  await expect(footer).toBeVisible();
  // The index's title is no section either.
  await expect(page.locator("#content h1")).toHaveClass(/note-title/);
  expect(indexText).toContain("# 数学分析");
});
