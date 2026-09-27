import test from "node:test";
import assert from "node:assert/strict";
import { markdownEdit } from "../src/markdown-edits.js";
const edit = (text, from, to, action, options) => {
  const result = markdownEdit(text, from, to, action, options),
    c = result.changes;
  return {
    text: text.slice(0, c.from) + c.insert + text.slice(c.to),
    ...result,
  };
};
test("highlight and color preserve formatting, replace wrappers, clear safely and reject CSS injection", () => {
  const first = edit("中文 **bold**", 0, 11, "color", { color: "#b23c36" });
  assert.equal(first.text, '<span style="color: #b23c36">中文 **bold**</span>');
  const next = edit(
    first.text,
    first.selection.anchor,
    first.selection.head,
    "color",
    { color: "#286ba0" },
  );
  assert.equal(next.text, '<span style="color: #286ba0">中文 **bold**</span>');
  assert.equal(
    edit(next.text, next.selection.anchor, next.selection.head, "color", {
      color: null,
    }).text,
    "中文 **bold**",
  );
  assert.equal(
    edit('<span title="keep">other</span>', 0, 31, "color", { color: null })
      .text,
    '<span title="keep">other</span>',
  );
  const mark = edit("中", 0, 1, "highlight", { color: "#f2d878" });
  assert.match(
    mark.text,
    /^<mark style="background-color: #f2d878; color: #000000">中<\/mark>$/,
  );
  assert.equal(
    edit(mark.text, 0, mark.text.length, "highlight", { color: null }).text,
    "中",
  );
  assert.match(
    edit("", 0, 0, "highlight", { color: "#000000" }).text,
    /color: #ffffff/,
  );
  assert.match(
    edit("# Head\n\n- one", 0, 13, "highlight", { color: "#f2d878" }).text,
    /^# <mark.*Head<\/mark>\n\n- <mark.*one<\/mark>$/,
  );
  assert.throws(
    () => edit("test", 0, 4, "color", { color: "red;position:fixed" }),
    /颜色/,
  );
});
test("mapped inline colors keep multiline formulas atomic and clear losslessly", () => {
  const source = "文字 $a+\nb$ 与 \\(\\alpha+\\beta\\) 结尾";
  for (const action of ["color", "highlight"]) {
    const result = edit(source, 0, source.length, action, {
      color: "#f2d878",
      inlineRange: true,
    });
    assert.equal((result.text.match(/<(?:span|mark) /g) || []).length, 1);
    assert.ok(result.text.includes(source));
    assert.equal(
      edit(
        result.text,
        result.selection.anchor,
        result.selection.head,
        action,
        {
          color: null,
          inlineRange: true,
        },
      ).text,
      source,
    );
  }
});
test("inline formats preserve Chinese selection and toggle without nesting", () => {
  const first = edit("a中文z", 1, 3, "bold");
  assert.equal(first.text, "a**中文**z");
  assert.deepEqual(first.selection, { anchor: 3, head: 5 });
  assert.equal(edit(first.text, 3, 5, "bold").text, "a中文z");
  assert.equal(edit("**中文**", 0, 6, "bold").text, "中文");
  assert.equal(edit("", 0, 0, "italic").text, "*文字*");
  assert.equal(edit("a`b", 0, 3, "inline").text, "``a`b``");
  assert.equal(edit("**hello**", 2, 7, "italic").text, "***hello***");
  assert.equal(edit("***hello***", 3, 8, "italic").text, "**hello**");
  assert.equal(edit("**hello**", 0, 9, "italic").text, "***hello***");
});
test("multi-line colors change and clear without losing block structure or leaving tags", () => {
  const source = "## Heading\n\n- first\n- second";
  const marked = edit(source, 0, source.length, "highlight", {
    color: "#f2d878",
  }).text;
  assert.equal(
    edit(marked, 0, marked.length, "highlight", { color: null }).text,
    source,
  );
  const recolored = edit(marked, 0, marked.length, "highlight", {
    color: "#efc4d1",
  }).text;
  assert.equal((recolored.match(/<mark /g) || []).length, 3);
  assert.equal(
    edit(recolored, 0, recolored.length, "highlight", { color: null }).text,
    source,
  );
});
test("line formats convert lists, preserve indentation and exclude next line", () => {
  assert.equal(
    edit("one\ntwo\nthree", 0, 8, "ordered").text,
    "1. one\n2. two\nthree",
  );
  assert.equal(
    edit("  - one\n  - two", 0, 15, "task").text,
    "  - [ ] one\n  - [ ] two",
  );
  assert.equal(edit("- [x] one\n- [ ] two", 0, 19, "task").text, "one\ntwo");
  assert.equal(edit("", 0, 0, "bullet").text, "- ");
  assert.equal(edit("\nabc", 0, 0, "heading", { level: 2 }).text, "## \nabc");
  assert.equal(
    edit("### Title", 4, 9, "heading", { level: 1 }).text,
    "# Title",
  );
  assert.equal(edit("> quote", 0, 7, "quote").text, "quote");
});
test("inserted block fences cannot be closed by selected code", () => {
  assert.equal(
    edit("```\ntext", 0, 8, "code", { language: "markdown" }).text,
    "````markdown\n```\ntext\n````\n",
  );
  assert.equal(
    edit("beforeAFTER", 6, 6, "math").text,
    "before\n\n$$\nx^2\n$$\n\nAFTER",
  );
});
test("links escape labels and paths and reject executable schemes", () => {
  assert.equal(
    edit("hello", 0, 5, "link", {
      url: "chapter 2.md#标题",
      label: "[chapter]",
    }).text,
    "[\\[chapter\\]](<chapter%202.md#标题>)",
  );
  assert.match(
    edit("", 0, 0, "image", { url: "assets/my image.png" }).text,
    /^!\[图片\]\(<assets\/my%20image.png>\)/,
  );
  assert.throws(
    () => edit("", 0, 0, "link", { url: "javascript:alert(1)" }),
    /有效/,
  );
});
test("table sizes are bounded and the first header remains selected", () => {
  const table = edit("", 0, 0, "table", { columns: 2, rows: 1 });
  assert.equal(table.text, "| 列 1 | 列 2 |\n| --- | --- |\n|   |   |\n");
  assert.equal(
    table.text.slice(table.selection.anchor, table.selection.head),
    "列 1",
  );
  assert.throws(() => edit("", 0, 0, "table", { columns: 1000, rows: 3 }));
});
