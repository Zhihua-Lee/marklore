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
