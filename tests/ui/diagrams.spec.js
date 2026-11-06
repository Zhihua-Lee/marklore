import { test, expect } from "@playwright/test";

// Diagrams are drawn by Ondine; mermaid.js is loaded only for what Ondine
// cannot draw. Ondine's colors come from the theme's CSS variables.
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

test("what Ondine cannot read goes to mermaid.js, and its error shows", async ({
  page,
}) => {
  await draw(page, "flowchart LR\n  A -->");
  await expect(page.locator(".diagram-error")).toBeVisible({ timeout: 20000 });
  expect(await mermaidLoaded(page)).toBe(true);
  await expect(page.locator("pre code.language-mermaid")).toBeVisible();
});
