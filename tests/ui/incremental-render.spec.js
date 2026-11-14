import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// An edit to the note shown renders again only the blocks it touched
// (src/incremental-render.js). With `__folioIncremental.verify` on, the page
// after each such edit is compared with the same text rendered whole (the
// page's own state left out: drawn formulas, folds, skipped blocks, table
// widths), and the blocks the renderer keeps with the page's.

const NOTE = [
  "# Notes",
  "Intro with **bold**, *italic*, `code` and $x^2$ inline.",
  "## Lists",
  "- tight one with $a_1$\n- tight two\n- tight three",
  "1. first\n2. second\n   - nested\n3. third",
  "- loose one\n\n- loose two\n\n  more of two",
  "- [ ] task\n- [x] done",
  "## Tables",
  "| Name | Value | Bound |\n|:---|---:|:-:|\n| a | $v_1 = 1$ | $\\le 2$ |\n| b | `x|y` | $a|b$ |\n| c | 3 | 4 |",
  "Text between the tables.",
  "| A | B |\n|---|---|\n| 1 | 2 |",
  "## Code and formulas",
  "```js\nconst a = 1;\n\nlet b = 2;\n```",
  "$$\n\\sum_{k=0}^n k^2\n$$",
  "$$x = y$$",
  "\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}",
  "### Deeper",
  "> A quote\n> on two lines\nlazy",
  'Coloured <span style="color: #b23c36">text</span> and a <br> break.',
  "Escapes \\* and \\| and &amp; here, a [link](https://example.com).",
  "---",
  "Last paragraph with $\\frac{1}{2}$.",
].join("\n\n");

const SNIPPETS = [
  "**",
  "x",
  " word ",
  "\n",
  "\n\n",
  "- ",
  "1. ",
  "$",
  "$$",
  "|",
  "> ",
  "    ",
  "`",
  "==",
  "\n\n| p | q |\n|---|---|\n| 1 | 2 |\n\n",
  "\n\nPasted paragraph with $y$.\n\n- pasted item\n- another\n\n",
  "\n```\n",
];

function random(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

// One edit as CodeMirror changes: typing, deleting, formatting a word,
// pasting blocks.
function edit(rnd, text) {
  const at = Math.floor(rnd() * (text.length + 1));
  const kind = rnd();
  if (kind < 0.4) return { from: at, to: at, insert: pick(rnd, SNIPPETS) };
  if (kind < 0.65)
    return {
      from: at,
      to: Math.min(text.length, at + 1 + Math.floor(rnd() * 10)),
      insert: "",
    };
  if (kind < 0.85) {
    const end = Math.min(text.length, at + 1 + Math.floor(rnd() * 8));
    const mark = pick(rnd, ["**", "*", "==", "~~"]);
    return [
      { from: at, to: at, insert: mark },
      { from: end, to: end, insert: mark },
    ];
  }
  return { from: at, to: at, insert: pick(rnd, "abcdefg ".split("")) };
}

async function boot(page, text, mode) {
  await installFolio(page);
  await page.addInitScript(
    ({ text }) => {
      window.__folioIncremental = { verify: true };
      window.folio = folioTest.mock({
        ready: async () => ({
          roots: [],
          restored: [],
          incoming: [
            {
              id: "note",
              name: "Note.md",
              path: "C:/synthetic/Note.md",
              text,
              version: "v1",
            },
          ],
          settings: {
            sidebar: false,
            outline: false,
            readingFormat: true,
            richEdit: false,
          },
        }),
        save: async () => ({ version: "v2" }),
      });
    },
    { text },
  );
  await page.goto("/");
  await expect(page.locator("#content h1")).toBeVisible();
  if (mode === "edit")
    await page.getByRole("button", { name: "编辑", exact: true }).click();
}
const stats = (page) => page.evaluate(() => window.__folioIncremental);

for (const seed of [7, 31])
  test(`edits typed beside the note render as the whole note would (seed ${seed})`, async ({
    page,
  }) => {
    test.setTimeout(240000);
    await boot(page, NOTE, "edit");
    await expect(page.locator("#editor .cm-content")).toBeVisible();
    const rnd = random(seed);
    for (let n = 0; n < 160; n++) {
      const before = (await stats(page)).log?.length ?? 0;
      const changed = await page.evaluate(
        (changes) => {
          const view = document.querySelector("#editor .cm-content").cmTile.root
            .view;
          const text = view.state.doc.toString();
          view.dispatch({ changes });
          return view.state.doc.toString() !== text;
        },
        edit(
          rnd,
          await page.evaluate(() =>
            document
              .querySelector("#editor .cm-content")
              .cmTile.root.view.state.doc.toString(),
          ),
        ),
      );
      if (!changed) continue;
      await expect
        .poll(async () => (await stats(page)).log?.length ?? 0)
        .toBeGreaterThan(before);
      const { mismatches } = await stats(page);
      expect(mismatches ?? [], JSON.stringify(mismatches?.[0])).toEqual([]);
    }
    const { log, verified } = await stats(page);
    const outcomes = {};
    for (const entry of log)
      outcomes[entry.result + (entry.reason ? ":" + entry.reason : "")] =
        (outcomes[entry.result + (entry.reason ? ":" + entry.reason : "")] ||
          0) + 1;
    // Most edits went the incremental way, and each was checked; so was each
    // whole render after one (it keeps the nodes changed in place).
    expect(verified.incremental, JSON.stringify(outcomes)).toBeGreaterThan(80);
    expect(verified.incremental).toBe(outcomes.incremental);
    expect(verified.full).toBeGreaterThan(3);
  });

// Long lists and tables, edited inside (src/incremental-render.js renders
// only the items or rows an edit touched).
const LISTS = [
  "# Lists and tables",
  Array.from(
    { length: 24 },
    (_, k) =>
      `- item ${k} with $a_{${k}}$` +
      (k % 6 === 3 ? "\n  - nested\n  - [ ] nested task" : "") +
      (k % 8 === 5 ? "\n\n  ```\n  code | pipe\n  ```" : "") +
      (k % 9 === 7 ? "\n  lazy line" : ""),
  ).join("\n"),
  "Between.",
  Array.from({ length: 12 }, (_, k) => `${k + 3}. ordered ${k} $x|y$`).join(
    "\n\n",
  ),
  "- [ ] task one\n- [x] task two\n- [ ] task three",
  "| Name | Value | Bound |\n|:---|---:|:-:|\n" +
    Array.from(
      { length: 20 },
      (_, k) => `| row ${k} | $v_{${k}}$ | ${k % 3 ? "`a|b`" : "\\| x"} |`,
    ).join("\n"),
  "- tail item\n- another",
  "| A | B |\n|---|---|\n| 1 | 2 |",
  "Last paragraph.",
].join("\n\n");
// An edit on a line of a list or table: typing, formatting, deleting,
// pasting lines, indenting, blank lines, numbering, task boxes.
function listEdit(rnd, text) {
  // A table's body row two times in five, edited as a row.
  const items = [],
    rows = [];
  for (let from = 0, run = 0; from <= text.length;) {
    const end = text.indexOf("\n", from),
      to = end < 0 ? text.length : end,
      line = text.slice(from, to);
    run = /^\s*\|/.test(line) ? run + 1 : 0;
    if (run > 2) rows.push([from, to]);
    else if (!run && /^\s*(?:[-*]|\d+\.)/.test(line)) items.push([from, to]);
    if (end < 0) break;
    from = end + 1;
  }
  const row = rows.length && (rnd() < 0.4 || !items.length);
  const lines = row ? rows : items;
  const [start, end] = lines.length
    ? pick(rnd, lines)
    : [0, Math.min(1, text.length)];
  const at = start + Math.floor(rnd() * (end - start + 1));
  const kind = rnd();
  if (row && kind >= 0.62)
    return kind < 0.8
      ? { from: end, to: end, insert: "\n| p | $q|r$ | s |" }
      : { from: start, to: Math.min(end + 1, text.length), insert: "" };
  if (kind < 0.3)
    return { from: at, to: at, insert: pick(rnd, "ab $|*`\\".split("")) };
  if (kind < 0.5) {
    const to = Math.min(end, at + 1 + Math.floor(rnd() * 6));
    const mark = pick(rnd, ["**", "*", "==", "~~"]);
    return [
      { from: at, to: at, insert: mark },
      { from: to, to, insert: mark },
    ];
  }
  if (kind < 0.62)
    return {
      from: at,
      to: Math.min(end, at + 1 + Math.floor(rnd() * 5)),
      insert: "",
    };
  if (kind < 0.74)
    return {
      from: end,
      to: end,
      insert: pick(rnd, [
        "\n- pasted",
        "\n7. pasted",
        "\n| p | q | r |",
        "\n  more",
        "\n",
        "\n\n",
        "\n  ```",
      ]),
    };
  if (kind < 0.84)
    return { from: start, to: start, insert: pick(rnd, ["  ", "- ", "1. "]) };
  if (kind < 0.92) {
    const line = text.slice(start, end);
    const number = line.match(/^(\s*)(\d+)\./);
    if (number)
      return {
        from: start + number[1].length,
        to: start + number[1].length + number[2].length,
        insert: String(1 + Math.floor(rnd() * 30)),
      };
    const box = line.indexOf("[ ]");
    if (box >= 0)
      return { from: start + box + 1, to: start + box + 2, insert: "x" };
    return { from: start, to: Math.min(end, start + 2), insert: "" };
  }
  return { from: at, to: at, insert: "\n" };
}

for (const seed of [53, 89])
  test(`edits inside long lists and tables render only their items as the whole note would (seed ${seed})`, async ({
    page,
  }) => {
    test.setTimeout(240000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack));
    await boot(page, LISTS, "edit");
    await expect(page.locator("#editor .cm-content")).toBeVisible();
    const rnd = random(seed);
    for (let n = 0; n < 200; n++) {
      const before = (await stats(page)).log?.length ?? 0;
      const text = await page.evaluate(() =>
        document
          .querySelector("#editor .cm-content")
          .cmTile.root.view.state.doc.toString(),
      );
      const changes = listEdit(rnd, text);
      const changed = await page.evaluate((changes) => {
        const view = document.querySelector("#editor .cm-content").cmTile.root
          .view;
        const text = view.state.doc.toString();
        view.dispatch({ changes });
        return view.state.doc.toString() !== text;
      }, changes);
      if (!changed) continue;
      await expect
        .poll(async () => (await stats(page)).log?.length ?? 0)
        .toBeGreaterThan(before);
      const { mismatches, log } = await stats(page);
      expect(
        mismatches ?? [],
        JSON.stringify([changes, log.slice(before), mismatches, errors]),
      ).toEqual([]);
    }
    const { log, verified } = await stats(page);
    const outcomes = {};
    for (const entry of log) {
      const key = [entry.result, entry.reason, entry.level, entry.parts]
        .filter(Boolean)
        .join(":");
      outcomes[key] = (outcomes[key] || 0) + 1;
    }
    console.log(JSON.stringify(outcomes));
    // Most edits went the item / row way, and each was checked.
    const level = (name) => log.filter((entry) => entry.level === name).length;
    expect(
      level("items") + level("rows"),
      JSON.stringify(outcomes),
    ).toBeGreaterThan(100);
    expect(level("rows"), JSON.stringify(outcomes)).toBeGreaterThan(15);
    expect(verified.incremental).toBe(
      log.filter((entry) => entry.result === "incremental").length,
    );
    expect(errors).toEqual([]);
  });

test("a word formatted from the page in Read mode changes only its block", async ({
  page,
}) => {
  await boot(page, NOTE, "read");
  const block = page.locator("#content li", { hasText: "tight two" });
  const kept = await page.evaluate(() => [
    ...document.querySelectorAll("#content > *, #content .section-body > *"),
  ]);
  await page.evaluate(() => {
    window.keptBlocks = [
      ...document.querySelectorAll(
        "#content .section-body > :not(.note-section)",
      ),
    ];
  });
  expect(kept.length).toBeGreaterThan(0);
  const tools = page.getByRole("toolbar", { name: "选中文字格式" });
  await expect(async () => {
    await block.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) && !node.data.includes("two"));
      const at = node.data.indexOf("two");
      document.querySelector("#reader").focus();
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 3);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await expect(tools).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15000 });
  await tools.getByRole("button", { name: "加粗", exact: true }).click();
  await expect(page.locator("#content li strong")).toHaveText("two");
  const { log, mismatches, verified } = await stats(page);
  expect(log.at(-1).result).toBe("incremental");
  // Only the item itself was rendered again.
  expect(log.at(-1)).toMatchObject({ level: "items", replaced: 1, put: 1 });
  expect(mismatches ?? []).toEqual([]);
  expect(verified.incremental).toBe(1);
  // Every other block is the same element as before; the list itself too
  // (only its changed item was put in anew).
  const same = await page.evaluate(() => {
    const now = new Set(
      document.querySelectorAll("#content .section-body > :not(.note-section)"),
    );
    return window.keptBlocks.filter((el) => !now.has(el)).length;
  });
  expect(same).toBe(0);
  await expect(page.locator("#content li strong")).toHaveAttribute(
    "data-src-from",
    /\d+/,
  );
});
