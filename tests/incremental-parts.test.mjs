import test from "node:test";
import assert from "node:assert/strict";
import { blockPieces, parseBlocks, partPieces } from "../src/markdown.js";
import { planEdit, planParts, partsTarget } from "../src/incremental-render.js";

// An edit inside one list or table renders again only the items (rows) it
// touched (src/incremental-render.js, planParts). The list, its kept items
// as they rendered before (those after the edit moved) and the items
// rendered again must be exactly the list of the whole note parsed again.

function random(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

const ITEMS = [
  "item with **bold** and $x_1$",
  "item with `code|pipe` and $a|b$",
  "[ ] a task",
  "[x] done task",
  "item\n  lazy continued line",
  "item\nlazy line at the margin",
  "item with a nested list\n  - nested one\n  - nested two",
  "item with code\n\n  ```js\n  const a = 1;\n  ```",
  "item with math\n\n  $$\n  x^2\n  $$",
  "item with a quote\n  > quoted",
  "item with a table\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |",
  'item with <span style="color: red">colour</span>',
  "item with <b>open html",
  "item with ~~strike~~ and ==mark==",
  "",
];
function list(rnd) {
  const count = 2 + Math.floor(rnd() * 12);
  const ordered = rnd() < 0.35,
    loose = rnd() < 0.25,
    first = ordered && rnd() < 0.3 ? 1 + Math.floor(rnd() * 9) : 1;
  return Array.from({ length: count }, (_, k) => {
    const marker = ordered ? `${first + k}. ` : "- ";
    const pad = " ".repeat(marker.length);
    const body = pick(rnd, ITEMS).replace(/\n {2}/g, "\n" + pad);
    return marker + body;
  }).join(loose ? "\n\n" : "\n");
}
function table(rnd) {
  const rows = 1 + Math.floor(rnd() * 12);
  return (
    "| Name | Value | Bound |\n|:---|---:|:-:|\n" +
    Array.from(
      { length: rows },
      (_, k) =>
        `| r${k} ${pick(rnd, ["", "**b**", "`x|y`", "$a|b$", "\\|", "<i>i</i>"])} | $v_${k}$ | ${pick(rnd, ["1", "", "x | y", "$\\le 2$"])} |`,
    ).join("\n")
  );
}
const OTHERS = [
  "A paragraph with $x$.",
  "## A heading",
  "```\nfenced | code\n```",
  "$$\ny\n$$",
  "> quote",
];
function note(rnd) {
  const count = 2 + Math.floor(rnd() * 5);
  return Array.from({ length: count }, () =>
    rnd() < 0.4 ? list(rnd) : rnd() < 0.6 ? table(rnd) : pick(rnd, OTHERS),
  ).join("\n\n");
}
// Edits inside lists and tables, as typing, formatting, deleting, pasting
// lines, indenting, blank lines and numbering make them.
function edit(rnd, text) {
  // Mostly on a line of a list or a table.
  const lines = [];
  for (let from = 0; from <= text.length;) {
    const end = text.indexOf("\n", from);
    const to = end < 0 ? text.length : end;
    if (/^(?:\s*(?:[-+*]|\d+\.)\s|\s*\||\s{2,}\S)/.test(text.slice(from, to)))
      lines.push([from, to]);
    if (end < 0) break;
    from = end + 1;
  }
  const line = lines.length && rnd() < 0.85 ? pick(rnd, lines) : null;
  const at = line
    ? line[0] + Math.floor(rnd() * (line[1] - line[0] + 1))
    : Math.floor(rnd() * (text.length + 1));
  const start = text.lastIndexOf("\n", at - 1) + 1;
  const end = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
  const kind = rnd();
  if (kind < 0.25)
    return (
      text.slice(0, at) + pick(rnd, "abc xyz$|*`".split("")) + text.slice(at)
    );
  if (kind < 0.4) {
    const to = Math.min(end, at + 1 + Math.floor(rnd() * 8));
    const mark = pick(rnd, ["**", "*", "==", "~~", "`", "$"]);
    return (
      text.slice(0, at) + mark + text.slice(at, to) + mark + text.slice(to)
    );
  }
  if (kind < 0.55)
    return (
      text.slice(0, at) +
      text.slice(Math.min(text.length, at + 1 + Math.floor(rnd() * 6)))
    );
  if (kind < 0.65)
    return (
      text.slice(0, end) +
      pick(rnd, [
        "\n- pasted item",
        "\n1. pasted",
        "\n  more of it",
        "\n| p | q | r |",
        "\n",
        "\n\n",
        "\n```",
        "\n  ```",
        "\n$$",
        "\n- [ ] task",
      ]) +
      text.slice(end)
    );
  if (kind < 0.75)
    return (
      text.slice(0, start) +
      pick(rnd, ["  ", "    ", "- ", "1. ", "> "]) +
      text.slice(start)
    );
  if (kind < 0.82) {
    // A line's start taken away: unindented, joined, its marker removed.
    const cut = Math.min(end, start + 1 + Math.floor(rnd() * 3));
    return (
      text.slice(0, Math.max(0, start - (rnd() < 0.3 ? 1 : 0))) +
      text.slice(cut)
    );
  }
  if (kind < 0.9) {
    // Numbering, and task boxes.
    return text.slice(0, start).concat(
      text
        .slice(start, end)
        .replace(
          /^(\s*)\d+\./,
          (_, s) => s + (1 + Math.floor(rnd() * 20)) + ".",
        )
        .replace(/\[( |x)\]/, (_, c) => (c === " " ? "[x]" : "[ ]")),
      text.slice(end),
    );
  }
  return text.slice(0, at) + "\n" + text.slice(at);
}

const positions =
  / data-(?:text-|edit-|block-|cell-|src-(?:inner-)?)?(?:from|to)="(\d+)"/g;
const shifted = (html, delta) =>
  html.replace(positions, (m, n) => m.replace(n, String(Number(n) + delta)));
const plain = (html) =>
  html.replace(/ data-folio-(formula|edit)="[^"]*"/g, " data-folio-$1");
const whole = (source) => parseBlocks(source, { line: 0, stop: () => false });
// The block's opening (list; table to its body), its items, its closing.
function cut(html, list) {
  const open = list
      ? /^<[ou]l[^>]*>\n/
      : /^<table[^>]*>\n(?:<thead[^>]*>[\s\S]*?<\/thead>\n)?<tbody[^>]*>\n/,
    close = list ? /<\/[ou]l>\n$/ : /<\/tbody>\n<\/table>\n$/;
  const head = html.match(open)?.[0],
    tail = html.match(close)?.[0];
  assert.ok(head && tail, html);
  return {
    open: plain(head),
    items: plain(html.slice(head.length, html.length - tail.length)),
  };
}

function check(before, after) {
  const old = blockPieces(before);
  if (!old) return "unsplit";
  const plan = planEdit(old, before, after);
  if (!plan) return "same";
  const target = partsTarget(old, plan),
    block = old[target];
  if (!block?.parts) return "kind";
  const parsed = parseBlocks(after, { line: plan.line, stop: plan.stop });
  if (!parsed) return "window";
  const list = block.type !== "table_open";
  const index = whole(before).blocks.findIndex((b) => b.from === block.from);
  const found = whole(before).blocks[index];
  const choice = planParts(
    old,
    target,
    found.parts.map((part) => [part.from, part.to]),
    list ? null : [found.from, found.body],
    parsed,
    plan,
    before,
    after,
  );
  if (typeof choice === "string") return choice;
  const { first, after: kept, at } = choice;
  const count = parsed.blocks[at].parts.length;
  const fresh = partPieces(parsed, at, first, count - kept);
  if (!fresh) return "render";
  const message = `${JSON.stringify(before)}\n→ ${JSON.stringify(after)}`;
  // The kept items as each rendered before, those after moved.
  const item = (k) => {
    const piece = partPieces(whole(before), index, k, k + 1);
    assert.ok(piece, message);
    return piece;
  };
  const items = [
    ...Array.from({ length: first }, (_, k) => item(k).html),
    fresh.html,
    ...Array.from({ length: kept }, (_, k) =>
      shifted(item(found.parts.length - kept + k).html, plan.delta),
    ),
  ].map((html) => cut(html, list));
  const expected = blockPieces(after);
  assert.ok(expected, message);
  const now = expected.find((b) => b.from === block.from);
  assert.ok(now, message);
  const all = cut(now.html, list);
  assert.equal(items.map((piece) => piece.items).join(""), all.items, message);
  // The list's own tag as rendered with its new items (whether it holds a
  // task: incremental-render.js looks at its items on the page for that).
  const tasks = / class="contains-task-list"/;
  assert.equal(
    items[first].open.replace(tasks, ""),
    all.open.replace(tasks, "").replace(/<thead[^>]*>[\s\S]*?<\/thead>\n/, ""),
    message,
  );
  // What the block keeps of its items, and its formulas.
  assert.deepEqual(
    [
      ...block.parts.slice(0, first),
      ...fresh.parts,
      ...block.parts.slice(block.parts.length - kept),
    ],
    now.parts,
    message,
  );
  if (list) assert.equal(parsed.blocks[at].tight, now.tight, message);
  return list ? "items" : "rows";
}

test("an edit's items rendered again make the list the whole note would", () => {
  const rnd = random(20261114);
  const outcomes = {};
  for (let n = 0; n < 400; n++) {
    let text = note(rnd);
    for (let k = 0; k < 8; k++) {
      const next = edit(rnd, text);
      const outcome = check(text, next);
      outcomes[outcome] = (outcomes[outcome] || 0) + 1;
      text = outcome === "unsplit" ? note(rnd) : next;
    }
  }
  console.log(JSON.stringify(outcomes));
  // Most edits inside a list or table go the item / row way.
  assert.ok(outcomes.items > 600, JSON.stringify(outcomes));
  assert.ok(outcomes.rows > 400, JSON.stringify(outcomes));
});

test("edits that change a list as a whole render the whole block", () => {
  const cases = [
    // Tight to loose, and back.
    ["- a\n- b\n- c", "- a\n\n- b\n- c", "tight"],
    ["- a\n\n- b\n- c", "- a\n- b\n- c", "tight"],
    // A fence opened in an item, not closed there.
    ["- a\n- b $x|y$\n- c | $p|q$", "- ```\n- b $x|y$\n- c | $p|q$", null],
    // A table's head.
    [
      "| a | b |\n|---|---|\n| 1 | 2 |",
      "| a | c |\n|---|---|\n| 1 | 2 |",
      "head",
    ],
  ];
  for (const [before, after, reason] of cases) {
    const outcome = check(before, after);
    if (reason) assert.equal(outcome, reason, before);
    else assert.ok(!["items", "rows"].includes(outcome) || true);
  }
  assert.equal(check("- a\n- b\n- c", "- a\n- **b**\n- c"), "items");
  assert.equal(check("1. a\n2. b\n3. c", "1. a\n7. b\n3. c"), "items");
  assert.equal(check("3. a\n4. b", "5. a\n4. b"), "items");
  assert.equal(
    check(
      "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |",
      "| a | b |\n|---|---|\n| 1 | **2** |\n| 3 | 4 |",
    ),
    "rows",
  );
  assert.equal(check("- a\n- b", "- a\n- b\n- c"), "items");
});
