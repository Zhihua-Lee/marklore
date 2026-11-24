import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Lists that mix plain, numbered and task items: every item's text starts at
// the same place as its siblings', at every depth. A task's box hangs where a
// bullet would be instead of pushing its text right.
const text = [
  "- bullet one\n- [ ] task two\n- [x] task three\n- bullet four",
  "1. first\n2. second\n   - nested bullet\n   - [ ] nested task\n3. third\n   1. nested number",
  "- outer\n  1. inner one\n     - deep bullet\n     - [ ] deep task",
  "",
].join("\n\n");

test("plain, numbered and task items line up in a mixed list", async ({
  page,
}) => {
  await installFolio(page);
  await page.addInitScript(
    ({ text }) => {
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [
            {
              id: "one",
              path: "C:/notes/One.md",
              name: "One.md",
              text,
              version: "v1",
            },
          ],
          roots: [],
          restored: [],
          settings: { sidebar: false, outline: false },
        }),
      });
    },
    { text },
  );
  await page.goto("/");
  await page.locator("#content li").first().waitFor();
  // Where each item's own text starts, and how deep the item is.
  const items = await page.evaluate(() =>
    [...document.querySelectorAll("#content li")].map((li) => {
      const run = li.querySelector(":scope > [data-text-from]");
      const range = document.createRange();
      range.setStart(run.firstChild, run.textContent.search(/\S/));
      range.setEnd(run.firstChild, run.textContent.search(/\S/) + 1);
      let depth = 0;
      for (let at = li.parentElement; at; at = at.parentElement)
        if (at.tagName === "LI") depth++;
      return {
        text: run.textContent.trim(),
        depth,
        x: range.getBoundingClientRect().left,
      };
    }),
  );
  expect(items.length).toBe(14);
  for (const depth of [0, 1, 2]) {
    const level = items.filter((item) => item.depth === depth);
    expect(level.length, `items at depth ${depth}`).toBeGreaterThan(1);
    for (const item of level)
      expect(Math.abs(item.x - level[0].x), item.text).toBeLessThan(1.5);
  }
  // Deeper items still start further right.
  const at = (depth) => items.find((item) => item.depth === depth).x;
  expect(at(1)).toBeGreaterThan(at(0) + 10);
  expect(at(2)).toBeGreaterThan(at(1) + 10);
});

// The same list takes the same room in Read and Edit mode, so nothing below
// it moves on switching: loose lists (their items' paragraphs spaced as
// paragraphs), task lists, and lists starting or ending with a code block,
// a formula, a quote or a heading (Edit mode always contains a list, so the
// margins at its edges cannot collapse into the list's own).
const lists = {
  tight: "- one\n- two\n- three",
  loose: "- one\n\n- two\n\n- three",
  orderedLoose: "1. one\n\n2. two\n\n3. three",
  taskTight: "- [ ] one\n- [x] two\n- [ ] three",
  taskLoose: "- [ ] one\n\n- [x] two\n\n- [ ] three",
  nestedLoose: "- one\n\n  - inner a\n  - inner b\n\n- two",
  twoParagraphs: "- [ ] one\n\n  more of one\n\n- [x] two",
  endsCode: "- one\n- two\n\n  ```js\n  let a = 1;\n  ```",
  startsCode: "- ```js\n  let a = 1;\n  ```\n- two",
  endsFormula: "- one\n- two\n\n  $$\n  x^2 + y^2\n  $$",
  startsFormula: "- $$\n  x^2\n  $$\n- two\n- three",
  nestedEndsCode: "- one\n  - two\n\n    ```js\n    let a = 1;\n    ```",
  endsQuote: "- one\n- two\n\n  > quoted",
  startsQuote: "- > quoted\n- two",
  endsHeading: "- one\n- ## two",
};

test("a list is as tall in Edit mode as when read", async ({ page }) => {
  const text =
    "# Lists\n\n" +
    Object.entries(lists)
      .map(([name, list]) => `Before ${name}.\n\n${list}\n\nAfter ${name}.\n\n`)
      .join("");
  await installFolio(page);
  await page.addInitScript((text) => {
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          {
            id: "lists",
            path: "C:/notes/Lists.md",
            name: "Lists.md",
            text,
            version: "v1",
          },
        ],
        roots: [],
        restored: [],
        settings: { sidebar: false, outline: false, richEdit: true },
      }),
    });
  }, text);
  await page.goto("/");
  await page.locator("#content li").first().waitFor();
  // From the end of each "Before" paragraph to the start of its "After",
  // each shown first (formulas are drawn as they come into view).
  const room = async (root) => {
    const out = {};
    for (const name of Object.keys(lists)) {
      await page.evaluate(
        ({ root, name }) =>
          [...document.querySelectorAll(root + " p")]
            .find((p) => p.textContent.trim() === `Before ${name}.`)
            .scrollIntoView({ block: "start" }),
        { root, name },
      );
      await expect
        .poll(() =>
          page.evaluate(
            (root) =>
              document.querySelectorAll(
                root + " [data-folio-math], " + root + " .math-pending",
              ).length,
            root,
          ),
        )
        .toBe(0);
      await page.waitForTimeout(50);
      out[name] = await page.evaluate(
        ({ root, name }) => {
          const ps = [...document.querySelectorAll(root + " p")];
          const top = (label) =>
            ps.find((p) => p.textContent.trim() === `${label} ${name}.`);
          return (
            top("After").getBoundingClientRect().top -
            top("Before").getBoundingClientRect().bottom
          );
        },
        { root, name },
      );
    }
    return out;
  };
  const read = await room("#content");
  await page.keyboard.press("Control+2");
  await expect(page.locator("#rich-reader")).toBeVisible();
  const edit = await room("#rich .ProseMirror");
  for (const name of Object.keys(lists))
    expect(Math.abs(edit[name] - read[name]), name).toBeLessThan(0.5);
});

const parityCases = {
  deep4: "- level 1\n  - level 2\n    - level 3\n      - level 4",
  deep4TwoPara:
    "- level 1\n  - level 2\n    - level 3\n      - level 4 first\n\n        level 4 second",
  deep5:
    "- level 1\n  - level 2\n    - level 3\n      - level 4\n        - level 5",
  tableSimple:
    "| Name | Value | Note |\n| --- | --- | --- |\n| Alpha | 123 | First row |\n| Beta | 456 | Second row |",
  tableSingleRow: "| A | B |\n| --- | --- |",
  tableMath:
    "| Term | Formula |\n| --- | --- |\n| Sum | $\\sum_{i=1}^n x_i^2$ |\n| Norm | $\\|x\\|_2$ |",
  tableWrap:
    "| Section | Explanation | Notes |\n| --- | --- | --- |\n" +
    Array.from(
      { length: 4 },
      (_, i) =>
        `| Row item alpha ${i + 1} | Repeated explanation text that wraps on narrower panes cleanly. | ${i === 0 ? "Long exception details wrapping nicely. ".repeat(5) : "Standard entry"} |`,
    ).join("\n"),
  listEndsTable:
    "- item one\n- item two\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |",
};

const firstBlockCases = {
  h1: {
    text: "# Leading Title\n\nBody paragraph.",
    readSel: "#content h1, #content p",
    editSel: "#rich .ProseMirror h1, #rich .ProseMirror p",
  },
  h2: {
    text: "## Leading Section\n\nBody paragraph.",
    readSel: "#content h2, #content p",
    editSel: "#rich .ProseMirror h2, #rich .ProseMirror p",
  },
  para: {
    text: "Leading paragraph.\n\nBody paragraph.",
    readSel: "#content p",
    editSel: "#rich .ProseMirror p",
  },
  list: {
    text: "- First item\n- Second item\n\nBody paragraph.",
    readSel: "#content ul, #content > p, #content > .note-section > p",
    editSel: "#rich .ProseMirror > ul, #rich .ProseMirror > p",
  },
  quote: {
    text: "> First quote\n\nBody paragraph.",
    readSel: "#content blockquote, #content > p, #content > .note-section > p",
    editSel: "#rich .ProseMirror blockquote, #rich .ProseMirror > p",
  },
  code: {
    text: "```js\nconst x = 1;\n```\n\nBody paragraph.",
    readSel: "#content pre, #content > p, #content > .note-section > p",
    editSel: "#rich .ProseMirror pre, #rich .ProseMirror > p",
  },
  table: {
    text: "| A | B |\n| --- | --- |\n| 1 | 2 |\n\nBody paragraph.",
    readSel: "#content table, #content > p, #content > .note-section > p",
    editSel: "#rich .ProseMirror table, #rich .ProseMirror > p",
  },
  frontH1: {
    text: "---\ntags: [a, b]\n---\n\n# Title After Front\n\nBody paragraph.",
    readSel: "#content details.front-matter, #content h1",
    editSel: "#rich .ProseMirror details.front-matter, #rich .ProseMirror h1",
  },
  frontH2: {
    text: "---\ntags: [a, b]\n---\n\n## Section After Front\n\nBody paragraph.",
    readSel: "#content details.front-matter, #content h2",
    editSel: "#rich .ProseMirror details.front-matter, #rich .ProseMirror h2",
  },
  twoH1: {
    text: "# First\n\nBody 1.\n\n# Second\n\nBody 2.",
    readSel: "#content h1, #content p",
    editSel: "#rich .ProseMirror h1, #rich .ProseMirror p",
  },
  image: {
    text: "![dot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)\n\nBody paragraph.",
    readSel: "#content p",
    editSel: "#rich .ProseMirror p",
  },
  details: {
    text: "<details>\n<summary>More</summary>\n\nHidden body\n\n</details>\n\nBody paragraph.",
    readSel: "#content details",
    editSel: "#rich .ProseMirror .rich-details",
  },
};

test("nested lists, tables, and note first blocks match Read and Edit across themes and widths", async ({
  page,
}) => {
  // Every case in two themes and two widths, both modes: longer than one
  // ordinary test on a slow runner.
  test.setTimeout(120000);
  const composite =
    "# Parity\n\n" +
    Object.entries(parityCases)
      .map(([name, md]) => `Before ${name}.\n\n${md}\n\nAfter ${name}.\n\n`)
      .join("");
  const configs = [
    { name: "light-default", theme: "light", width: 1360 },
    { name: "dark-default", theme: "dark", width: 1360 },
    { name: "light-narrow", theme: "light", width: 700 },
    { name: "dark-narrow", theme: "dark", width: 700 },
  ];

  const openDoc = async (text, theme) => {
    await installFolio(page);
    await page.addInitScript(
      ({ text, theme }) => {
        window.folio = folioTest.mock({
          ready: async () => ({
            incoming: [
              {
                id: "parity",
                path: "C:/notes/Parity.md",
                name: "Parity.md",
                text,
                version: "v1",
              },
            ],
            roots: [],
            restored: [],
            settings: {
              sidebar: false,
              outline: false,
              richEdit: true,
              theme,
            },
          }),
        });
      },
      { text, theme },
    );
    await page.goto("/");
    await expect(page.locator("#content")).toBeVisible();
  };

  for (const cfg of configs) {
    await page.setViewportSize({ width: cfg.width, height: 900 });
    await openDoc(composite, cfg.theme);
    await expect(page.locator("#content table").first()).toBeVisible();
    const measureComposite = async (root, mathSel) => {
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(() =>
          page.evaluate(
            (sel) => document.querySelectorAll(sel).length,
            mathSel,
          ),
        )
        .toBe(0);
      const scroller = root === "#content" ? "#reader" : "#rich-reader";
      await page.evaluate(
        ({ scroller, y }) => {
          document.querySelector(scroller).scrollTop = y;
        },
        { scroller, y: 0 },
      );
      const max = await page.evaluate(
        (sel) => document.querySelector(sel).scrollHeight,
        scroller,
      );
      for (const frac of [0.4, 0.8, 1]) {
        await page.evaluate(
          ({ scroller, y }) => {
            document.querySelector(scroller).scrollTop = y;
          },
          { scroller, y: Math.round(max * frac) },
        );
        await page.waitForTimeout(120);
      }
      await expect
        .poll(() =>
          page.evaluate((root) => {
            const tables = [
              ...document.querySelectorAll(
                root + " .table-scroll > table:not(.table-measure)",
              ),
            ];
            return (
              document.querySelectorAll(root + " .table-measure").length ===
                0 &&
              tables.some((table) =>
                table.classList.contains("reading-columns"),
              )
            );
          }, root),
        )
        .toBe(true);
      await page.waitForTimeout(120);
      return page.evaluate((root) => {
        const ps = [...document.querySelectorAll(root + " p")];
        const out = {};
        for (const key of Object.keys({
          deep4: 1,
          deep4TwoPara: 1,
          deep5: 1,
          tableSimple: 1,
          tableSingleRow: 1,
          tableMath: 1,
          tableWrap: 1,
          listEndsTable: 1,
        })) {
          const before = ps.find(
            (p) => p.textContent.trim() === `Before ${key}.`,
          );
          const after = ps.find(
            (p) => p.textContent.trim() === `After ${key}.`,
          );
          before.scrollIntoView({ block: "start" });
          out[key] =
            after.getBoundingClientRect().top -
            before.getBoundingClientRect().bottom;
        }
        return out;
      }, root);
    };
    const read = await measureComposite(
      "#content",
      "#content [data-folio-math]",
    );
    await page.keyboard.press("Control+2");
    await expect(page.locator("#rich-reader")).toBeVisible();
    const edit = await measureComposite(
      "#rich .ProseMirror",
      "#rich [data-folio-math], #rich .math-pending",
    );
    for (const name of Object.keys(parityCases)) {
      expect(
        Math.abs(edit[name] - read[name]),
        `${cfg.name} ${name}`,
      ).toBeLessThan(0.5);
    }

    for (const [label, spec] of Object.entries(firstBlockCases)) {
      await openDoc(spec.text, cfg.theme);
      await page.waitForTimeout(100);
      const readBoxes = await page.evaluate((sel) => {
        const scroller = document
          .querySelector("#reader")
          .getBoundingClientRect();
        return [...document.querySelectorAll(sel)]
          .slice(0, 2)
          .map((el) => el.getBoundingClientRect().top - scroller.top);
      }, spec.readSel);
      await page.keyboard.press("Control+2");
      await expect(page.locator("#rich-reader")).toBeVisible();
      await page.waitForTimeout(100);
      const editBoxes = await page.evaluate((sel) => {
        const scroller = document
          .querySelector("#rich-reader")
          .getBoundingClientRect();
        return [...document.querySelectorAll(sel)]
          .slice(0, 2)
          .map((el) => el.getBoundingClientRect().top - scroller.top);
      }, spec.editSel);
      expect(editBoxes.length, `${cfg.name} first:${label} count`).toBe(
        readBoxes.length,
      );
      for (let i = 0; i < readBoxes.length; i++) {
        expect(
          Math.abs(editBoxes[i] - readBoxes[i]),
          `${cfg.name} first:${label}[${i}]`,
        ).toBeLessThan(0.5);
      }
    }
  }
});
