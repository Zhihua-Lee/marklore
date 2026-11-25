import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

const FIXTURE = `---
title: 排版样例
tags: [排版, 测试]
---

# 排版样例：一致收敛与函数项级数

本节讨论函数项级数的**一致收敛**。设 $\\{f_n\\}$ 是定义在区间 $I$ 上的函数列，若对任意 $\\varepsilon > 0$，存在 $N$，使得当 $n > N$ 时对一切 $x \\in I$ 都有 $|f_n(x) - f(x)| < \\varepsilon$，则称 $f_n$ 在 $I$ 上一致收敛于 $f$。这一概念由 Weierstrass 在 1841 年前后系统提出，是分析学严格化的关键一步。

逐点收敛只要求对每个固定的 $x$ 成立，而一致收敛要求 $N$ 与 $x$ 无关。两者的差别在于量词顺序：前者是 $\\forall x\\,\\forall\\varepsilon\\,\\exists N$，后者是 $\\forall\\varepsilon\\,\\exists N\\,\\forall x$。

## 判别法

常用的判别法有以下几种：

- **Weierstrass M 判别法**：若 $|u_n(x)| \\le M_n$ 且 $\\sum M_n$ 收敛，则 $\\sum u_n(x)$ 一致收敛。
- **Abel 判别法**：适用于两个因子一个单调有界、一个一致收敛的情形。
- **Dirichlet 判别法**：部分和一致有界，另一因子单调趋于零。
  - 注意：单调性必须对每个 $x$ 成立。
  - 常见例子是 $\\sum \\frac{\\sin nx}{n}$ 在 $[\\delta, 2\\pi-\\delta]$ 上。

证明的步骤：

1. 写出 Cauchy 准则。
2. 用 Abel 变换估计部分和。
3. 取上确界，得到与 $x$ 无关的界。

> **注记**　一致收敛保证极限函数连续、可以逐项积分；逐项求导则需要导函数列一致收敛。很多教材把这一点放在习题里，容易被忽略。

### 一个反例

函数列 $f_n(x) = x^n$ 在 $[0,1]$ 上逐点收敛，但极限函数在 $x=1$ 处不连续，因此不一致收敛：

$$
\\lim_{n\\to\\infty} \\sup_{x\\in[0,1)} |x^n - 0| = 1 \\neq 0.
$$

下表比较了三种收敛方式：

| 收敛方式 | 对 $x$ 的要求 | 保持连续性 | 可逐项积分 |
| --- | --- | --- | --- |
| 逐点收敛 | 每个 $x$ 单独 | 否 | 否 |
| 一致收敛 | 所有 $x$ 同一个 $N$ | 是 | 是 |
| 内闭一致收敛 | 每个紧子集 | 是（局部） | 在紧子集上 |

代码里检查数值收敛时，可以这样写：

\`\`\`python
import numpy as np
xs = np.linspace(0, 0.999, 1000)
for n in (10, 100, 1000):
    print(n, np.max(np.abs(xs**n)))
\`\`\`

行内代码如 \`np.max\` 和中英混排 Python 3.12 的写法也要看起来协调。

<details>
<summary>展开：Dini 定理</summary>

紧集上单调的连续函数列逐点收敛到连续函数时，收敛是一致的。

</details>

- [ ] 补充 Dini 定理的证明
- [x] 整理判别法的适用条件

---

## English paragraph

Uniform convergence is stronger than pointwise convergence: the same $N$ must work for every $x$. A classic counterexample is $f_n(x) = x^n$ on $[0, 1]$, whose limit is discontinuous at $x = 1$.[^1]

[^1]: See any standard text on real analysis, for example Rudin, chapter 7.
`;

async function boot(page, text = FIXTURE, settings = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, settings }) => {
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [
            {
              id: "typo",
              name: "排版样例.md",
              path: "C:/notes/排版样例.md",
              version: "v1",
              text,
            },
          ],
          restored: [],
          roots: [],
          settings: {
            sidebar: false,
            outline: false,
            richEdit: true,
            ...settings,
          },
        }),
      });
    },
    { text, settings },
  );
  await page.goto("/");
  await page.locator("#content h1").waitFor();
}

async function waitForRendered(page, rootSelector) {
  await expect
    .poll(() =>
      page.evaluate(
        (sel) =>
          document.querySelectorAll(
            `${sel} [data-folio-math], ${sel} .math-pending`,
          ).length,
        rootSelector,
      ),
    )
    .toBe(0);
}

test("readingStyle modes (standard, relaxed, compact) match spec rhythm, Read === Edit parity, and HTML/PDF export", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await boot(page, FIXTURE, { richEdit: true });
  await waitForRendered(page, "#content");

  const measureReadRhythm = () =>
    page.evaluate(() => {
      const prose = document.querySelector("#content");
      const p0 = prose.querySelectorAll("p")[0];
      const p1 = prose.querySelectorAll("p")[1];
      const h1 = prose.querySelector("h1");
      const h2 = prose.querySelector("h2");
      const p2 = prose.querySelectorAll("p")[2];
      const ol = prose.querySelector("ol");
      const bq = prose.querySelector("blockquote");
      const math = prose.querySelector(".math-block");
      const table = prose.querySelector(".table-scroll");
      const tableEl = table.querySelector("table");
      const code = prose.querySelector(".code-block");
      const codePre = code.querySelector("pre");
      const hr = prose.querySelector("hr:not(.footnotes-sep)");
      const details = prose.querySelector("details:not(.front-matter)");
      const fm = prose.querySelector("details.front-matter");
      const gap = (a, b) =>
        Math.round(
          (b.getBoundingClientRect().top - a.getBoundingClientRect().bottom) *
            10,
        ) / 10;
      const cs = (el) => getComputedStyle(el);
      const blocks = [];
      const walk = (el) => {
        for (const ch of el.children) {
          if (
            ch.classList.contains("note-section") ||
            ch.classList.contains("section-body")
          ) {
            walk(ch);
            continue;
          }
          if (
            ch.classList.contains("section-rail") ||
            ch.classList.contains("footnotes-sep") ||
            ch.classList.contains("anchor-only")
          )
            continue;
          const r = ch.getBoundingClientRect();
          if (r.height > 0)
            blocks.push({ tag: ch.tagName, cls: ch.className, r });
        }
      };
      walk(prose);
      const compactGaps = [];
      for (let i = 1; i < blocks.length; i++) {
        compactGaps.push(blocks[i].r.top - blocks[i - 1].r.bottom);
      }
      for (const h of prose.querySelectorAll(
        ".note-section > h2, .note-section > h3",
      )) {
        const next = h.parentElement.querySelector(
          ":scope > .section-body > :first-child",
        );
        if (next)
          compactGaps.push(
            next.getBoundingClientRect().top - h.getBoundingClientRect().bottom,
          );
      }
      for (const list of prose.querySelectorAll("ul, ol")) {
        if (list.closest(".footnotes")) continue;
        const items = [...list.children].filter((c) => c.tagName === "LI");
        for (let i = 1; i < items.length; i++) {
          compactGaps.push(
            items[i].getBoundingClientRect().top -
              items[i - 1].getBoundingClientRect().bottom,
          );
        }
      }
      const dirichletLi = [...prose.querySelectorAll("li")].find((li) =>
        li.textContent.includes("Dirichlet"),
      );
      let readNestedOffset = null;
      if (dirichletLi) {
        const nested = dirichletLi.querySelector(":scope > ul");
        const liRect = dirichletLi.getBoundingClientRect();
        const lineBoxBottom =
          liRect.top + parseFloat(getComputedStyle(dirichletLi).lineHeight);
        readNestedOffset = nested.getBoundingClientRect().top - liRect.top;
        compactGaps.push(nested.getBoundingClientRect().top - lineBoxBottom);
      }
      const noteSize = parseFloat(cs(prose).fontSize);
      return {
        noteSize,
        bodyLhRatio: parseFloat(cs(p0).lineHeight) / noteSize,
        tableLhRatio: parseFloat(cs(tableEl).lineHeight) / noteSize,
        codeLhRatio:
          parseFloat(cs(codePre).lineHeight) / parseFloat(cs(codePre).fontSize),
        h1Fs: parseFloat(cs(h1).fontSize),
        h2Fs: parseFloat(cs(h2).fontSize),
        fmGap: gap(fm, h1),
        h1ToP: gap(h1, p0),
        pToH2: gap(p1, h2),
        h2ToP: gap(h2, p2),
        olToBq: gap(ol, bq),
        mathGap: gap(math.previousElementSibling, math),
        tableGap: gap(table.previousElementSibling, table),
        codeGap: gap(code.previousElementSibling, code),
        detailsGap: gap(details.previousElementSibling, details),
        hrGap: gap(prose.querySelector("ul.contains-task-list"), hr),
        compactGaps,
        readNestedOffset,
        topBlocks: blocks
          .filter((b) => !b.cls.includes("footnotes"))
          .map((b) => ({
            tag: b.tag,
            top: b.r.top - blocks[0].r.top,
            height: b.r.height,
          })),
      };
    });

  const measureEditBlocks = async () => {
    await page.keyboard.press("Control+2");
    await expect(page.locator("#rich-reader")).toBeVisible();
    await waitForRendered(page, "#rich .ProseMirror");
    const edit = await page.evaluate(() => {
      const pm = document.querySelector("#rich .ProseMirror");
      const dirichletLi = [...pm.querySelectorAll("li")].find((li) =>
        li.textContent.includes("Dirichlet"),
      );
      const editNestedOffset = dirichletLi
        ? dirichletLi.querySelector(":scope > ul").getBoundingClientRect().top -
          dirichletLi.getBoundingClientRect().top
        : null;
      const blocks = [];
      for (const ch of pm.children) {
        if (ch.classList.contains("ProseMirror-gapcursor")) continue;
        if (ch.classList.contains("rich-properties")) {
          const title = ch.querySelector(".fm-title");
          const fm = ch.querySelector("details.front-matter");
          if (title)
            blocks.push({ tag: "DIV", box: title.getBoundingClientRect() });
          if (fm)
            blocks.push({ tag: "DETAILS", box: fm.getBoundingClientRect() });
          continue;
        }
        if (ch.classList.contains("raw-block") && ch.dataset.kind === "text")
          continue;
        const r = ch.getBoundingClientRect();
        if (r.height > 0) blocks.push({ tag: ch.tagName, box: r });
      }
      return {
        editNestedOffset,
        blocks: blocks.map((b) => ({
          tag: b.tag,
          top: b.box.top - blocks[0].box.top,
          height: b.box.height,
        })),
      };
    });
    await page.keyboard.press("Control+1");
    await expect(page.locator("#content")).toBeVisible();
    return edit;
  };

  // 1) Default "standard" = v0.6.4 rhythm & heading scale (literata 1.7; other 1.8).
  const std = await measureReadRhythm();
  expect(std.bodyLhRatio).toBeCloseTo(1.7, 2);
  expect(std.tableLhRatio).toBeCloseTo(1.6, 2);
  expect(std.codeLhRatio).toBeCloseTo(1.65, 2);
  expect(std.h1Fs).toBeCloseTo(1.85 * 16, 1);
  expect(std.h2Fs).toBeCloseTo(1.5 * 16, 1);
  for (const [actual, expected] of [
    [std.fmGap, 13.8],
    [std.h1ToP, 20.7],
    [std.pToH2, 25.6],
    [std.h2ToP, 15.6],
    [std.olToBq, 20.8],
    [std.mathGap, 28],
    [std.tableGap, 22.4],
    [std.codeGap, 20],
    [std.detailsGap, 17.6],
    [std.hrGap, 32],
  ]) {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.5);
  }
  const stdEdit = await measureEditBlocks();
  expect(
    Math.abs(stdEdit.editNestedOffset - std.readNestedOffset),
  ).toBeLessThan(0.5);
  expect(stdEdit.blocks.length).toBe(std.topBlocks.length);
  for (let i = 0; i < stdEdit.blocks.length; i++) {
    expect(
      Math.abs(stdEdit.blocks[i].top - std.topBlocks[i].top),
      `standard block #${i} (${std.topBlocks[i].tag})`,
    ).toBeLessThan(0.5);
  }

  // Non-literata typeface under standard uses 1.8 body line height.
  await page.locator("#weight").click();
  await expect(
    page.locator("#settings-reading .setting:has(#reading-style) small"),
  ).toContainText("只改行高、段距和标题大小；栏宽在下面单独设置");
  const readingOrder = await page
    .locator("#settings-reading select, #settings-reading input")
    .evaluateAll((els) => els.map((e) => e.id));
  expect(readingOrder.indexOf("reading-style")).toBeGreaterThan(-1);
  expect(readingOrder.indexOf("reading-style")).toBeLessThan(
    readingOrder.indexOf("column-width"),
  );
  await page.locator("#typeface").selectOption("balanced");
  await page.locator("#appearance-close").click();
  const balancedStd = await measureReadRhythm();
  expect(balancedStd.bodyLhRatio).toBeCloseTo(1.8, 2);

  // Switch back to literata and test "relaxed" (1.85 / 1.65 / x1.15 margins).
  await page.locator("#weight").click();
  await page.locator("#typeface").selectOption("literata");
  await page.locator("#reading-style").selectOption("relaxed");
  await page.locator("#appearance-close").click();
  const rel = await measureReadRhythm();
  expect(rel.bodyLhRatio).toBeCloseTo(1.85, 2);
  expect(rel.tableLhRatio).toBeCloseTo(1.65, 2);
  expect(rel.codeLhRatio).toBeCloseTo(1.65, 2);
  expect(rel.h1Fs).toBeCloseTo(1.85 * 16, 1);
  for (const [actual, expected] of [
    [rel.fmGap, 13.75 * 1.15],
    [rel.h1ToP, 20.72 * 1.15],
    [rel.pToH2, 25.6 * 1.15],
    [rel.h2ToP, 15.6 * 1.15],
    [rel.olToBq, 20.8 * 1.15],
    [rel.mathGap, 28 * 1.15],
    [rel.tableGap, 22.4 * 1.15],
    [rel.codeGap, 20 * 1.15],
    [rel.detailsGap, 17.6 * 1.15],
    [rel.hrGap, 32 * 1.15],
  ]) {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.5);
  }
  const relEdit = await measureEditBlocks();
  expect(relEdit.blocks.length).toBe(rel.topBlocks.length);
  for (let i = 0; i < relEdit.blocks.length; i++) {
    expect(
      Math.abs(relEdit.blocks[i].top - rel.topBlocks[i].top),
      `relaxed block #${i} (${rel.topBlocks[i].tag})`,
    ).toBeLessThan(0.5);
  }

  // Test "compact" = next-test-18 (4-token rhythm, 1.7 / 1.5, 1.6..0.94 headings).
  await page.locator("#weight").click();
  await page.locator("#reading-style").selectOption("compact");
  await page.locator("#appearance-close").click();
  const cmp = await measureReadRhythm();
  expect(cmp.bodyLhRatio).toBeCloseTo(1.7, 2);
  expect(cmp.tableLhRatio).toBeCloseTo(1.5, 2);
  expect(cmp.codeLhRatio).toBeCloseTo(1.5, 2);
  expect(cmp.h1Fs).toBeCloseTo(1.6 * 16, 1);
  expect(cmp.h2Fs).toBeCloseTo(1.32 * 16, 1);
  const tokens = [0.28, 0.45, 0.95, 1.55].map((k) => k * cmp.noteSize);
  const clusters = [];
  for (const g of cmp.compactGaps) {
    expect(tokens.some((t) => Math.abs(g - t) <= 1)).toBe(true);
    if (!clusters.some((c) => Math.abs(c - g) <= 1)) clusters.push(g);
  }
  expect(clusters.length).toBeLessThanOrEqual(4);
  const cmpEdit = await measureEditBlocks();
  expect(cmpEdit.blocks.length).toBe(cmp.topBlocks.length);
  for (let i = 0; i < cmpEdit.blocks.length; i++) {
    expect(
      Math.abs(cmpEdit.blocks[i].top - cmp.topBlocks[i].top),
      `compact block #${i} (${cmp.topBlocks[i].tag})`,
    ).toBeLessThan(0.5);
  }

  // Verify HTML/PDF export obeys readingStyle.
  const captured = {};
  await page.evaluate(() => {
    window.__exports = [];
    window.folio.exportNote = async (payload) => {
      window.__exports.push(payload);
      return { canceled: false, warnings: payload.warnings };
    };
  });
  for (const style of ["relaxed", "standard", "compact"]) {
    await page.locator("#weight").click();
    await page.locator("#reading-style").selectOption(style);
    await page.locator("#appearance-close").click();
    await page.locator("#app-menu-toggle").click();
    await page
      .locator('#app-menu button[role="menuitem"]')
      .filter({ hasText: "导出 HTML" })
      .click();
    await expect
      .poll(() => page.evaluate(() => window.__exports.length))
      .toBe(Object.keys(captured).length + 1);
    captured[style] = await page.evaluate(() => window.__exports.at(-1));
  }
  const exportMetrics = {};
  const expPage = await page.context().newPage();
  for (const [style, payload] of Object.entries(captured)) {
    await expPage.setContent(
      `<!doctype html><html><head><style>${payload.css}</style></head><body><article>${payload.html}</article></body></html>`,
    );
    exportMetrics[style] = await expPage.evaluate(() => {
      const b = getComputedStyle(document.body);
      const h1 = document.querySelector("h1");
      const h2 = document.querySelector("h2");
      const p1 = document.querySelectorAll("p")[1];
      return {
        bodyLh: parseFloat(b.lineHeight) / parseFloat(b.fontSize),
        h1Fs: parseFloat(getComputedStyle(h1).fontSize),
        pToH2:
          h2.getBoundingClientRect().top - p1.getBoundingClientRect().bottom,
      };
    });
  }
  await expPage.close();
  expect(exportMetrics.relaxed.bodyLh).toBeCloseTo(1.85, 2);
  expect(exportMetrics.standard.bodyLh).toBeCloseTo(1.7, 2);
  expect(exportMetrics.compact.bodyLh).toBeCloseTo(1.7, 2);
  expect(exportMetrics.standard.h1Fs).toBeCloseTo(1.85 * 16, 1);
  expect(exportMetrics.compact.h1Fs).toBeCloseTo(1.6 * 16, 1);
  expect(exportMetrics.relaxed.pToH2).toBeGreaterThan(
    exportMetrics.standard.pToH2 + 2,
  );
  expect(exportMetrics.standard.pToH2).toBeGreaterThan(
    exportMetrics.compact.pToH2 + 0.5,
  );

  await page.locator("#app-menu-toggle").click();
  await page
    .locator('#app-menu button[role="menuitem"]')
    .filter({ hasText: "导出 PDF" })
    .click();
  await expect.poll(() => page.evaluate(() => window.__exports.length)).toBe(4);
  const pdfPayload = await page.evaluate(() => window.__exports.at(-1));
  expect(pdfPayload.format).toBe("pdf");
  expect(pdfPayload.css).toContain("--exp-lh:1.7");
  expect(pdfPayload.css).toContain("--exp-h2-m:1.55em 0 0.45em");
});

test("fluid note size and columnWidth options (window, measure, fixed, wide) match in Read and Edit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await boot(page, FIXTURE, { richEdit: true });

  const measureRead = () =>
    page.locator("#content").evaluate((el) => {
      const cs = getComputedStyle(el);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      return {
        fontSize: parseFloat(cs.fontSize),
        lineHeight: parseFloat(cs.lineHeight),
        measure: el.getBoundingClientRect().width - pad,
      };
    });
  const measureEdit = () =>
    page.locator("#rich .ProseMirror").evaluate((el) => {
      const cs = getComputedStyle(el);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      return el.getBoundingClientRect().width - pad;
    });

  // Default columnWidth ("fixed"): stays 680 px at both 1366 & 1920 while fluid size grows.
  const win1366 = await measureRead();
  expect(win1366.fontSize).toBeCloseTo(16, 1);
  expect(win1366.lineHeight / win1366.fontSize).toBeCloseTo(1.7, 2);
  expect(win1366.measure).toBeCloseTo(680, 1);

  await page.setViewportSize({ width: 1920, height: 1080 });
  const win1920 = await measureRead();
  expect(win1920.fontSize).toBeCloseTo(16 * 1.09, 2);
  expect(win1920.measure).toBeCloseTo(680, 1);

  for (const [cw, expected1920] of [
    ["window", 56 * 16 * 1.09],
    ["measure", 42 * 16 * 1.09],
    ["fixed", 680],
  ]) {
    await page.locator("#weight").click();
    await page.locator("#column-width").selectOption(cw);
    await page.locator("#appearance-close").click();
    await page.keyboard.press("Control+1");
    await expect(page.locator("#content")).toBeVisible();
    const readW = (await measureRead()).measure;
    expect(readW).toBeCloseTo(expected1920, 1);
    await page.keyboard.press("Control+2");
    await expect(page.locator("#rich .ProseMirror")).toBeVisible();
    const editW = await measureEdit();
    expect(Math.abs(editW - readW)).toBeLessThan(0.5);
  }

  await page.keyboard.press("Control+1");
  await page.locator("#width-toggle").click();
  const wide = await measureRead();
  expect(wide.measure).toBeGreaterThan(1200);
});

test("inline formula and following closing punctuation never wrap apart in Read or Edit", async ({
  page,
}) => {
  const sample =
    FIXTURE +
    "\n\n" +
    [
      "设任意函数列都在区间上成立 $f_n(x)=x^n$，并且满足一致收敛条件 $x=1$。我们还会遇到 $y$；以及 $z$：还有 $w$！或问号 $u$？以及英文 $a$, $b$. $c$; $d$! $e$? 和括号（见 $k$）。",
      "Another test where formula $x+y$， sits near wrap boundary with $(a+b)$」 and 「$c$』 plus $m$、 and $n$!",
    ].join("\n\n");
  await boot(page, sample);
  await waitForRendered(page, "#content");

  const countOrphans = async (selector) => {
    let orphans = 0;
    for (const width of [280, 320, 360, 410, 480, 560, 672]) {
      await page.evaluate(
        ({ selector, width }) => {
          const el = document.querySelector(selector);
          el.style.maxWidth = width + "px";
          el.style.width = width + "px";
          el.style.paddingLeft = "0px";
          el.style.paddingRight = "0px";
        },
        { selector, width },
      );
      orphans += await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        const punct = new Set([..."，。；：！？、）」』,.;:!?)"]);
        let bad = 0;
        for (const formula of el.querySelectorAll(".formula")) {
          let next = formula.nextSibling;
          while (
            next &&
            next.nodeType === 3 &&
            next.textContent.replace(/\u2060/g, "").length === 0
          )
            next = next.nextSibling;
          if (
            next &&
            next.nodeType === 1 &&
            next.classList.contains("ProseMirror-widget")
          ) {
            let after = next.nextSibling;
            while (after && after.nodeType === 3 && !after.textContent.length)
              after = after.nextSibling;
            if (
              after &&
              after.nodeType === 3 &&
              punct.has(after.textContent[0])
            )
              bad++;
            continue;
          }
          if (!next || next.nodeType !== 3) continue;
          const cleanIdx = next.textContent.search(/[^\u2060]/);
          if (cleanIdx < 0) continue;
          const ch = next.textContent[cleanIdx];
          if (!punct.has(ch)) continue;
          const fRects = [...formula.getClientRects()].filter(
            (r) => r.width > 0 && r.height > 0,
          );
          const fr =
            fRects[fRects.length - 1] || formula.getBoundingClientRect();
          const pr = document.createRange();
          pr.setStart(next, cleanIdx);
          pr.setEnd(next, cleanIdx + 1);
          const cb = pr.getBoundingClientRect();
          if (cb.top > fr.bottom - 2 || cb.left < fr.left - 1) bad++;
        }
        return bad;
      }, selector);
    }
    return orphans;
  };

  expect(await countOrphans("#content")).toBe(0);
  await page.keyboard.press("Control+2");
  await expect(page.locator("#rich-reader")).toBeVisible();
  await waitForRendered(page, "#rich .ProseMirror");
  expect(await countOrphans("#rich .ProseMirror")).toBe(0);
});

test("long inline formulas wrap inside narrow 700px column without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 800 });
  const longInline =
    "# Long inline math\n\n" +
    "在本节关于一致收敛与有限项和上界的讨论中，典型公式为 $a_1 + a_2 + \\cdots + a_{40} = \\sum_{k=1}^{40} a_k \\le M$，并应随中文段落自然换行而不溢出页边距。";
  await boot(page, longInline);
  await waitForRendered(page, "#content");

  const measureWrapped = (el) => {
    const formula = el.querySelector(".formula");
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
    const rects = [...formula.getClientRects()].filter(
      (r) => r.width > 0 && r.height > 0,
    );
    const tail = rects[rects.length - 1];
    let next = formula.nextSibling;
    while (next && next.nodeType === 3 && !next.textContent.length)
      next = next.nextSibling;
    const pr = document.createRange();
    pr.setStart(next, 0);
    pr.setEnd(next, 1);
    const comma = pr.getBoundingClientRect();
    return {
      overflow: el.scrollWidth - el.clientWidth,
      formulaHeight: formula.getBoundingClientRect().height,
      rects: rects.length,
      lineHeight,
      commaDetached: comma.top > tail.bottom - 2 || comma.left < tail.left - 1,
    };
  };

  const read = await page.locator("#content").evaluate(measureWrapped);
  expect(read.overflow).toBeLessThanOrEqual(1);
  expect(read.rects).toBeGreaterThanOrEqual(2);
  expect(read.formulaHeight).toBeGreaterThan(read.lineHeight * 1.4);
  expect(read.commaDetached).toBe(false);

  await page.keyboard.press("Control+2");
  await expect(page.locator("#rich-reader")).toBeVisible();
  await waitForRendered(page, "#rich .ProseMirror");
  const edit = await page
    .locator("#rich .ProseMirror")
    .evaluate(measureWrapped);
  expect(edit.overflow).toBeLessThanOrEqual(1);
  expect(edit.rects).toBeGreaterThanOrEqual(2);
  expect(edit.formulaHeight).toBeGreaterThan(edit.lineHeight * 1.4);
  expect(edit.commaDetached).toBe(false);
});

test("bundled variable Noto Sans SC renders real variable weights 300-550 and gates the typo lab", async ({
  browser,
}) => {
  const probeCjkFonts = async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "#content p [data-text-from]",
    });
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    await cdp.detach();
    return fonts;
  };
  const inspect = async (page) =>
    page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const p = getComputedStyle(document.querySelector("#content p"));
      const h2 = getComputedStyle(document.querySelector("#content h2"));
      const strong = getComputedStyle(
        document.querySelector("#content strong"),
      );
      const th = getComputedStyle(document.querySelector("#content th"));
      const summary = getComputedStyle(
        document.querySelector("#content details:not(.front-matter) > summary"),
      );
      return {
        varWeight: parseFloat(root.getPropertyValue("--note-weight")),
        varWght: parseFloat(root.getPropertyValue("--note-wght")),
        strongVar: parseFloat(root.getPropertyValue("--strong-weight")),
        pWeight: p.fontWeight,
        pVariation: p.fontVariationSettings,
        h2Weight: h2.fontWeight,
        strongWeight: strong.fontWeight,
        thWeight: th.fontWeight,
        summaryWeight: summary.fontWeight,
      };
    });

  for (const dpr of [1, 1.25]) {
    const ctx = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      deviceScaleFactor: dpr,
    });
    const page = await ctx.newPage();
    await boot(page, FIXTURE);
    await page.evaluate(() => document.fonts.ready);

    // 600 replaced by 300..550 options; normal build omits #typo-lab DOM and CSS.
    await expect(page.locator('#text-weight option[value="600"]')).toHaveCount(
      0,
    );
    await expect(
      page
        .locator("#text-weight option")
        .evaluateAll((els) => els.map((e) => e.value)),
    ).resolves.toEqual(["auto", "300", "350", "400", "450", "500", "550"]);
    await expect(page.locator("#reading-preset")).toHaveCount(0);
    await expect(page.locator("#reset-typography")).toHaveCount(1);
    if (process.env.VITE_TYPO_LAB !== "1") {
      await expect(page.locator("#typo-lab")).toHaveCount(0);
      await expect(page.locator("#typo-lab-style")).toHaveCount(0);
    }

    const autoState = await inspect(page);
    expect(autoState.varWeight).toBe(450);
    expect(autoState.varWght).toBe(450);
    expect(autoState.strongVar).toBe(650);
    expect(autoState.pWeight).toBe("450");
    expect(autoState.pVariation).toBe("normal");
    expect(autoState.h2Weight).toBe("650");
    expect(autoState.strongWeight).toBe("650");
    expect(autoState.thWeight).toBe("650");
    expect(autoState.summaryWeight).toBe("650");

    const autoFonts = await probeCjkFonts(page);
    expect(
      autoFonts.some(
        (f) => /Noto Serif SC/i.test(f.familyName) && f.isCustomFont,
      ),
      JSON.stringify(autoFonts),
    ).toBe(true);

    // Weight-note hidden on built-in stacks, visible on static system stacks.
    await page.locator("#weight").click();
    await expect(page.locator("#weight-note")).toHaveText("");
    await page.locator("#typeface").selectOption("classic");
    await expect(page.locator("#weight-note")).toHaveText(
      "系统字体非可变字体，细微浓度不明显",
    );
    await page.locator("#typeface").selectOption("literata");
    await expect(page.locator("#weight-note")).toHaveText("");
    await page.locator("#appearance-close").click();

    // Verify rendered ink pixel darkness increases across 300, 350, 450, 550.
    const masses = [];
    for (const w of ["300", "350", "450", "550"]) {
      await page.locator("#weight").click();
      await page.locator("#text-weight").selectOption(w);
      await page.locator("#appearance-close").click();
      await page.evaluate(() => document.fonts.ready);
      const box = await page.locator("#content p").first().boundingBox();
      const png = await page.screenshot({
        clip: {
          x: box.x,
          y: box.y,
          width: Math.min(220, box.width),
          height: box.height,
        },
      });
      const mass = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = "data:image/png;base64," + b64;
        await new Promise((r) => (img.onload = r));
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4)
          sum += 255 - (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11);
        return Math.round(sum);
      }, png.toString("base64"));
      masses.push(mass);
    }
    expect(masses[0]).toBeLessThan(masses[1]);
    expect(masses[1]).toBeLessThan(masses[2]);
    expect(masses[2]).toBeLessThan(masses[3]);

    if (dpr === 1) {
      await page.locator("#weight").click();
      await page.locator("#text-weight").selectOption("auto");
      await page.locator("#appearance-close").click();
      await page.locator("#theme").click();
      const darkThemeState = await inspect(page);
      expect(darkThemeState.varWeight).toBe(400);
      expect(darkThemeState.varWght).toBe(400);
      expect(darkThemeState.strongVar).toBe(600);
    }
    await ctx.close();
  }

  const ctxHi = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    deviceScaleFactor: 1.5,
  });
  const hiPage = await ctxHi.newPage();
  await boot(hiPage, FIXTURE);
  const hiState = await inspect(hiPage);
  expect(hiState.varWeight).toBe(400);
  expect(hiState.varWght).toBe(400);
  await ctxHi.close();
});

test("build-gated typography comparison lab toggles Read and Edit live when enabled and disappears cleanly when disabled", async ({
  page,
}) => {
  const allOld = {
    fluidSize: false,
    columnWidth: false,
    autoWeight: false,
    chineseFont: false,
    darkInk: false,
    yahei: false,
  };
  await page.setViewportSize({ width: 1366, height: 900 });
  await boot(page, FIXTURE, { richEdit: true, typoLab: allOld });
  await page.evaluate(() => document.fonts.ready);

  if (process.env.VITE_TYPO_LAB !== "1") {
    await expect(page.locator("#typo-lab")).toHaveCount(0);
    await expect(page.locator("#typo-lab-style")).toHaveCount(0);
    const attrCount = await page.evaluate(
      () =>
        [...document.documentElement.attributes].filter((a) =>
          a.name.startsWith("data-lab-"),
        ).length,
    );
    expect(attrCount).toBe(0);
    const readPara = await page
      .locator("#content p")
      .first()
      .evaluate((el) => ({
        w: Math.round(el.getBoundingClientRect().width),
        fw: getComputedStyle(el).fontWeight,
      }));
    expect(readPara.w).toBe(680);
    expect(readPara.fw).toBe("450");
    return;
  }

  // Settings only opens the panel; it floats beside the note, Settings closed.
  await page.locator("#weight").click();
  await expect(page.locator("#typo-lab")).toBeHidden();
  await page.locator("#typo-lab-open").click();
  await expect(page.locator("#appearance")).not.toHaveAttribute("open", "");
  await expect(page.locator("#typo-lab")).toBeVisible();
  await expect(page.locator("#typo-lab input[type=checkbox]")).toHaveCount(6);
  for (const removed of ["lineHeight", "spacing", "headingScale"]) {
    await expect(page.locator(`#lab-${removed}`)).toHaveCount(0);
  }
  await expect(page.locator("#typo-lab-aa")).toContainText(
    "在设置 → 文字抗锯齿 中切换，重启后生效",
  );
  const labels = await page
    .locator("#typo-lab .typo-lab-label > small")
    .evaluateAll((els) => els.map((e) => e.textContent));
  expect(labels.slice(0, 5).every((s) => /（默认）|\(default\)/.test(s))).toBe(
    true,
  );
  expect(labels[5]).toContain("微软雅黑");

  await page.locator("#typo-lab-all-old").click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  const oldMetrics = await page.evaluate(() => {
    const p = document.querySelector("#content p");
    return {
      pWidth: Math.round(p.getBoundingClientRect().width * 10) / 10,
      pFs: Math.round(parseFloat(getComputedStyle(p).fontSize) * 10) / 10,
      pWeight: getComputedStyle(p).fontWeight,
    };
  });
  expect(oldMetrics.pWidth).toBe(680);
  expect(oldMetrics.pFs).toBe(16);
  expect(oldMetrics.pWeight).toBe("400");

  await page.keyboard.press("Control+2");
  await expect(page.locator("#rich .ProseMirror h1")).toBeVisible();
  const oldEdit = await page.evaluate(() => {
    const p = document.querySelector("#rich .ProseMirror p");
    return {
      w: Math.round(p.getBoundingClientRect().width * 10) / 10,
      fw: getComputedStyle(p).fontWeight,
    };
  });
  expect(oldEdit.w).toBe(680);
  expect(oldEdit.fw).toBe("400");

  // Dark theme ink switch and YaHei typeface override.
  await expect(page.locator("#lab-darkInk")).not.toBeChecked();
  await expect(page.locator("#lab-yahei")).not.toBeChecked();
  await page.locator("#theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--reading-ink")
        .trim()
        .toLowerCase(),
    ),
  ).toBe("#e4e2de");

  // "全部新" turns columnWidth and yahei on (56em at 1920, Microsoft YaHei font).
  await page.locator("#typo-lab-all-new").click();
  await expect(page.locator("#lab-columnWidth")).toBeChecked();
  await expect(page.locator("#lab-darkInk")).toBeChecked();
  await expect(page.locator("#lab-yahei")).toBeChecked();
  const newEdit = await page.evaluate(() => {
    const p = document.querySelector("#rich .ProseMirror p");
    return {
      w: Math.round(p.getBoundingClientRect().width * 10) / 10,
      fw: getComputedStyle(p).fontWeight,
      fs: parseFloat(getComputedStyle(p).fontSize),
      family: getComputedStyle(p).fontFamily,
      typefaceAttr: document.documentElement.dataset.typeface,
      readingInk: getComputedStyle(document.documentElement)
        .getPropertyValue("--reading-ink")
        .trim()
        .toLowerCase(),
    };
  });
  expect(newEdit.w).toBeCloseTo(56 * newEdit.fs, 0);
  expect(newEdit.fw).toBe("400");
  expect(newEdit.typefaceAttr).toBe("yahei");
  expect(newEdit.family).toMatch(/^"?Microsoft YaHei/i);
  expect(newEdit.readingInk).toBe("#d3d0ca");
  expect(
    await page.evaluate(() => document.getElementById("typeface").value),
  ).toBe("literata");

  // "全部旧" turns both new switches back to their old side.
  await page.locator("#typo-lab-all-old").click();
  await expect(page.locator("#lab-darkInk")).not.toBeChecked();
  await expect(page.locator("#lab-yahei")).not.toBeChecked();

  // "默认" resets to default settings (dimmer dark ink on, YaHei off, columnWidth off).
  await page.locator("#typo-lab-default").click();
  await expect(page.locator("#lab-columnWidth")).not.toBeChecked();
  await expect(page.locator("#lab-yahei")).not.toBeChecked();
  for (const onKey of ["fluidSize", "autoWeight", "chineseFont", "darkInk"]) {
    await expect(page.locator(`#lab-${onKey}`)).toBeChecked();
  }
  const defEdit = await page.evaluate(() => {
    const p = document.querySelector("#rich .ProseMirror p");
    return {
      w: Math.round(p.getBoundingClientRect().width * 10) / 10,
      fw: getComputedStyle(p).fontWeight,
      typefaceAttr: document.documentElement.dataset.typeface,
      attrs: [...document.documentElement.attributes].filter((a) =>
        a.name.startsWith("data-lab-"),
      ).length,
    };
  });
  expect(defEdit.w).toBe(680);
  expect(defEdit.fw).toBe("400");
  expect(defEdit.typefaceAttr).toBe("literata");
  expect(defEdit.attrs).toBe(0);
  await page.locator("#theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page
      .locator("#rich .ProseMirror p")
      .first()
      .evaluate((p) => getComputedStyle(p).fontWeight),
  ).toBe("450");
});
