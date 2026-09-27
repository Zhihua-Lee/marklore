import { test, expect } from "@playwright/test";

test("stretchy arrows retain SVG geometry after sanitizing", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js").then(
      async (m) => (await m.loadMath(), m),
    );
    const tex = String.raw`\boxed{\text{weak convergence}\Rightarrow\text{pointwise bounded family in }V^{**}\xRightarrow{\text{UBP}}\text{uniformly bounded norms}.}`;
    const host = document.querySelector("#content");
    document.querySelector("main").dataset.empty = "false";
    host.innerHTML = renderMarkdown("\\[\n" + tex + "\n\\]").html;
    return {
      clean: host.innerHTML,
      svg: [...host.querySelectorAll("svg")].map((el) => ({
        html: el.outerHTML,
        box: el.getBoundingClientRect().toJSON(),
      })),
    };
  });
  expect(result.svg.length).toBeGreaterThan(0);
  for (const svg of result.svg) {
    expect(svg.html).toContain(' d="');
    expect(svg.box.width).toBeGreaterThan(10);
  }
  await page.screenshot({ path: ".local/math-arrow-fixed.png" });
});

test("SVG geometry survives for arrows and accents while active content is stripped", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js").then(
      async (m) => (await m.loadMath(), m),
    );
    const host = document.createElement("article");
    host.innerHTML = renderMarkdown(
      String.raw`$$\xrightarrow{Riesz}\xleftarrow{A}\xRightarrow{UBP}\overrightarrow{AB}\widehat{ABC}\underbrace{a+b}_{c}\sqrt{x}$$` +
        '\n\n<svg onload="alert(1)"><path d="M0 0L10 10" onclick="alert(1)"/><a href="javascript:alert(1)">bad</a><script>alert(1)</script></svg>',
    ).html;
    return {
      errors: host.querySelectorAll(".math-error").length,
      paths: [...host.querySelectorAll(".katex path")].map((el) =>
        el.getAttribute("d"),
      ),
      active: host.querySelectorAll(
        'script,[onload],[onclick],[href^="javascript:"]',
      ).length,
    };
  });
  expect(result.errors).toBe(0);
  expect(result.paths.length).toBeGreaterThanOrEqual(7);
  expect(result.paths.every((d) => d && d.length > 10)).toBe(true);
  expect(result.active).toBe(0);
});

test("quotes emphasize text in light and dark themes without making all math bold", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js").then(
      async (m) => (await m.loadMath(), m),
    );
    document.querySelector("main").dataset.empty = "false";
    document.querySelector("#content").innerHTML = renderMarkdown(
      String.raw`> Banach 空间 \(V\) reflexive，当且仅当每个有界序列都存在弱收敛子列。`,
    ).html;
  });
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    const styles = await page.locator("#content blockquote").evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        color: s.color,
        ink: getComputedStyle(document.querySelector("#content")).color,
        weight: s.fontWeight,
        border: s.borderLeftWidth,
      };
    });
    expect(styles.color).toBe(styles.ink);
    expect(Number(styles.weight)).toBe(400);
    expect(styles.border).toBe("4px");
    await expect(page.locator("blockquote .katex")).toHaveCSS(
      "font-weight",
      "400",
    );
    await page.screenshot({ path: `.local/quote-${theme}.png` });
  }
});

const escapedExample = String.raw`\\[
\boxed{
L:V\to W
\\;\Longrightarrow\\;
\ell\_w\in V^\*
\\;\xrightarrow{\text{Riesz}}\\;
L^\*w\in V.
}
\\]`;
const standardExample = String.raw`\[
\boxed{
L:V\to W
\;\Longrightarrow\;
\ell_w\in V^*
\;\xrightarrow{\text{Riesz}}\;
L^*w\in V.
}
\]`;

async function render(page, source) {
  return page.evaluate(async (source) => {
    const { renderMarkdown } = await import("/src/markdown.js").then(
        async (m) => (await m.loadMath(), m),
      ),
      host = document.createElement("article");
    host.innerHTML = renderMarkdown(source).html;
    return {
      math: host.querySelectorAll(".katex").length,
      errors: [...host.querySelectorAll(".math-error")].map((el) => ({
        text: el.textContent,
        title: el.title,
      })),
      formulas: [...host.querySelectorAll(".katex")].map((el) => el.innerHTML),
      annotations: [...host.querySelectorAll("annotation")].map(
        (el) => el.textContent,
      ),
      blocks: [...host.querySelectorAll(".math-block")].map((el) => ({
        from: Number(el.dataset.from),
        to: Number(el.dataset.to),
      })),
      spans: [...host.querySelectorAll("[data-text-from]")].map((el) => ({
        from: Number(el.dataset.textFrom),
        to: Number(el.dataset.textTo),
        text: el.textContent,
      })),
      code: [...host.querySelectorAll("pre code, :not(pre) > code")].map(
        (el) => el.textContent,
      ),
    };
  }, source);
}

test("copied double-escaped Riesz display renders identically to standard TeX", async ({
  page,
}) => {
  await page.goto("/");
  const escaped = await render(page, escapedExample),
    standard = await render(page, standardExample);
  expect(escaped.math).toBe(1);
  expect(standard.math).toBe(1);
  expect(escaped.errors).toEqual([]);
  expect(standard.errors).toEqual([]);
  expect(escaped.formulas).toEqual(standard.formulas);
  expect(escaped.annotations[0]).toContain(
    String.raw`\xrightarrow{\text{Riesz}}`,
  );
});

test("compatibility preserves original document offsets and never alters code fences", async ({
  page,
}) => {
  await page.goto("/");
  const before = "Before 中文.\n\n",
    after = "\n\nAfter word.\n\n",
    source =
      before +
      escapedExample +
      after +
      "```tex\n" +
      escapedExample +
      "\n```\n\n`" +
      String.raw`V^\*` +
      "`";
  const result = await render(page, source);
  expect(result.math).toBe(1);
  expect(result.blocks).toEqual([
    { from: before.length, to: before.length + escapedExample.length + 1 },
  ]);
  expect(result.code).toEqual([escapedExample + "\n", String.raw`V^\*`]);
  for (const span of result.spans)
    expect(source.slice(span.from, span.to)).toBe(span.text);
});

test("normal and copied aligned rows retain TeX double-backslash line breaks", async ({
  page,
}) => {
  await page.goto("/");
  const body = String.raw`\begin{aligned}
a&=b+c\\
d&=e
\end{aligned}`;
  const standard = await render(page, "\\[\n" + body + "\n\\]"),
    escaped = await render(page, "\\\\[\n" + body + "\n\\\\]");
  expect(standard.errors).toEqual([]);
  expect(escaped.errors).toEqual([]);
  expect(escaped.formulas).toEqual(standard.formulas);
  expect(escaped.annotations[0]).toContain("a&=b+c\\\\\n");
});

test("literal underscores in standard math and text arguments retain their meaning", async ({
  page,
}) => {
  await page.goto("/");
  const literal = String.raw`\[
\text{snake\_case} + x\_y
\]`,
    copied = String.raw`\\[
\text{nested {snake\_case}} + \operatorname{a\_b} + \ell\_w + V^{\*}
\\]`;
  const standard = await render(page, literal),
    escaped = await render(page, copied);
  expect(standard.errors).toEqual([]);
  expect(standard.annotations[0]).toContain(String.raw`x\_y`);
  expect(escaped.errors).toEqual([]);
  expect(escaped.annotations[0]).toContain(
    String.raw`\text{nested {snake\_case}}`,
  );
  expect(escaped.annotations[0]).toContain(String.raw`\operatorname{a\_b}`);
  expect(escaped.annotations[0]).toContain(String.raw`\ell_w + V^{*}`);
});

test("unknown commands remain errors and ordinary escaped brackets stay text", async ({
  page,
}) => {
  await page.goto("/");
  const source = String.raw`\\[
\commandThatDoesNotExist{x}
\\]`;
  const unknown = await render(page, source),
    brackets = await render(
      page,
      String.raw`\\[
just literal brackets
\\]`,
    ),
    inline = await render(page, String.raw`Example \\[\boxed{x}\\] in text.`);
  expect(unknown.errors).toHaveLength(1);
  expect(unknown.errors[0].title).toContain("Undefined control sequence");
  expect(unknown.errors[0].text).toContain(
    String.raw`\commandThatDoesNotExist{x}`,
  );
  expect(brackets.math).toBe(0);
  expect(inline.math).toBe(0);
});

test("normal xrightarrow supports labels above and below without compatibility repair", async ({
  page,
}) => {
  await page.goto("/");
  const source = String.raw`\[ V \xrightarrow[\text{below}]{\text{Riesz}} V^* \]`,
    result = await render(page, source);
  expect(result.math).toBe(1);
  expect(result.errors).toEqual([]);
  expect(result.annotations[0]).toContain(
    String.raw`\xrightarrow[\text{below}]{\text{Riesz}}`,
  );
});
