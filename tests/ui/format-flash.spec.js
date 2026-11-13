import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// A long note full of formulas draws them as they come near the view
// (src/formula-hydration.js). Formatting from the page in Read mode renders
// the note again (src/render-cache.js): only the changed block (a whole list
// or table) is put in anew, and its formulas on screen are drawn before the
// page is painted, never shown as their TeX source for a moment. The other
// blocks keep their drawn formulas and their skipped state
// (src/offscreen-blocks.js): nothing is drawn again around the reader, so
// the text and the scroll bar stay still.

// About 1,600 formulas and 120 KB: sections of prose, a long list and a
// table, each full of formulas.
function longFormulaNote() {
  const prose = (n) =>
    `Reading paragraph ${n} on the energy of the system, `.repeat(6);
  const sections = (from, count) =>
    Array.from({ length: count }, (_, i) => {
      const n = from + i;
      return (
        `## Section ${n}\n\n${prose(n)}with $a_{${n}}^2 + b_{${n}}$ and ` +
        `$\\frac{${n}}{${n}+1}$ in it.\n\n${prose(n)}then $c_{${n}}$ ` +
        `and $\\sqrt{${n}}$.\n\n$$\\sum_{k=0}^{${n}} \\frac{k^2}{k+${n}}$$\n\n`
      );
    }).join("");
  const list = Array.from(
    { length: 300 },
    (_, k) =>
      `- item ${k} weighs $m_{${k}} = \\frac{${k}}{2}$ against ` +
      `$x_{${k}}^2$ in the long list\n`,
  ).join("");
  const table =
    "| Row | Value | Bound |\n|---|---|---|\n" +
    Array.from(
      { length: 150 },
      (_, k) => `| row ${k} | $v_{${k}} = ${k}^2$ | $\\le \\frac{${k}}{3}$ |\n`,
    ).join("");
  return (
    "# Long note\n\n" +
    sections(0, 60) +
    "## The list\n\n" +
    list +
    "\n## The table\n\n" +
    table +
    "\n" +
    sections(60, 60)
  );
}

async function boot(page, text) {
  await installFolio(page);
  await page.addInitScript((text) => {
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
        settings: { sidebar: false, outline: false, readingFormat: true },
      }),
      save: async () => ({ version: "v2" }),
    });
  }, text);
  await page.goto("/");
  await expect(page.locator("#content h1")).toBeVisible();
}

// Formulas not drawn yet: on screen, and in the whole note.
function undrawn(page) {
  return page.evaluate(() => {
    const view = document.querySelector("#reader").getBoundingClientRect();
    const all = [...document.querySelectorAll("#content [data-folio-math]")];
    return {
      all: all.length,
      onScreen: all.filter((marker) => {
        const rect = marker.getBoundingClientRect();
        return (
          (rect.width || rect.height) &&
          rect.bottom > view.top &&
          rect.top < view.bottom
        );
      }).length,
    };
  });
}

// Formats `phrase` in `block` (in the middle of the view, every formula of
// the note drawn) with `button`. Returns each frame painted with the format
// in the page (`result` found): the undrawn formulas on screen and outside
// the changed block, where the formatted text is, and the note's scroll
// position and height; and the blocks skipped off screen before and after.
async function formatFrames(page, { block, phrase, button, result }) {
  const text = longFormulaNote();
  expect((text.match(/\$/g) || []).length / 2).toBeGreaterThan(1200);
  await boot(page, text);
  await block.evaluate((el) => {
    const reader = document.querySelector("#reader");
    reader.scrollTop +=
      el.getBoundingClientRect().top - reader.getBoundingClientRect().top - 300;
  });
  await expect
    .poll(async () => (await undrawn(page)).all, { timeout: 30000 })
    .toBe(0);
  const skipped = () =>
    page.evaluate(
      () => document.querySelectorAll("#content .reading-skip").length,
    );
  await expect.poll(skipped, { timeout: 10000 }).toBeGreaterThan(40);
  const skippedBefore = await skipped();

  const tools = page.getByRole("toolbar", { name: "选中文字格式" });
  await expect(async () => {
    await block.evaluate((el, phrase) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) && !node.data.includes(phrase));
      const at = node.data.indexOf(phrase);
      document.querySelector("#reader").focus();
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + phrase.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }, phrase);
    await expect(tools).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15000 });

  // Each frame, after its animation-frame callbacks and layout and before it
  // is painted (ResizeObserver callbacks run there).
  await page.evaluate((result) => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:0;top:0;height:1px;width:1px;pointer-events:none";
    document.body.append(probe);
    const reader = document.querySelector("#reader");
    const frames = (window.formatFrames = []);
    new ResizeObserver(() => {
      const formatted = document.querySelector(result);
      if (!formatted) return;
      const view = reader.getBoundingClientRect();
      // The block put in anew: the top-level one holding the change.
      const changed = formatted.closest(".section-body > *");
      const markers = [
        ...document.querySelectorAll("#content [data-folio-math]"),
      ];
      frames.push({
        onScreen: markers.filter((marker) => {
          const rect = marker.getBoundingClientRect();
          return (
            (rect.width || rect.height) &&
            rect.bottom > view.top &&
            rect.top < view.bottom
          );
        }).length,
        elsewhere: markers.filter((marker) => !changed.contains(marker)).length,
        text: formatted.getBoundingClientRect().top - view.top,
        scrollTop: reader.scrollTop,
        scrollHeight: reader.scrollHeight,
      });
    }).observe(probe);
    let width = 1;
    const tick = () => {
      probe.style.width = (width = 3 - width) + "px";
      if (frames.length < 90) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, result);
  await tools.getByRole("button", { name: button, exact: true }).click();
  await expect(page.locator(result)).toHaveText(phrase);
  await expect
    .poll(() => page.evaluate(() => window.formatFrames.length))
    .toBeGreaterThanOrEqual(90);
  return {
    frames: await page.evaluate(() => window.formatFrames),
    skippedBefore,
    skippedAfter: await skipped(),
  };
}

// About 1.5 s of frames after the change: no formula on screen shows its
// source, the blocks not changed keep their drawn formulas and their place
// (skipped off screen as they were), and what is read stays still.
function expectSteady({ frames, skippedBefore, skippedAfter }) {
  const all = (key) => frames.map((frame) => frame[key]);
  expect(frames.length).toBeGreaterThanOrEqual(90);
  expect(all("onScreen")).toEqual(frames.map(() => 0));
  expect(all("elsewhere")).toEqual(frames.map(() => 0));
  for (const key of ["text", "scrollTop", "scrollHeight"]) {
    const values = all(key);
    expect(Math.max(...values) - Math.min(...values), key).toBeLessThan(0.5);
  }
  // The block changed (around the reading line) is not skipped.
  expect(skippedAfter).toBeGreaterThanOrEqual(skippedBefore - 2);
}

test("highlighting a word in a long list keeps the note's formulas drawn and still", async ({
  page,
}) => {
  test.setTimeout(90000);
  expectSteady(
    await formatFrames(page, {
      block: page.locator("#content li", { hasText: "item 150 " }),
      phrase: "weighs",
      button: "高亮",
      result: "#content li mark",
    }),
  );
});

test("bold in a long table keeps the note's formulas drawn and still", async ({
  page,
}) => {
  test.setTimeout(90000);
  expectSteady(
    await formatFrames(page, {
      block: page.locator("#content td", { hasText: "row 75" }),
      phrase: "row",
      button: "加粗",
      result: "#content td strong",
    }),
  );
});

test("bold in a paragraph above a long table keeps the table as it was", async ({
  page,
}) => {
  test.setTimeout(90000);
  expectSteady(
    await formatFrames(page, {
      block: page
        .locator("#content p", { hasText: "Reading paragraph 20 " })
        .first(),
      phrase: "energy",
      button: "加粗",
      result: "#content p strong",
    }),
  );
});
