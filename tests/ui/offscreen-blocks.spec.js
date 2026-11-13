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

test("a reading position right of a line's end is held by its last character", async ({
  page,
}) => {
  // Where the reading line crosses a short line right of its text, the caret
  // there is after the run's last character. That offset belongs to no run,
  // and restoring it measured the whole block: every formula drawn above
  // moved the text by the line's distance from the block's top.
  await page.goto("/");
  const moved = await page.evaluate(async () => {
    const { visibleAnchor, restoreAnchor } = await import("/src/positions.js");
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;left:0;top:0;width:600px;height:300px;overflow:auto;font:16px/40px sans-serif";
    host.innerHTML =
      '<div style="height:1000px"></div>' +
      '<p data-from="0" data-to="20" style="margin:0;padding-top:30px">' +
      '<span data-text-from="0" data-text-to="5">short</span><br>' +
      '<span data-text-from="6" data-text-to="11">lines</span></p>' +
      '<div style="height:1000px"></div>';
    document.body.append(host);
    const run = host.querySelector("span");
    // The first line's box spans 20 to 60 px below the top; the reading
    // line (32 px) crosses it right of "short".
    host.scrollTop = run.getBoundingClientRect().top - 20;
    const before = run.getBoundingClientRect().top;
    const anchor = visibleAnchor(host);
    host.firstChild.style.height = "1050px";
    restoreAnchor(host, anchor);
    const after = run.getBoundingClientRect().top;
    host.remove();
    return after - before;
  });
  expect(Math.abs(moved)).toBeLessThanOrEqual(1);
});

test("scrolling over formulas not drawn yet keeps the reading line still", async ({
  page,
}) => {
  // Right after opening most formulas are still TeX placeholders; they are
  // drawn as they come near the screen (and in idle time). A slower machine
  // (CI under load): formulas are drawn later, fonts arrive later.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await boot(page, longNote);
  // Text at the reading line, its distance from the reader's top, after a
  // scroll step and again once the formulas around it have been drawn.
  const probe = () =>
    page.evaluate(() => {
      const reader = document.querySelector("#reader"),
        box = reader.getBoundingClientRect();
      let leaf = null;
      for (const y of [60, 90, 120, 160, 200])
        leaf ??= document
          .elementFromPoint(box.left + box.width / 2, box.top + y)
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
  // What was painted after the step: formulas a jump lands on are drawn
  // before the frame that shows them.
  const painted = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  // Quiet: no formula left undrawn on screen or within 600 px of it.
  const near = () =>
    page.evaluate(() => {
      const box = document.querySelector("#reader").getBoundingClientRect();
      return [...document.querySelectorAll("#content [data-folio-math]")]
        .map((marker) => marker.getBoundingClientRect())
        .filter(
          (rect) =>
            (rect.width || rect.height) &&
            rect.bottom > box.top - 600 &&
            rect.top < box.bottom + 600,
        ).length;
    });
  let checked = 0;
  for (const step of [900, 900, 900, -1400, -700, 1600]) {
    await page.evaluate(
      (step) => (document.querySelector("#reader").scrollTop += step),
      step,
    );
    await painted();
    const at = await probe();
    if (at === null) continue;
    checked++;
    await expect.poll(near, { timeout: 10000 }).toBe(0);
    await page.waitForTimeout(100);
    // Rounding at most. A reading position restored to the wrong place
    // moved it by a line (20 px on CI), and a formula drawn after it was
    // shown by its growth (2 px a line with a subscript, 10 or more for a
    // display formula).
    expect(Math.abs((await again()) - at)).toBeLessThanOrEqual(2);
  }
  expect(checked).toBeGreaterThan(1);
});
