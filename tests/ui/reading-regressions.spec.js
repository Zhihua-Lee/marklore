import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Deliberately NOT reduced motion: lazy formulas/tables and smooth scrolling
// interact only when the jump actually animates.
async function boot(page, text) {
  await installFolio(page);
  await page.addInitScript((text) => {
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
        settings: { sidebar: false, outline: true },
      }),
    });
  }, text);
  await page.goto("/");
  await expect(page.locator("#outline button").first()).toBeVisible();
}

// Enough formulas for progressive hydration and enough tables for lazy layout.
const longNote =
  "# Long\n\n" +
  Array.from(
    { length: 40 },
    (_, n) =>
      `## Section ${n}\n\n${("Reading paragraph 中文段落 " + n + ". ").repeat(20)}\n\n` +
      Array.from(
        { length: 6 },
        (_, f) =>
          `Inline $a_${f}^2 + b_${n}$ text.\n\n$$\\sum_{k=0}^{${n + f}} \\frac{k^2}{k+1}$$\n\n`,
      ).join("") +
      "| Name | Value | Note |\n|---|---|---|\n" +
      Array.from(
        { length: 6 },
        (_, r) =>
          `| row ${r} | ${(r * 37) % 11} | ${"long cell text ".repeat(r + 2)} |`,
      ).join("\n") +
      "\n\n",
  ).join("");

async function headingOffset(page, n) {
  return page.evaluate((n) => {
    const reader = document.querySelector("#reader");
    const button = [...document.querySelectorAll("#outline button")].find(
      (b) => b.title === `Section ${n}`,
    );
    // The outline or the heading can be mid-rebuild; report "not yet" so the
    // surrounding expect.poll retries instead of throwing.
    const heading =
      button &&
      document.querySelector(`#content [data-from="${button.dataset.from}"]`);
    if (!heading) return Number.NaN;
    return Math.round(
      heading.getBoundingClientRect().top - reader.getBoundingClientRect().top,
    );
  }, n);
}

test("smooth outline jumps land on their heading forwards and backwards in a lazy long note", async ({
  page,
}) => {
  test.setTimeout(60000);
  await boot(page, longNote);
  for (const n of [4, 18, 33, 12, 2, 27]) {
    await page
      .locator("#outline")
      .getByRole("button", { name: `Section ${n}`, exact: true })
      .click();
    await expect
      .poll(() => headingOffset(page, n), { timeout: 5000 })
      .toBeGreaterThanOrEqual(28);
    await expect.poll(() => headingOffset(page, n)).toBeLessThanOrEqual(36);
    // Late formula batches and table widths after landing keep the heading in place.
    await page.waitForTimeout(700);
    await expect
      .poll(async () => Math.abs((await headingOffset(page, n)) - 32), {
        message: `Section ${n} drifted after landing`,
      })
      .toBeLessThanOrEqual(4);
  }
});

// Does a smooth scroll on this host take more than one frame? (Measured on a
// scratch scroller so the reader's position is untouched.)
function smoothScrollAnimates(page) {
  return page.evaluate(async () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;left:0;top:0;width:50px;height:50px;overflow:auto;opacity:0";
    box.innerHTML = '<div style="height:5000px"></div>';
    document.body.append(box);
    box.scrollTo({ top: 4000, behavior: "smooth" });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const partial = box.scrollTop;
    box.remove();
    return partial < 4000;
  });
}

// Click an outline entry and sample every frame for 1.5 s: scroll position,
// visible unrendered formulas, and whether any of them show raw TeX.
function sampleJump(page, n) {
  return page.evaluate(async (n) => {
    const reader = document.querySelector("#reader"),
      view = reader.getBoundingClientRect(),
      from = reader.scrollTop;
    const pending = () =>
      [...document.querySelectorAll("#content [data-folio-math]")].filter(
        (marker) => {
          const box = marker.getBoundingClientRect();
          return box.bottom > view.top && box.top < view.bottom;
        },
      );
    [...document.querySelectorAll("#outline button")]
      .find((b) => b.title === `Section ${n}`)
      .click();
    const samples = [];
    const start = performance.now();
    while (performance.now() - start < 1500) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const visible = pending();
      samples.push({
        top: reader.scrollTop,
        pending: visible.length,
        rawTeX: visible.filter(
          (marker) => getComputedStyle(marker).color !== "rgba(0, 0, 0, 0)",
        ).length,
      });
    }
    return { from, samples };
  }, n);
}

test("long outline jumps glide continuously without showing half-rendered content", async ({
  page,
}) => {
  await boot(page, longNote);
  const animates = await smoothScrollAnimates(page);
  // Right after opening, idle backfill has not reached the path yet: whatever
  // formula is still pending mid-glide must look like a placeholder, not raw TeX.
  const early = await sampleJump(page, 30);
  if (animates)
    expect(
      early.samples.filter((f) => f.rawTeX).length,
      "raw TeX visible while gliding right after opening",
    ).toBe(0);
  await expect.poll(() => headingOffset(page, 30)).toBeGreaterThanOrEqual(28);
  await expect.poll(() => headingOffset(page, 30)).toBeLessThanOrEqual(36);
  // Once idle backfill has finished, the whole path is rendered.
  await expect
    .poll(() => page.locator("#content [data-folio-math]").count(), {
      timeout: 15000,
    })
    .toBe(0);
  for (const n of [6, 34]) {
    const { from, samples } = await sampleJump(page, n);
    expect(
      samples.filter((f) => f.pending).length,
      `Section ${n} showed unrendered formulas`,
    ).toBe(0);
    // Reduced motion jumps instantly by design, and some hosts (e.g. CI runners
    // with system animations off) render smooth scrolls instantly; continuity
    // is only asserted where the browser actually animates.
    if (animates) {
      const tops = [from, ...samples.map((f) => f.top)];
      const steps = tops
        .slice(1)
        .map((top, i) => Math.abs(top - tops[i]))
        .filter((step) => step > 0.5);
      const distance = Math.abs(tops.at(-1) - from);
      expect(steps.length, `Section ${n} did not glide`).toBeGreaterThan(5);
      // No cut: no single frame covers a large share of the jump.
      expect(
        Math.max(...steps) / distance,
        `Section ${n} jumped instead of scrolling`,
      ).toBeLessThan(0.3);
    }
    await expect.poll(() => headingOffset(page, n)).toBeGreaterThanOrEqual(28);
    await expect.poll(() => headingOffset(page, n)).toBeLessThanOrEqual(36);
  }
});

test("table headers: text double-click locates source, only the button sorts", async ({
  page,
}) => {
  await boot(
    page,
    "# T\n\n| Name | Value |\n|---|---|\n| b | 2 |\n| a | 1 |\n| c | 3 |\n",
  );
  const order = () =>
    page
      .locator("#content tbody tr")
      .evaluateAll((rows) =>
        rows.map((r) => r.cells[0].textContent.trim()).join(","),
      );
  const header = page.locator("#content th").first();
  await header.locator("[data-text-from]").click();
  expect(await order()).toBe("b,a,c");
  await expect(header).toHaveAttribute("aria-sort", "none");

  await header.locator(".table-sort").click();
  expect(await order()).toBe("a,b,c");
  await expect(header).toHaveAttribute("aria-sort", "ascending");

  await header.locator("[data-text-from]").dblclick();
  await expect(page.locator("#panes")).toHaveAttribute("data-mode", "edit");
  expect(await order()).toBe("a,b,c");
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await expect(page.locator(".cm-content")).toContainText("| Name | Value |");
});
