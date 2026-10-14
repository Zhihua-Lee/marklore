import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// A standalone HTML export lists its headings beside the text (Settings →
// Export, on by default); a PDF gets bookmarks (tests/native-export.mjs).
test("the heading list nests by level, keeps formulas and drops inner links and ids", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { headingList } = await import("/src/export.js");
    const host = document.createElement("article");
    host.innerHTML = [
      '<h2 id="a">Intro</h2>',
      '<h3 id="b">With <a href="https://x">link</a> and <span class="katex" id="k">x</span></h3>',
      '<h4 id="c">Deep</h4>',
      '<h2 id="d">  </h2>',
      "<h2>No id</h2>",
    ].join("");
    const html = headingList(host);
    const single = document.createElement("article");
    single.innerHTML = '<h1 id="only">Only</h1>';
    const nav = Object.assign(document.createElement("div"), {
      innerHTML: html,
    }).firstElementChild;
    return {
      starts: html.startsWith('<nav class="export-toc"'),
      items: [...nav.querySelectorAll("li")].map((li) => [
        li.className,
        li.querySelector("a").getAttribute("href"),
        li.textContent,
      ]),
      innerLinks: nav.querySelectorAll("a a").length,
      ids: nav.querySelectorAll("[id]").length,
      math: nav.querySelectorAll(".katex").length,
      single: headingList(single),
    };
  });
  expect(result.starts).toBe(true);
  expect(result.items).toEqual([
    ["toc-l1", "#a", "Intro"],
    ["toc-l2", "#b", "With link and x"],
    ["toc-l3", "#c", "Deep"],
  ]);
  expect(result.innerLinks).toBe(0);
  expect(result.ids).toBe(0);
  expect(result.math).toBe(1);
  expect(result.single).toBe("");
});

test("the HTML contents switch is on by default and saved", async ({
  page,
}) => {
  await installFolio(page);
  await page.addInitScript(() => {
    window.folio = folioTest.mock({});
  });
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const toggle = page.getByRole("checkbox", { name: "HTML 附带目录" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.getByRole("button", { name: "关闭设置" }).click();
  await expect
    .poll(() => page.evaluate(() => window.mock.session?.settings.exportToc))
    .toBe(false);
});
