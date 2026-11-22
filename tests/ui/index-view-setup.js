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

// A larger OneNote export (four levels, 40 entries, a missing page, files
// not listed) for the look of a long index and dragging across it:
// [depth, title, file name (by default the title), first sentence].
const notebook = [
  [0, "第一部分 数学基础", "", "量子力学需要的线性代数与泛函分析。"],
  [1, "1 希尔伯特空间", "", "有内积、完备的向量空间，量子态住在这里。"],
  [2, "1.1 内积与范数", "", "内积给出长度与角度，范数由内积导出。"],
  [2, "1.2 完备性", "", "柯西序列都收敛：极限不会跑出空间之外。"],
  [3, "例：L² 空间", "例 L2空间", "平方可积函数构成的空间，是波函数的家。"],
  [3, "例：序列空间 ℓ²", "例 序列空间", "平方可和的复数序列，与 L² 同构。"],
  [2, "1.3 正交基", "", "可数正交基让每个态都能按分量展开。"],
  [1, "2 算符", "", "可观测量对应线性算符，测量结果是本征值。"],
  [2, "2.1 线性算符", "", "保持线性组合的映射，有界与无界要分开讨论。"],
  [
    2,
    "2.2 厄米算符与本征值",
    "2.2 厄米算符",
    "厄米算符的本征值为实数，本征向量正交。",
  ],
  [
    3,
    "证明：本征值为实数",
    "证明 本征值为实数",
    "对本征方程两边取内积并比较共轭。",
  ],
  [2, "2.3 对易子", "", "[A,B]=AB−BA 衡量两个测量能否同时确定。"],
  [1, "3 狄拉克符号", "", "左矢与右矢：一套不依赖表象的记法。"],
  [0, "第二部分 波动力学", "", "从薛定谔方程出发求解具体的势。"],
  [1, "4 薛定谔方程", "", "态随时间的演化由哈密顿量决定。"],
  [2, "4.1 定态", "", "分离变量后得到不含时的本征方程。"],
  [2, "4.2 概率流", "", "连续性方程保证总概率守恒。"],
  [1, "5 一维问题", "", "几个能解析求解的模型，后面反复用到。"],
  [2, "5.1 无限深势阱", "", "能级与 n² 成正比，波函数是正弦函数。"],
  [2, "5.2 有限深势阱", "", null],
  [2, "5.3 谐振子", "", "能级等间距，基态能量不为零。"],
  [3, "代数解法", "", "用升降算符构造全部本征态，不解微分方程。"],
  [
    3,
    "解析解法：厄米多项式",
    "hermite",
    "幂级数截断给出量子化条件与厄米多项式。",
  ],
  [2, "5.4 势垒与隧穿", "", "能量低于势垒时透射系数仍不为零，随宽度指数衰减。"],
  [1, "6 不确定关系", "", "两个不对易的可观测量不能同时精确测定。"],
  [0, "第三部分 角动量与氢原子", "", "三维问题、中心力场与自旋。"],
  [1, "7 角动量", "", "对易关系决定了角动量的全部代数结构。"],
  [2, "7.1 升降算符", "", "L± 在同一 l 的多重态里上下移动 m。"],
  [2, "7.2 球谐函数", "", "角动量本征函数在球面上的表示。"],
  [1, "8 氢原子", "", "库仑势下的径向方程，能级只依赖主量子数。"],
  [2, "8.1 径向方程", "", "有效势中加入离心项，渐近行为决定解的形式。"],
  [2, "8.2 能级与简并", "", "能级简并度为 n²，来自隐藏的对称性。"],
  [1, "9 自旋", "", "没有经典对应的内禀角动量，用泡利矩阵描述。"],
  [0, "第四部分 近似方法", "", "无法精确求解时的系统做法。"],
  [1, "10 微扰论", "", "把哈密顿量拆成可解部分加上小的修正。"],
  [2, "10.1 非简并微扰", "", "一阶能量修正是微扰在零阶态上的期望值。"],
  [2, "10.2 简并微扰", "", "先在简并子空间里对角化微扰。"],
  [1, "11 变分法", "", "任何试探态给出基态能量的上界。"],
];
export const onenotePages = {
  "随堂测验 3.md": "# 随堂测验 3\n\n第三周测验题与答案。\n",
  "期末复习提纲.md": "# 期末复习提纲\n\n考试范围与重点题型。\n",
  "未命名页面.md": "# 未命名页面\n\n\n",
};
const listed = [];
for (const [depth, title, file, first] of notebook) {
  const name = (file || title) + ".md";
  if (first != null) onenotePages[name] = `# ${title}\n\n${first}\n`;
  listed.push(
    `${"  ".repeat(depth)}- [${title}](${name.replace(/ /g, "%20")})`,
  );
}
onenotePages["常用公式.md"] = "# 常用公式\n\n课程中反复出现的积分与恒等式。\n";
onenotePages["习题索引.md"] = "# 习题索引\n\n按章节列出的作业题。\n";
export const onenoteIndex = [
  "---",
  "title: 量子力学讲义",
  "onenote_id: 0-9B21",
  "---",
  "# 量子力学讲义",
  "",
  "课程笔记，按 OneNote 中的分区与页面排列。",
  "",
  "<!-- 由 OneNote 导出生成 -->",
  "",
  ...listed,
  "",
  "## 附录",
  "",
  "- [常用公式](常用公式.md)",
  "- [习题索引](习题索引.md)",
  "",
].join("\n");

export async function setup(
  page,
  settings = {},
  text = indexText,
  // folder: the folder's notes instead of `pages`.
  { roots = [], wait = true, noText = [], folder: notes = pages } = {},
) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, pages, settings, roots, noText }) => {
      const folder = "C:/kb/数学分析/";
      window.mock = {
        handlers: {},
        saved: [],
        created: [],
        opened: [],
        pages: { ...pages },
        // Pages main already knows (opened before): preview hands back
        // only their id, their text comes from read.
        noText,
        // Other folders' listings, by folder id.
        lists: {},
        // The number of links asked about in each linkStatus call.
        statusCalls: [],
        // Hrefs linkStatus reports as missing files.
        brokenHrefs: [],
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
        read: async (id) => {
          const name = String(id).replace(/^p:/, "");
          return window.mock.noText.includes(name)
            ? { text: window.mock.pages[name], version: "v1" }
            : { unchanged: true };
        },
        linkStatus: async (_id, hrefs) => {
          window.mock.statusCalls.push(hrefs.length);
          if (hrefs.length > 2000) throw Error("无效链接");
          return hrefs.map((href) =>
            window.mock.brokenHrefs.includes(href) ? "missing-file" : "ok",
          );
        },
        save: async (id, body, version) => {
          window.mock.saved.push({ id, text: body });
          return { version: version + "s" };
        },
        currentFolder: async () => ({
          id: "nb",
          name: "数学分析",
          path: "C:/kb/数学分析",
        }),
        list: async (id) =>
          id === "nb" ? listing() : (window.mock.lists[id] ?? []),
        preview: async (_id, href) => {
          const name = nameOf(href);
          if (!(name in window.mock.pages)) throw Error("missing");
          if (window.mock.noText.includes(name))
            return { id: "p:" + name, path: folder + name, name };
          return doc("p:" + name, name, window.mock.pages[name]);
        },
        link: async (_id, href) => {
          const name = nameOf(href);
          window.mock.opened.push(name);
          if (!(name in window.mock.pages)) throw Error("找不到目标文件");
          return doc("p:" + name, name, window.mock.pages[name]);
        },
        // The tree's repair candidates (window.mock.repair), when a spec
        // sets them; otherwise main cannot say.
        repairOptions: async (file, href) => {
          if (!window.mock.repair) throw Error("no repair");
          (window.mock.repairAsked ??= []).push([file, href]);
          return window.mock.repair;
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
    { text, pages: notes, settings, roots, noText },
  );
  await page.goto("/");
  if (!wait) return;
  await expect(page.locator("#content .ix-list").first()).toBeVisible();
  // The folder is read and the pages' first sentences are in.
  if (notes === pages)
    await expect(row(page, "第一章 实数").locator(".ix-excerpt")).toBeVisible();
  else await expect(page.locator("#content .ix-excerpt").first()).toBeVisible();
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
