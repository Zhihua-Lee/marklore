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
