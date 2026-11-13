import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Long notes skip drawing finished blocks away from the screen
// (src/offscreen-blocks.js). The note must keep exactly its layout, so jumps,
// find and the reading position behave as if everything were drawn.
async function boot(page, text, settings = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, settings }) => {
      const file = {
        id: "note",
        name: "Note.md",
        path: "C:/synthetic/Note.md",
        version: "v1",
        text,
      };
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [file],
          restored: [],
          roots: [],
          settings: { sidebar: false, outline: true, ...settings },
        }),
      });
    },
    { text, settings },
  );
  await page.goto("/");
  await expect(page.locator("#outline button").first()).toBeVisible();
}

const longNote =
  "# Long\n\n" +
  Array.from(
    { length: 60 },
    (_, n) =>
      `## Section ${n}\n\n${("Reading paragraph 中文段落 " + n + ". ").repeat(18)} Inline $a_${n}^2$ here.\n\n` +
      `- item $x_${n}$ one\n- item two\n\n` +
      `1. loose item\n\n   with a second paragraph $y_${n}$\n\n2. another\n\n` +
      `$$\\sum_{k=0}^{${n}} \\frac{k^2}{k+1}$$\n\n` +
      `> quoted $q_${n}$ text\n\n` +
      "| Name | Value |\n|---|---|\n" +
      `| row | $v_${n}$ ${"cell text ".repeat(n % 5)} |\n\n` +
      "```js\nconst x = " +
      n +
      ";\n```\n\n" +
      (n === 47 ? "The needle phrase zephyrquartz sits here.\n\n" : ""),
  ).join("");

function allDrawn(page) {
  return expect
    .poll(
      () =>
        page.evaluate(
          () => document.querySelectorAll("#content [data-folio-math]").length,
        ),
      { timeout: 20000 },
    )
    .toBe(0);
}
function skipped(page) {
  return page.evaluate(
    () => document.querySelectorAll("#content .reading-skip").length,
  );
}
// Every block's place with skipping as it is, then with nothing skipped.
function layoutDifference(page) {
  return page.evaluate(() => {
    const reader = document.querySelector("#reader");
    const blocks = [
      ...document.querySelectorAll(
        "#content :is(.prose, .section-body) > *, #content h2",
      ),
    ];
    const tops = () =>
      blocks.map((b) => b.getBoundingClientRect().top + reader.scrollTop);
    const before = tops(),
      height = reader.scrollHeight;
    const kept = [...document.querySelectorAll("#content .reading-skip")];
    for (const block of kept) block.classList.remove("reading-skip");
    const after = tops(),
      full = reader.scrollHeight;
    for (const block of kept) block.classList.add("reading-skip");
    return {
      blocks: Math.max(...before.map((top, i) => Math.abs(top - after[i]))),
      height: Math.abs(height - full),
    };
  });
}

test("finished blocks off screen are skipped without changing the note's layout", async ({
  page,
}) => {
  await boot(page, longNote);
  await allDrawn(page);
  await expect.poll(() => skipped(page)).toBeGreaterThan(40);
  const difference = await layoutDifference(page);
  expect(difference.blocks).toBeLessThan(1);
  expect(difference.height).toBeLessThan(1);
});

test("a new reading width measures skipped blocks again", async ({ page }) => {
  await boot(page, longNote);
  await allDrawn(page);
  await expect.poll(() => skipped(page)).toBeGreaterThan(40);
  // Narrower: every block re-wraps.
  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(() => skipped(page)).toBeGreaterThan(40);
  await page.waitForTimeout(800);
  const difference = await layoutDifference(page);
  expect(difference.blocks).toBeLessThan(1);
  expect(difference.height).toBeLessThan(1);
});

test("outline jumps and find land on skipped parts of a long note", async ({
  page,
}) => {
  await boot(page, longNote);
  await allDrawn(page);
  await expect.poll(() => skipped(page)).toBeGreaterThan(40);
  const headingOffset = (n) =>
    page.evaluate((n) => {
      const reader = document.querySelector("#reader");
      const heading = [...document.querySelectorAll("#content h2")].find((h) =>
        h.textContent.includes(`Section ${n}`),
      );
      return Math.round(
        heading.getBoundingClientRect().top -
          reader.getBoundingClientRect().top,
      );
    }, n);
  for (const n of [52, 9, 38]) {
    await page
      .locator("#outline")
      .getByRole("button", { name: `Section ${n}`, exact: true })
      .click();
    await expect.poll(() => headingOffset(n)).toBeGreaterThanOrEqual(28);
    await expect.poll(() => headingOffset(n)).toBeLessThanOrEqual(36);
    await page.waitForTimeout(400);
    expect(Math.abs((await headingOffset(n)) - 32)).toBeLessThanOrEqual(4);
  }
  // Find-in-note reaches a block that is skipped right now.
  await page.evaluate(() => (document.querySelector("#reader").scrollTop = 0));
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll("#content .reading-skip")].some((b) =>
        b.textContent.includes("zephyrquartz"),
      ),
    ),
  ).toBe(true);
  await page.keyboard.press("Control+f");
  await page.locator("#find-bar input").fill("zephyrquartz");
  await expect(page.locator("#find-bar .find-count")).toHaveText("1/1");
  const visible = await page.evaluate(() => {
    const reader = document.querySelector("#reader").getBoundingClientRect();
    const block = [...document.querySelectorAll("#content p")].find((p) =>
      p.textContent.includes("zephyrquartz"),
    );
    const box = block.getBoundingClientRect();
    return box.top >= reader.top && box.bottom <= reader.bottom;
  });
  expect(visible).toBe(true);
});

test("scrolling over formulas not drawn yet keeps the reading line still", async ({
  page,
}) => {
  // Right after opening most formulas are still TeX placeholders; they are
  // drawn as they come near the screen (and in idle time).
  await boot(page, longNote);
  // Text at the reading line, its distance from the reader's top, after a
  // scroll step and again once the formulas around it have been drawn.
  const probe = () =>
    page.evaluate(() => {
      const reader = document.querySelector("#reader"),
        box = reader.getBoundingClientRect();
      const leaf = document
        .elementFromPoint(box.left + box.width / 2, box.top + 60)
        ?.closest("p, li, h2, td, blockquote");
      window.__leaf = leaf;
      return leaf ? leaf.getBoundingClientRect().top - box.top : null;
    });
  const again = () =>
    page.evaluate(
      () =>
        window.__leaf.getBoundingClientRect().top -
        document.querySelector("#reader").getBoundingClientRect().top,
    );
  for (const step of [900, 900, 900, -1400, -700, 1600]) {
    await page.evaluate(
      (step) => (document.querySelector("#reader").scrollTop += step),
      step,
    );
    const at = await probe();
    if (at === null) continue;
    await page.waitForTimeout(250);
    // The position is kept at the reader's top edge; a formula drawn in the
    // lines between that edge and this text may still move it by a few
    // pixels (3 seen with current Edge). A jump would be tens of pixels.
    expect(Math.abs((await again()) - at)).toBeLessThanOrEqual(4);
  }
});
