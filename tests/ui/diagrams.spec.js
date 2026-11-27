import { test, expect } from "@playwright/test";

// Diagrams are drawn by Ondine; mermaid.js is not part of the app. Ondine's
// colors come from the theme's CSS variables.
async function draw(page, source, theme = "light") {
  await page.evaluate(
    async ([source, theme]) => {
      const { renderMarkdown } = await import("/src/markdown.js");
      const { renderDiagrams } = await import("/src/diagrams.js");
      const host = document.querySelector("#content");
      host.innerHTML = renderMarkdown("```mermaid\n" + source + "\n```").html;
      renderDiagrams(host, theme, () => {});
    },
    [source, theme],
  );
}
const mermaidLoaded = (page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .some((e) => /[/_]mermaid(\.js|\.core|@|\/)/.test(e.name)),
  );

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新笔记", exact: true }).click();
  // A new note opens in Edit mode; the diagram is drawn in the reading view.
  await page.getByRole("button", { name: "阅读", exact: true }).click();
});

test("a diagram is drawn by Ondine without loading mermaid.js", async ({
  page,
}) => {
  await draw(
    page,
    'flowchart LR\n  A[Read] --> B{Think}\n  B --> C[Write]\n  click A "https://example.com"',
  );
  const svg = page.locator(".diagram svg.ondine");
  await expect(svg).toBeVisible({ timeout: 20000 });
  expect(await mermaidLoaded(page)).toBe(false);
  // Its authored direction is kept, and no outside link survives.
  const box = await svg.boundingBox();
  expect(box.width).toBeGreaterThan(box.height);
  expect(await page.locator('.diagram [href^="http"]').count()).toBe(0);
  expect(await page.locator(".diagram foreignObject").count()).toBe(0);
  // Its colors are the theme's: switching to dark needs no new drawing.
  const ink = () => svg.evaluate((el) => getComputedStyle(el).color);
  const light = await ink();
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  expect(await ink()).not.toBe(light);
});

test("what Ondine cannot read shows its error under the source", async ({
  page,
}) => {
  await draw(page, "flowchart LR\n  A -->");
  const error = page.locator(".diagram-error");
  await expect(error).toBeVisible({ timeout: 20000 });
  // The error says where in the source.
  await expect(error).toContainText(/Parse error on line \d/);
  expect(await mermaidLoaded(page)).toBe(false);
  await expect(page.locator("pre code.language-mermaid")).toBeVisible();
});

test("a diagram is drawn as a figure: smaller text, capped height, whole in the viewer", async ({
  page,
}) => {
  // A long top-down chain is far taller than the cap.
  const chain = Array.from({ length: 24 }, (_, i) => `  N${i} --> N${i + 1}`);
  await draw(page, "flowchart TB\n" + chain.join("\n"));
  const diagram = page.locator(".diagram");
  await expect(diagram.locator(":scope > svg")).toBeVisible({ timeout: 20000 });
  // Its text is 0.8 of the note's.
  const { text, note } = await diagram.evaluate((el) => ({
    text: parseFloat(
      getComputedStyle(el.querySelector(":scope > svg text")).fontSize,
    ),
    note: parseFloat(getComputedStyle(el.closest(".prose") || el).fontSize),
  }));
  expect(text).toBe(Math.round(note * 0.8));
  // Cut off at the cap with a fade, drawn at 0.8 of its size.
  await expect(diagram).toHaveClass(/diagram-clipped/);
  const box = await diagram.boundingBox();
  const cap = await page.evaluate(() => Math.min(480, innerHeight * 0.6));
  expect(box.height).toBeLessThanOrEqual(cap + 1);
  const scale = await diagram.evaluate(
    (el) =>
      el.querySelector(":scope > svg").getBoundingClientRect().width /
      Number(el.dataset.width),
  );
  expect(scale).toBeGreaterThan(0.79);
  expect(scale).toBeLessThanOrEqual(0.81);
  // The viewer shows all of it: fitted, zoomed, reset with 0, closed with Esc.
  await page.locator("#content pre").hover();
  await page.getByRole("button", { name: "放大查看图表" }).click();
  const viewer = page.locator("dialog.diagram-viewer");
  await expect(viewer).toBeVisible();
  const zoom = viewer.locator(".diagram-viewer-zoom");
  const fitted = await zoom.textContent();
  await viewer.getByRole("button", { name: "放大", exact: true }).click();
  await expect(zoom).not.toHaveText(fitted);
  await page.keyboard.press("0");
  await expect(zoom).toHaveText(fitted);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("a small diagram keeps its size and needs no viewer", async ({ page }) => {
  await draw(page, "flowchart LR\n  A --> B");
  const diagram = page.locator(".diagram");
  await expect(diagram.locator(":scope > svg")).toBeVisible({ timeout: 20000 });
  await expect(diagram).not.toHaveClass(/diagram-clipped/);
  await expect(page.locator("#content pre")).not.toHaveClass(/diagram-reduced/);
  const width = await diagram.evaluate(
    (el) => el.querySelector(":scope > svg").getBoundingClientRect().width,
  );
  expect(
    Math.abs(width - Number(await diagram.getAttribute("data-width"))),
  ).toBeLessThan(1.5);
});
