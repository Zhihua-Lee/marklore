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
    const heading = document.querySelector(
      `#content [data-from="${button.dataset.from}"]`,
    );
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
    const settled = await headingOffset(page, n);
    expect(
      Math.abs(settled - 32),
      `Section ${n} drifted to ${settled}`,
    ).toBeLessThanOrEqual(4);
  }
});

test("long outline jumps never show half-rendered content while they move", async ({
  page,
}) => {
  await boot(page, longNote);
  // The destination renders before the jump moves; a long jump cuts to just
  // short of it and glides the rest, so no frame shows raw formula source.
  for (const n of [30, 6]) {
    const frames = await page.evaluate(async (n) => {
      const reader = document.querySelector("#reader"),
        view = reader.getBoundingClientRect();
      const pending = () =>
        [...document.querySelectorAll("#content [data-folio-math]")].filter(
          (marker) => {
            const box = marker.getBoundingClientRect();
            return box.bottom > view.top && box.top < view.bottom;
          },
        ).length;
      [...document.querySelectorAll("#outline button")]
        .find((b) => b.title === `Section ${n}`)
        .click();
      const samples = [];
      const start = performance.now();
      while (performance.now() - start < 1500) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        samples.push({ top: reader.scrollTop, pending: pending() });
      }
      return samples;
    }, n);
    const reduced = await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    const moving = frames.filter((f, i) => i && f.top !== frames[i - 1].top);
    // Reduced motion jumps instantly by design; otherwise the last stretch animates.
    if (!reduced)
      expect(moving.length, `Section ${n} did not glide`).toBeGreaterThan(3);
    expect(
      frames.filter((f) => f.pending).length,
      `Section ${n} showed unrendered formulas`,
    ).toBe(0);
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
