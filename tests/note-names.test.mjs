import test from "node:test";
import assert from "node:assert/strict";
import {
  leadingHeading,
  plainTitle,
  safeBase,
  safeFileName,
  numberedName,
  fileMatches,
  headingAnchor,
  frontTitle,
  setNoteName,
} from "../desktop/note-names.mjs";
import { rewriteLinks } from "../desktop/link-rewrite.mjs";
import { renameInIndex } from "../desktop/folder-index.mjs";

test("a note's name is its leading level-1 heading, after the front matter", () => {
  assert.equal(leadingHeading("# 集合与映射\n\n正文").title, "集合与映射");
  assert.equal(
    leadingHeading("\uFEFF---\ntitle: x\n---\n\n#   第一章：极限  #\n").raw,
    "第一章：极限",
  );
  assert.equal(leadingHeading("Setext\n===\n").title, "Setext");
  // Something else first, a level-2 heading, an empty heading: no name.
  assert.equal(leadingHeading("正文\n\n# 后来的标题"), null);
  assert.equal(leadingHeading("## 二级"), null);
  assert.equal(leadingHeading("#\n"), null);
  assert.equal(leadingHeading("#标签"), null);
  assert.equal(leadingHeading(""), null);
});

test("a heading's markup is left out of the name", () => {
  assert.equal(plainTitle("关于 $x^2$ 的**性质**"), "关于 x^2 的性质");
  assert.equal(
    plainTitle("[链接](a.md) 与 `code` 与 <b>粗</b>"),
    "链接 与 code 与 粗",
  );
  assert.equal(
    plainTitle("a\\*b\\_c *斜体* snake_case"),
    "a*b_c 斜体 snake_case",
  );
  assert.equal(plainTitle("价格 $5 和 $6"), "价格 $5 和 $6");
  assert.equal(plainTitle("![图](a.png)标题"), "标题");
});

test("names become file names Windows accepts", () => {
  assert.equal(
    safeBase('第一章: 集合/映射 <定义> "A|B"?*'),
    "第一章： 集合／映射 ＜定义＞ ＂A｜B＂？＊",
  );
  assert.equal(safeBase("a\\b"), "a＼b");
  assert.equal(safeBase("结尾的点. . "), "结尾的点");
  assert.equal(safeBase(".隐藏"), "．隐藏");
  assert.equal(safeBase("CON"), "CON_");
  assert.equal(safeBase("nul.txt"), "nul_.txt");
  assert.equal(safeBase("com1"), "com1_");
  assert.equal(safeBase("Console"), "Console");
  assert.equal(safeBase("a\tb\u0001c"), "a bc");
  assert.equal(safeBase("   "), "");
  assert.equal([...safeBase("字".repeat(300))].length, 120);
  assert.equal(safeBase("abc. def", 4), "abc");
  assert.equal(safeFileName("1.2 映射"), "1.2 映射.md");
  assert.equal(safeFileName(""), "");
  assert.equal(numberedName("映射.md", 2), "映射 (2).md");
  assert.equal(numberedName("文件夹", 3), "文件夹 (3)");
});

test("a file name made from the title counts as the same name", () => {
  assert.ok(fileMatches("第一章：极限", "第一章：极限.md"));
  assert.ok(fileMatches("A: B", "A： B.md"));
  assert.ok(fileMatches("Plan", "plan.md"));
  assert.ok(!fileMatches("第一章：集合与映射", "第一章_集合与映射.md"));
  assert.ok(!fileMatches("映射", "映射 (2).md"));
});

test("the heading's anchor is the renderer's", () => {
  assert.equal(headingAnchor("第一章：集合与映射"), "第一章集合与映射");
  assert.equal(headingAnchor("Road <em>map</em>"), "road-map");
});

test("a note's name set: its heading, and its front-matter title when it has one", () => {
  const note =
    "---\r\ntitle: 旧名\r\ntags: [a]\r\n---\r\n\r\n# 旧名\r\n\r\n正文\r\n";
  assert.equal(
    setNoteName(note, { heading: "新名: 一", title: "新名: 一" }),
    '---\r\ntitle: "新名: 一"\r\ntags: [a]\r\n---\r\n\r\n# 新名: 一\r\n\r\n正文\r\n',
  );
  assert.deepEqual(frontTitle('---\ntitle: "a \\"b\\""\n---\n'), {
    line: 1,
    value: 'a "b"',
  });
  // No front-matter title is ever added; a setext heading keeps its form.
  assert.equal(setNoteName("# A\n", { heading: "A", title: "A" }), null);
  assert.equal(setNoteName("A\n===\n", { heading: "B" }), "B\n===\n");
  // A note without a heading gets one only when asked.
  assert.equal(setNoteName("正文\n", { heading: "名字" }), null);
  assert.equal(
    setNoteName("---\na: 1\n---\n正文\n", { heading: "名字", insert: true }),
    "---\na: 1\n---\n# 名字\n\n正文\n",
  );
  assert.equal(setNoteName("", { heading: "空", insert: true }), "# 空\n");
  assert.equal(setNoteName("\uFEFF# 甲\n", { heading: "乙" }), "\uFEFF# 乙\n");
});

test("links to a renamed heading's anchor follow it, wherever they are", () => {
  const moves = [["C:/kb/旧.md", "C:/kb/新.md"]];
  const anchors = [{ file: "C:/kb/新.md", from: "旧", to: "新" }];
  const other = rewriteLinks(
    "[a](旧.md#旧) [b](%E6%97%A7.md#%E6%97%A7) [c](旧.md#别处) [d](其他.md#旧)",
    { file: "C:/kb/其他.md", moves, anchors },
  ).text;
  assert.equal(
    other,
    "[a](新.md#新) [b](%E6%96%B0.md#%E6%96%B0) [c](新.md#别处) [d](其他.md#旧)",
  );
  // Only the anchor changing (the file kept its name): the path as written.
  assert.equal(
    rewriteLinks('[a](./sub/../旧.md#旧 "t")', {
      file: "C:/kb/x.md",
      anchors: [{ file: "C:/kb/旧.md", from: "旧", to: "新" }],
    }).text,
    '[a](./sub/../旧.md#新 "t")',
  );
  // The note's own links to its heading.
  assert.equal(
    rewriteLinks("[top](#旧) [x](#其他)", {
      file: "C:/kb/新.md",
      from: "C:/kb/旧.md",
      moves,
      anchors,
    }).text,
    "[top](#新) [x](#其他)",
  );
});

test("an index entry follows a rename: its link and its text, the note's name", () => {
  const index =
    "- [第一章：集合与映射](第一章_集合与映射.md)\n  - [映射](1.2%20映射.md#定义)\n";
  assert.equal(
    renameInIndex(index, "1.2 映射.md", "1.2 映射与函数.md", "1.2 映射与函数"),
    "- [第一章：集合与映射](第一章_集合与映射.md)\n  - [1.2 映射与函数](1.2%20映射与函数.md#定义)\n",
  );
  // The same file name, a new name: only the text.
  assert.equal(
    renameInIndex(
      index,
      "第一章_集合与映射.md",
      "第一章_集合与映射.md",
      "第一章 [集合]",
    ),
    "- [第一章 \\[集合\\]](第一章_集合与映射.md)\n  - [映射](1.2%20映射.md#定义)\n",
  );
  // Without a name: a text of its own stays (as before).
  assert.equal(
    renameInIndex(index, "1.2 映射.md", "映射2.md"),
    "- [第一章：集合与映射](第一章_集合与映射.md)\n  - [映射](映射2.md#定义)\n",
  );
});
