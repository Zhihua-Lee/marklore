import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

test("measured column allocation reduces actual table height without shrinking text", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js").then(
      async (m) => (await m.loadMath(), m),
    );
    const { optimizeTable } = await import("/src/table-layout.js");
    const text =
      "| ID | Description | Notes |\n| --- | --- | --- |\n" +
      Array.from(
        { length: 12 },
        (_, i) =>
          `| ${i + 1} | A regularly repeated explanation that deserves sufficient column width for comfortable reading. | ${i === 0 ? "A single long exception should not consume most of the available width. ".repeat(8) : "OK"} |`,
      ).join("\n");
    const host = document.createElement("article");
    host.className = "prose";
    host.style.cssText =
      "position:absolute;left:40px;top:60px;width:680px;max-width:none;padding:0;background:var(--reading-paper)";
    host.innerHTML = renderMarkdown(text).html;
    document.body.append(host);
    const table = host.querySelector("table");
    const before = {
      height: table.offsetHeight,
      widths: [...table.rows[0].cells].map((c) => c.offsetWidth),
      size: getComputedStyle(table).fontSize,
    };
    const start = performance.now();
    const changed = optimizeTable(table);
    return {
      before,
      changed,
      after: {
        height: table.offsetHeight,
        widths: [...table.rows[0].cells].map((c) => c.offsetWidth),
        size: getComputedStyle(table).fontSize,
      },
      ms: performance.now() - start,
      overflow: host.scrollWidth > host.clientWidth,
      probes: host.querySelectorAll(".table-measure").length,
    };
  });
  console.log("Table allocation:", JSON.stringify(result));
  expect(result.changed).toBe(true);
  expect(result.after.height).toBeLessThan(result.before.height * 0.85);
  expect(result.after.widths[1]).toBeGreaterThan(result.before.widths[1]);
  expect(result.after.size).toBe(result.before.size);
  expect(result.overflow).toBe(false);
  expect(result.probes).toBe(0);
  await page.screenshot({ path: ".local/table-allocation-v019.png" });
});

test("CJK, formulas and narrow containers keep readable minimums; merged cells retain native layout", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js").then(
        async (m) => (await m.loadMath(), m),
      ),
      { optimizeTable } = await import("/src/table-layout.js");
    const host = document.createElement("article");
    host.className = "prose";
    host.style.cssText =
      "position:absolute;left:0;top:0;width:340px;max-width:none;padding:0";
    host.innerHTML = renderMarkdown(
      "| 项 | 说明 | 公式 |\n| --- | --- | --- |\n| 1 | 中文说明应尽量减少不必要的换行，保持整段阅读的连贯。 | $\\sum_{i=1}^{n} (x_i-y_i)^2$ |\n| 2 | 保持中文和英文正常字号 | `long_unbroken_identifier` |\n",
    ).html;
    document.body.append(host);
    await document.fonts.ready;
    const table = host.querySelector("table");
    optimizeTable(table);
    const wrapper = host.querySelector(".table-scroll"),
      math = host.querySelector(".katex");
    const narrow = {
      contained: host.scrollWidth <= host.clientWidth + 1,
      scrollable: wrapper.scrollWidth > wrapper.clientWidth,
      math:
        math.getBoundingClientRect().width <=
        math.closest("td").getBoundingClientRect().width,
      width: table.offsetWidth,
    };
    host.style.width = "1100px";
    optimizeTable(table);
    const wide = {
      fixed: table.classList.contains("reading-columns"),
      width: table.offsetWidth,
    };
    const merged = document.createElement("div");
    merged.className = "table-scroll";
    merged.innerHTML =
      '<table><tr><th colspan="2">Combined</th></tr><tr><td>A</td><td>B</td></tr></table>';
    host.append(merged);
    const changedMerged = optimizeTable(merged.querySelector("table"));
    return { narrow, wide, changedMerged };
  });
  expect(result.narrow.contained).toBe(true);
  expect(result.narrow.math).toBe(true);
  expect(result.wide.fixed).toBe(false);
  expect(result.changedMerged).toBe(false);
});

test("live reader and hover preview optimize automatically and retain cached layouts", async ({
  page,
}) => {
  await installFolio(page);
  await page.addInitScript(() => {
    const table =
      "| ID | Explanation | Notes |\n| --- | --- | --- |\n" +
      Array.from(
        { length: 10 },
        (_, i) =>
          `| ${i} | Repeated explanations need enough width for comfortable continuous reading. | ${i ? "OK" : "One long exception must not crowd all the other rows. ".repeat(8)} |`,
      ).join("\n");
    const file = {
      id: "tables",
      name: "Tables.md",
      path: "C:/fixture/Tables.md",
      version: "v1",
      text: "# Tables\n\n[Preview](Other.md)\n\n" + table,
    };
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [file],
        roots: [],
        settings: { sidebar: false, outline: false },
      }),
      preview: async () => ({
        ...file,
        id: "other",
        name: "Other.md",
        text: table,
      }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#content table.reading-columns")).toHaveCount(1);
  const cols = await page.locator("#content colgroup").innerHTML();
  await page.waitForTimeout(300);
  expect(await page.locator("#content colgroup").innerHTML()).toBe(cols);
  await page.getByRole("link", { name: "Preview", exact: true }).hover();
  await expect(page.locator("#link-preview table.reading-columns")).toHaveCount(
    1,
  );
  await expect(page.locator(".table-measure")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 600, height: 800 });
  await expect
    .poll(() => page.locator("#content colgroup").innerHTML())
    .not.toBe(cols);
  expect(
    await page
      .locator("#content")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
});
