// A synthetic OneNote-style notebook folder for the index view specs
// (index-view.spec.js) and its screenshots: an index file with front
// matter, a title, intro text, a comment, three levels of pages, a missing
// page, a second list under a heading, and files the index does not list.
import { expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

export const indexText = [
  "---",
  "title: 数学分析",
  "onenote_id: 0-7F3A",
  "level: 0",
  "---",
  "# 数学分析",
  "",
  "本笔记本按章节整理课堂笔记，顺序与 OneNote 中一致。",
  "",
  "<!-- 由 OneNote 导出生成 -->",
  "",
  "- [第一章 实数](第一章%20实数.md)",
  "  - [1.1 有理数的稠密性](1.1%20有理数的稠密性.md)",
  "  - [1.2 确界原理](1.2%20确界原理.md)",
  "    - [例题：确界的计算](例题%20确界的计算.md)",
  "- [第二章 数列极限](第二章%20数列极限.md)",
  "  - [2.1 收敛的定义](2.1%20收敛的定义.md)",
  "  - [2.2 单调有界定理](单调有界.md)",
  "- [第三章 函数极限](第三章%20函数极限.md)",
  "",
  "## 附录",
  "",
  "- [符号表](符号表.md)",
  "- [参考书目](books.md)",
  "",
].join("\n");

// The folder's notes and their first lines.
export const pages = {
  "第一章 实数.md":
    "# 第一章 实数\n\n从有理数出发，构造实数并讨论它的完备性。\n",
  "1.1 有理数的稠密性.md":
    "# 1.1 有理数的稠密性\n\n任意两个实数之间都有有理数。证明用阿基米德性质。\n",
  "1.2 确界原理.md":
    "---\nonenote_id: 0-1\n---\n# 1.2 确界原理\n\n非空有上界的数集必有上确界。\n",
  "例题 确界的计算.md": "# 例题\n\n求集合 $\\{1-1/n\\}$ 的上确界与下确界。\n",
  "第二章 数列极限.md":
    "# 第二章\n\n数列极限的 ε-N 语言，以及收敛数列的性质。\n",
  "2.1 收敛的定义.md": "# 2.1\n\n对任意 ε>0，存在 N，使 n>N 时 |aₙ−a|<ε。\n",
  "第三章 函数极限.md": "# 第三章\n\n函数在一点的极限与单侧极限。\n",
  "符号表.md": "# 符号表\n\n本笔记本使用的记号一览。\n",
  "books.md": "# 参考书目\n\n课程使用的教材与参考书。\n",
  "习题课 3.md": "# 习题课 3\n\n第三周习题讲解。\n",
  "期中复习.md": "# 期中复习\n\n期中考试范围与重点。\n",
};

export async function setup(
  page,
  settings = {},
  text = indexText,
  { roots = [], wait = true } = {},
) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, pages, settings, roots }) => {
      const folder = "C:/kb/数学分析/";
      window.mock = {
        handlers: {},
        saved: [],
        created: [],
        opened: [],
        pages: { ...pages },
      };
      const listing = () => [
        {
          name: "_目录.md",
          path: folder + "_目录.md",
          parent: "nb",
          directory: false,
          index: true,
        },
        { name: "图片", path: folder + "图片", id: "img", directory: true },
        ...Object.keys(window.mock.pages).map((name) => ({
          name,
          path: folder + name,
          parent: "nb",
          directory: false,
        })),
      ];
      const doc = (id, name, body) => ({
        id,
        path: folder + name,
        name,
        text: body,
        version: "v1",
      });
      const nameOf = (href) => decodeURIComponent(href.replace(/[#?].*$/, ""));
      window.folio = folioTest.mock({
        ready: async () => ({
          restored: [],
          incoming: [doc("index", "_目录.md", text)],
          roots,
          settings: {
            sidebar: false,
            outline: false,
            richEdit: true,
            editSplit: false,
            ...settings,
          },
        }),
        read: async () => ({ unchanged: true }),
        save: async (id, body, version) => {
          window.mock.saved.push({ id, text: body });
          return { version: version + "s" };
        },
        currentFolder: async () => ({
          id: "nb",
          name: "数学分析",
          path: "C:/kb/数学分析",
        }),
        list: async (id) => (id === "nb" ? listing() : []),
        preview: async (_id, href) => {
          const name = nameOf(href);
          if (!(name in window.mock.pages)) throw Error("missing");
          return doc("p:" + name, name, window.mock.pages[name]);
        },
        link: async (_id, href) => {
          const name = nameOf(href);
          window.mock.opened.push(name);
          if (!(name in window.mock.pages)) throw Error("找不到目标文件");
          return doc("p:" + name, name, window.mock.pages[name]);
        },
        createEntry: async (id, name, kind, body) => {
          window.mock.created.push({ id, name, kind, text: body });
          if (kind === "folder")
            return {
              id: "f:" + name,
              name,
              path: folder + name,
              directory: true,
            };
          window.mock.pages[name] = body;
          return doc("p:" + name, name, body);
        },
      });
    },
    { text, pages, settings, roots },
  );
  await page.goto("/");
  if (!wait) return;
  await expect(page.locator("#content .ix-list").first()).toBeVisible();
  // The folder is read and the pages' first sentences are in.
  await expect(row(page, "第一章 实数").locator(".ix-excerpt")).toBeVisible();
}
// The row of the entry with this title.
export const item = (page, title) =>
  page
    .locator("#content .ix-item")
    .filter({
      has: page.locator(":scope > .ix-row > .ix-title", { hasText: title }),
    })
    .first();
export const row = (page, title) =>
  item(page, title).locator(":scope > .ix-row");
// The note's text as saving would write it.
export async function saved(page) {
  const before = await page.evaluate(() => window.mock.saved.length);
  await page.keyboard.press("Control+s");
  await expect
    .poll(() => page.evaluate(() => window.mock.saved.length))
    .toBeGreaterThan(before);
  return page.evaluate(() => window.mock.saved.at(-1).text);
}
