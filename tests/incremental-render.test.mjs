import test from "node:test";
import assert from "node:assert/strict";
import { blockPieces, closedHtml } from "../src/markdown.js";
import { planEdit } from "../src/incremental-render.js";

// An edit renders again only the blocks it touched (src/incremental-render.js):
// parsed from the block before it until a block starts where an old one
// started, past the edit. The blocks so found, between the old ones before
// and after (their positions moved), must be exactly those of the whole
// note parsed again.

// Seeded, so a failure can be run again.
function random(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

const BLOCKS = [
  "A paragraph with **bold** and $x^2$ in it.",
  "Two lines\nof one paragraph, the second *lazy*.",
  "- item one\n- item two with $a_1$\n- item three",
  "- loose one\n\n- loose two\n\n  indented more",
  "1. first\n2. second\n   - nested\n3. third",
  "- [ ] task\n- [x] done",
  "| A | B |\n|---|---|\n| 1 | $a|b$ |\n| 2 | `x|y` |",
  "```js\nconst a = 1;\n\nlet b = `x`;\n```",
  "~~~\ncode | with pipe\n~~~",
  "$$\n\\sum_{k=0}^n k\n$$",
  "$$x = y$$",
  "\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}",
  "> a quote\n> on two lines\nlazy",
  "> quote\n\n> another",
  "    indented code\n\n    more code",
  "---",
  "Setext heading\n---",
  "## A heading",
  "# Title",
  'Text with <span style="color: #b23c36">colour</span> and <br> a break.',
  "<div>\nhtml block\n</div>",
  "A [link](https://example.com) and <https://auto.link> and www.example.com",
  "Escapes \\* and \\| and &amp; here.",
  "Term with `code` and ~~strike~~ and ==mark==.",
  "![image](pic.png) after",
  "+ plus list\n+ again",
  "  - indented list\n  - item",
  "\\[\nx + y\n\\]",
  "\\begin{aligned}\n\na &= b\n\n\\end{aligned}",
  "$$\n\nx\n\n$$",
  "<!-- a comment\n\nover a blank line -->",
  "<pre>\npre text\n\nmore\n</pre>",
  "<details><summary>s</summary>\n\nbody\n\n</details>",
  "Term\n===",
  "a | b\n--|--\n1 | 2",
  "***",
  "- item\nlazy line\n\n    code after a list",
];
const SNIPPETS = [
  "**",
  "*",
  "\n",
  "\n\n",
  "- ",
  "1. ",
  "```",
  "$$",
  "$",
  "|",
  "> ",
  "    ",
  "# ",
  "word",
  "---",
  "\n- x\n",
  "\n\n| a | b |\n|---|---|\n",
  "<b>",
  "</b>",
  "<span>",
  "[",
  "]",
  "\\",
  "\n```\n",
  "\\[",
  "\\]",
  "<!--",
  "-->",
  "\n===\n",
  "  \n",
];

function note(rnd) {
  const count = 3 + Math.floor(rnd() * 12);
  return Array.from({ length: count }, () => pick(rnd, BLOCKS)).join(
    rnd() < 0.85 ? "\n\n" : "\n",
  );
}
function edit(rnd, text) {
  const at = Math.floor(rnd() * (text.length + 1));
  const kind = rnd();
  if (kind < 0.35)
    return text.slice(0, at) + pick(rnd, SNIPPETS) + text.slice(at);
  if (kind < 0.6) {
    const end = Math.min(text.length, at + 1 + Math.floor(rnd() * 12));
    return text.slice(0, at) + text.slice(end);
  }
  if (kind < 0.75) {
    // Formatting a word: around it.
    const end = Math.min(text.length, at + 1 + Math.floor(rnd() * 8));
    const mark = pick(rnd, ["**", "*", "==", "~~", "`"]);
    return (
      text.slice(0, at) + mark + text.slice(at, end) + mark + text.slice(end)
    );
  }
  if (kind < 0.82) {
    // At a line's start: a marker that joins it to the block before or
    // splits a block; or the line break before it removed.
    const start = text.lastIndexOf("\n", at - 1) + 1;
    if (rnd() < 0.3 && start > 0)
      return text.slice(0, start - 1) + text.slice(start);
    return (
      text.slice(0, start) +
      pick(rnd, ["    ", "  ", "- ", "> ", "1. ", "$$\n", "```\n", "| x |\n"]) +
      text.slice(start)
    );
  }
  if (kind < 0.9) {
    // Pasting blocks.
    return (
      text.slice(0, at) +
      "\n\n" +
      pick(rnd, BLOCKS) +
      "\n\n" +
      pick(rnd, BLOCKS) +
      text.slice(at)
    );
  }
  return text.slice(0, at) + pick(rnd, "abc xyz".split("")) + text.slice(at);
}

const positions =
  / data-(?:text-|edit-|block-|cell-|src-(?:inner-)?)?(?:from|to)="(\d+)"/g;
const shifted = (html, delta) =>
  html.replace(positions, (m, n) => m.replace(n, String(Number(n) + delta)));
// Keys numbered within one render.
const plain = (html) =>
  html.replace(/ data-folio-(formula|edit)="[^"]*"/g, " data-folio-$1");

function check(before, after) {
  const old = blockPieces(before);
  if (!old) return "unsplit";
  const plan = planEdit(old, before, after);
  if (!plan) return "same";
  const window = { line: plan.line, stop: plan.stop };
  const pieces = blockPieces(after, window);
  if (!pieces) return "window";
  const last = plan.last(window.end);
  assert.notEqual(last, undefined);
  const removed = old.slice(plan.first, last);
  if (
    [...removed, ...pieces].some(
      (block) => block.heading || block.frontMatter || block.details,
    )
  )
    return "structure";
  const blocks = [
    ...old.slice(0, plan.first),
    ...pieces,
    ...old.slice(last).map((block) => ({
      ...block,
      from: block.from + plan.delta,
      to: block.to + plan.delta,
      line: block.line + plan.lines,
      endLine: block.endLine + plan.lines,
      html: shifted(block.html, plan.delta),
    })),
  ];
  const whole = blockPieces(after);
  const message = `${JSON.stringify(before)}\n→ ${JSON.stringify(after)}`;
  assert.ok(whole, message);
  const view = (list) =>
    list.map(({ from, to, line, endLine, type, html, formulas }) => ({
      from,
      to,
      line,
      endLine,
      type,
      formulas,
      html: plain(html),
    }));
  assert.deepEqual(view(blocks), view(whole), message);
  return "incremental";
}

test("an edit's blocks parsed again match the whole note parsed again", () => {
  const rnd = random(20261113);
  const outcomes = {};
  for (let n = 0; n < 300; n++) {
    let text = note(rnd);
    for (let k = 0; k < 8; k++) {
      const next = edit(rnd, text);
      const outcome = check(text, next);
      outcomes[outcome] = (outcomes[outcome] || 0) + 1;
      text = outcome === "unsplit" ? note(rnd) : next;
    }
  }
  console.log(JSON.stringify(outcomes));
  // Most edits are done in place; the test is not about the fallback.
  assert.ok(
    outcomes.incremental > 1200,
    `incremental only ${JSON.stringify(outcomes)}`,
  );
});

test("an edit at the note's start or end, and one that joins blocks", () => {
  for (const [before, after] of [
    ["para\n\n- a\n- b", "para\n- a\n- b"],
    ["para\n- a", "para\na"],
    ["para\n\n$$\nx\n$$\n\nnext", "para\n$$\nx\n\nnext"],
    ["- a\n\nb", "- a\n\n  b"],
    ["- a\n\nb", "- a\n\n- b"],
    ["    code\n\nb", "    code\n\n    b"],
    ["a\n\nb", "xa\n\nb"],
    ["a\n\nb", "a\n\nbx"],
    ["a\n\nb", "a\n\nb\n\nc"],
    ["a\n\nb", "\n\na\n\nb"],
    ["a\n\nb\n\n", "a\n\nb\n\n```"],
    ["| a |\n|---|\n| 1 |\n\nx", "| a |\n|---|\n| 1 |\nx"],
    ["text\n\n```\ncode\n```\n\nafter", "text\n\n```\ncode\n\nafter"],
    ["> q\n\nx", "> q\nx"],
  ])
    assert.equal(check(before, after), "incremental", before);
});

test("HTML that leaves an element open keeps the note whole", () => {
  assert.equal(closedHtml('<span style="color: red">'), false);
  assert.equal(closedHtml('<span style="color: red">x</span>'), true);
  assert.equal(closedHtml("<b><i></b></i>"), false);
  assert.equal(closedHtml("<br><img src=x>"), true);
  assert.equal(closedHtml("<!-- open"), false);
  assert.equal(closedHtml("<!-- a --><b>x</b>"), true);
  assert.equal(closedHtml("<script>x</script>"), false);
  assert.equal(closedHtml("a < b"), true);
  assert.equal(blockPieces("<div>\n\ntext\n\n</div>"), null);
  assert.equal(blockPieces("[a]: https://x\n\n[a]"), null);
  assert.equal(blockPieces("x[^1]\n\n[^1]: note"), null);
  assert.ok(blockPieces("<div>\nblock\n</div>\n\ntext"));
});
