import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseQuery, readable, searchNotes } from "../desktop/note-search.mjs";
import { createLinkIndex } from "../desktop/link-index.mjs";

const note = (name, text) => ({ path: "C:/kb/" + name, name, text });
const shown = (hit) => hit.snippet.map(([text]) => text).join("");
const marked = (hit) =>
  hit.snippet.filter(([, mark]) => mark).map(([text]) => text);

const fourier = note(
  "傅里叶分析.md",
  [
    "# 傅里叶分析",
    "",
    "## 定义",
    "",
    "对可积函数 $f(t)$，其**傅里叶变换**与逆变换为下式。",
    "",
    "## 离散实现",
    "",
    "快速傅里叶变换（FFT）把复杂度从 $O(N^2)$ 降到 $O(N \\log N)$。",
    "",
    "```python",
    "np.fft.fft(signal)  # FFT in code",
    "```",
    "",
    "参见 [卷积定理](卷积定理.md#定义)。",
  ].join("\n"),
);
const convolution = note(
  "卷积定理.md",
  "# 卷积定理\n\n时域卷积对应频域乘积，见傅里叶变换的性质。\n",
);
const reading = note("Reading-list.md", "# Reading\n\n- Signals and Systems\n");

test("queries: words, quoted phrases, case folded, no duplicates", () => {
  assert.deepEqual(parseQuery('  FFT  "Signals and" fft '), [
    "fft",
    "signals and",
  ]);
  assert.deepEqual(parseQuery(""), []);
});

test("readable lines drop Markdown markers but keep formulas", () => {
  assert.equal(
    readable("- [x] **粗体** 和 [链接](a.md#b) <mark>高亮</mark> `code`"),
    "粗体 和 链接 高亮 code",
  );
  assert.equal(
    readable("## 定义 $a_i^*$ snake_case"),
    "定义 $a_i^*$ snake_case",
  );
});

test("finds Chinese text without segmentation, with section and line", () => {
  const { results, total } = searchNotes(
    [fourier, convolution, reading],
    "傅里叶变换",
  );
  assert.equal(total, 2);
  const [first] = results;
  assert.equal(first.name, "傅里叶分析.md");
  const definition = first.hits.find((hit) => hit.line === 5);
  assert.equal(definition.section, "定义");
  assert.deepEqual(marked(definition), ["傅里叶变换"]);
  assert.match(
    shown(definition),
    /^对可积函数 \$f\(t\)\$，其傅里叶变换与逆变换为下式。$/,
  );
  // The column points into the raw line (after "**").
  assert.equal(definition.column, "对可积函数 $f(t)$，其**".length + 1);
});

test("every word must occur, in any line; case does not matter", () => {
  const { results } = searchNotes([fourier, convolution], "fft 复杂度");
  assert.deepEqual(
    results.map((r) => r.name),
    ["傅里叶分析.md"],
  );
  // The line holding both words comes first among the hits shown.
  const hit = results[0].hits.find((h) => h.line === 9);
  assert.deepEqual(marked(hit), ["FFT", "复杂度"]);
  assert.equal(searchNotes([fourier], "fft 不存在").total, 0);
});

test("code blocks are searched; headings and names rank first", () => {
  const code = searchNotes([fourier], "np.fft").results[0].hits;
  assert.equal(code[0].line, 12);
  const ranked = searchNotes([convolution, fourier], "卷积定理").results;
  // 卷积定理.md matches by name and in its heading.
  assert.equal(ranked[0].name, "卷积定理.md");
  assert.equal(ranked[0].nameHit, true);
  assert.equal(ranked[0].hits[0].heading, true);
});

test("a word only in a link target shows the link with its target", () => {
  const hit = searchNotes([fourier], "卷积定理.md").results[0].hits[0];
  assert.equal(shown(hit), "参见 卷积定理 (卷积定理.md#定义)。");
  assert.deepEqual(marked(hit), ["卷积定理.md"]);
});

test("table rows read as their cells", () => {
  assert.equal(readable("| 性质 | 时域 | 频域 |"), "性质 · 时域 · 频域");
  assert.equal(readable("| $a \\| b$ | x |"), "$a \\| b$ · x");
});

test("the extension never matches; long lines are cut around the hit", () => {
  assert.equal(searchNotes([reading], "md").total, 0);
  const long = note("long.md", "a".repeat(300) + " needle " + "b".repeat(300));
  const hit = searchNotes([long], "needle").results[0].hits[0];
  assert.equal(hit.snippet[0][0], "…");
  assert.equal(hit.snippet.at(-1)[0], "…");
  assert.ok(shown(hit).length < 160);
  assert.deepEqual(marked(hit), ["needle"]);
});

test("at most three hits per note and fifty notes", () => {
  const many = note("many.md", Array(20).fill("word").join("\n\n"));
  const result = searchNotes([many], "word").results[0];
  assert.equal(result.count, 20);
  assert.equal(result.hits.length, 3);
  const notes = Array.from({ length: 60 }, (_, i) => note(`n${i}.md`, "word"));
  const found = searchNotes(notes, "word");
  assert.equal(found.total, 60);
  assert.equal(found.results.length, 50);
});

test("the link index searches the library and knows its notes", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "folio-search-")),
  );
  await fs.writeFile(
    path.join(root, "a.md"),
    "# A\n\nThe Parseval identity.\n",
  );
  await fs.mkdir(path.join(root, "sub"));
  await fs.writeFile(path.join(root, "sub", "b.md"), "Nothing here.\n");
  const index = createLinkIndex();
  await index.follow([root]);
  const found = await index.search("parseval");
  assert.deepEqual(
    found.results.map((r) => r.path),
    [path.join(root, "a.md")],
  );
  assert.equal(index.has(path.join(root, "sub", "b.md")), true);
  assert.equal(index.has(path.join(os.tmpdir(), "elsewhere.md")), false);
  // A note written later is found once the index hears of it.
  await fs.writeFile(path.join(root, "sub", "b.md"), "Parseval again.\n");
  await index.changed(path.join(root, "sub", "b.md"));
  assert.equal((await index.search("parseval")).total, 2);
});
