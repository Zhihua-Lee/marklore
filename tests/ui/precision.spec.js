import { test, expect } from "@playwright/test";
// Standalone parser tests exercise the independent module, not proprietary fixtures.
test("math environments, table bars, inline display, task checkboxes and unknown commands", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js").then(
      async (m) => (await m.loadMath(), m),
    );
    const source =
      "| A | B |\n| - | - |\n| $|x|$ | $P(A|B)$ |\n\n\\begin{align}\na&=b+c\\\\\nd&=e\n\\end{align}\n\nInline $$x^2$$ end.\n\n- [x] Done\n- [ ] Todo\n\n$\\commandThatDoesNotExist{x}$";
    const html = renderMarkdown(source).html,
      box = document.createElement("div");
    box.innerHTML = html;
    return {
      math: box.querySelectorAll(".katex").length,
      cells: box.querySelectorAll("tbody td").length,
      errors: box.querySelectorAll(".math-error").length,
      checks: [...box.querySelectorAll("input")].map((e) => ({
        disabled: e.disabled,
        checked: e.checked,
      })),
      placeholder: /[\uE000-\uF8FF]|%%BLOCKMATH/.test(box.textContent),
    };
  });
  expect(result).toEqual({
    math: 4,
    cells: 2,
    errors: 1,
    checks: [
      { disabled: true, checked: true },
      { disabled: true, checked: false },
    ],
    placeholder: false,
  });
});
test("raw HTML image and Markdown Windows image keep local resource paths", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js").then(
      async (m) => (await m.loadMath(), m),
    );
    const box = document.createElement("div");
    box.innerHTML = renderMarkdown(
      '![win](<D:/notes/a b.png>)\n\n<img src="D:/notes/raw.png">\n\n![remote](https://example.com/tracker.png)',
      "test-id",
    ).html;
    return [...box.querySelectorAll("img")].map((e) => e.getAttribute("src"));
  });
  expect(result[0]).toContain("folio-asset://test-id/");
  expect(decodeURIComponent(result[0])).toContain("D:/notes/a%20b.png");
  expect(result[1]).toContain("raw.png");
  expect(result[2]).toBeNull();
});
test("source spans distinguish repeated words in nested list and quote", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js").then(
      async (m) => (await m.loadMath(), m),
    );
    const source =
      "## Map\n\nSame word **same** word.\n\n> Quote same word.\n\n- first same\n- second same";
    const box = document.createElement("div");
    box.innerHTML = renderMarkdown(source).html;
    return [...box.querySelectorAll("[data-text-from]")].map(
      (e) =>
        source.slice(Number(e.dataset.textFrom), Number(e.dataset.textTo)) ===
        e.textContent,
    );
  });
  expect(result.length).toBeGreaterThan(5);
  expect(result.every(Boolean)).toBeTruthy();
});
test("note content cannot create active scripts, forms, or dangerous navigation", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js").then(
      async (m) => (await m.loadMath(), m),
    );
    const box = document.createElement("div");
    box.innerHTML = renderMarkdown(
      '<iframe src="file:///C:/secret"></iframe>\n<form><button formaction="https://example.com">go</button></form>\n<a href="javascript:alert(1)">bad</a><svg onload="alert(1)"></svg>',
    ).html;
    return {
      bad: box.querySelectorAll("iframe,form,button,[onload],[formaction]")
        .length,
      href: box.querySelector("a")?.getAttribute("href"),
    };
  });
  expect(result.bad).toBe(0);
  expect(result.href).toBeNull();
});
test("Mermaid renders offline SVG without exposing clickable external content", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新笔记", exact: true }).click();
  await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js").then(
        async (m) => (await m.loadMath(), m),
      ),
      { renderDiagrams } = await import("/src/diagrams.js");
    document.querySelector("#content").innerHTML = renderMarkdown(
      "```mermaid\nflowchart LR\n  A[Read] --> B[Think]\n```",
    ).html;
    renderDiagrams(document.querySelector("#content"), "light", () => {});
  });
  await expect(page.locator(".diagram svg")).toBeVisible({ timeout: 20000 });
  expect(await page.locator(".diagram foreignObject").count()).toBe(0);
});
test("malformed dollars cannot leak internal table markers", async ({
  page,
}) => {
  await page.goto("/");
  const html = await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js").then(
      async (m) => (await m.loadMath(), m),
    );
    return renderMarkdown("| Cost | Item |\n| - | - |\n| $ price | other $ |")
      .html;
  });
  expect(html).not.toMatch(/[\uE000-\uF8FF]/);
});

test("identical table cells have distinct source locations", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js").then(
      async (m) => (await m.loadMath(), m),
    );
    const source = "| A | B |\n| - | - |\n| same | same |";
    const box = document.createElement("div");
    box.innerHTML = renderMarkdown(source).html;
    return [...box.querySelectorAll("tbody [data-text-from]")].map((el) =>
      Number(el.dataset.textFrom),
    );
  });
  expect(result).toEqual([22, 29]);
});
