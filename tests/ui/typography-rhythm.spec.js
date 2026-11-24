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

test("fixture note uses <= 4 distinct vertical rhythm gaps matching tokens and Read === Edit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await boot(page);
  await waitForRendered(page, "#content");

  const read = await page.evaluate(() => {
    const prose = document.querySelector("#content");
    const noteSize = parseFloat(getComputedStyle(prose).fontSize);
    const tokens = {
      tight: 0.28 * noteSize,
      inner: 0.45 * noteSize,
      block: 0.95 * noteSize,
      section: 1.55 * noteSize,
    };

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

    const gaps = [];
    for (let i = 1; i < blocks.length; i++) {
      gaps.push({
        kind: `${blocks[i - 1].tag}->${blocks[i].tag}`,
        gap: blocks[i].r.top - blocks[i - 1].r.bottom,
      });
    }
    for (const h of prose.querySelectorAll(
      ".note-section > h2, .note-section > h3",
    )) {
      const next = h.parentElement.querySelector(
        ":scope > .section-body > :first-child",
      );
      if (next)
        gaps.push({
          kind: `${h.tagName}->${next.tagName}`,
          gap:
            next.getBoundingClientRect().top - h.getBoundingClientRect().bottom,
        });
    }
    for (const list of prose.querySelectorAll("ul, ol")) {
      if (list.closest(".footnotes")) continue;
      const items = [...list.children].filter((c) => c.tagName === "LI");
      for (let i = 1; i < items.length; i++) {
        gaps.push({
          kind: "li->li",
          gap:
            items[i].getBoundingClientRect().top -
            items[i - 1].getBoundingClientRect().bottom,
        });
      }
    }
    // Nested list starts with inner gap from its parent item's first line box.
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
      gaps.push({
        kind: "li-text->nested-ul",
        gap: nested.getBoundingClientRect().top - lineBoxBottom,
      });
    }

    return {
      noteSize,
      tokens,
      gaps,
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

  const clusters = [];
  for (const item of read.gaps) {
    const matched = Object.values(read.tokens).some(
      (t) => Math.abs(item.gap - t) <= 1,
    );
    expect(
      matched,
      `${item.kind}: ${item.gap} not within 1px of ${JSON.stringify(read.tokens)}`,
    ).toBe(true);
    if (!clusters.some((c) => Math.abs(c - item.gap) <= 1)) {
      clusters.push(item.gap);
    }
  }
  expect(clusters.length).toBeLessThanOrEqual(4);

  // Switch to Edit and check Read === Edit alignment.
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
    const seenFm = new Set();
    for (const ch of pm.children) {
      if (ch.classList.contains("ProseMirror-gapcursor")) continue;
      if (ch.classList.contains("rich-properties")) {
        const title = ch.querySelector(".fm-title");
        const fm = ch.querySelector("details.front-matter");
        if (title)
          blocks.push({
            tag: "DIV",
            box: title.getBoundingClientRect(),
          });
        if (fm)
          blocks.push({
            tag: "DETAILS",
            box: fm.getBoundingClientRect(),
          });
        seenFm.add(ch);
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

  if (read.readNestedOffset !== null && edit.editNestedOffset !== null) {
    expect(
      Math.abs(edit.editNestedOffset - read.readNestedOffset),
    ).toBeLessThan(0.5);
  }
  expect(edit.blocks.length).toBe(read.topBlocks.length);
  for (let i = 0; i < edit.blocks.length; i++) {
    expect(
      Math.abs(edit.blocks[i].top - read.topBlocks[i].top),
      `block #${i} (${read.topBlocks[i].tag}) top delta`,
    ).toBeLessThan(0.5);
  }
});

test("fluid note size and 42em column measure respond cleanly from 1366 to 1920 and preserve wide mode", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await boot(page);

  const measureBox = () =>
    page.locator("#content").evaluate((el) => {
      const cs = getComputedStyle(el);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      return {
        fontSize: parseFloat(cs.fontSize),
        lineHeight: parseFloat(cs.lineHeight),
        measure: el.getBoundingClientRect().width - pad,
      };
    });

  const at1366 = await measureBox();
  expect(at1366.fontSize).toBeCloseTo(16, 1);
  expect(at1366.lineHeight / at1366.fontSize).toBeCloseTo(1.7, 2);
  expect(at1366.measure).toBeCloseTo(42 * 16, 1);

  await page.setViewportSize({ width: 1920, height: 1080 });
  const at1920 = await measureBox();
  expect(at1920.fontSize).toBeCloseTo(16 * 1.09, 2);
  expect(at1920.measure).toBeCloseTo(42 * 16 * 1.09, 1);

  await page.locator("#width-toggle").click();
  const wide = await measureBox();
  expect(wide.measure).toBeGreaterThan(1200);
});

test("inline formula and following closing punctuation never wrap apart in Read or Edit", async ({
  page,
}) => {
  const sample =
    "# Wrap\n\n" +
    [
      "设任意函数列都在区间上成立 $f_n(x)=x^n$，并且满足一致收敛条件 $x=1$。我们还会遇到 $y$；以及 $z$：还有 $w$！或问号 $u$？以及英文 $a$, $b$. $c$; $d$! $e$? 和括号（见 $k$）。",
      "Another test where formula $x+y$， sits near wrap boundary with $(a+b)$」 and 「$c$』 plus $m$、 and $n$!",
    ].join("\n\n");
  await boot(page, sample);
  await waitForRendered(page, "#content");

  const countOrphans = async (selector) => {
    let orphans = 0;
    for (const width of [280, 320, 360, 410, 480, 560]) {
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
          while (next && next.nodeType === 3 && !next.textContent.length)
            next = next.nextSibling;
          if (!next || next.nodeType !== 3) continue;
          const ch = next.textContent[0];
          if (!punct.has(ch)) continue;
          const fr = formula.getBoundingClientRect();
          const pr = document.createRange();
          pr.setStart(next, 0);
          pr.setEnd(next, 1);
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

test("auto body weight responds to theme and DPR, and dropped 600 option stays absent", async ({
  browser,
}) => {
  const ctx1 = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await ctx1.newPage();
  await boot(page, FIXTURE);

  await expect(page.locator('#text-weight option[value="600"]')).toHaveCount(0);

  const weights = () =>
    page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        body: parseFloat(root.getPropertyValue("--note-weight")),
        strong: parseFloat(root.getPropertyValue("--strong-weight")),
        heading: parseFloat(root.getPropertyValue("--heading-weight")),
      };
    });

  expect(await weights()).toEqual({ body: 450, strong: 650, heading: 650 });
  await page.locator("#theme").click();
  expect(await weights()).toEqual({ body: 400, strong: 600, heading: 600 });
  await ctx1.close();

  const ctxHi = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    deviceScaleFactor: 1.5,
  });
  const hiPage = await ctxHi.newPage();
  await boot(hiPage, FIXTURE);
  expect(
    await hiPage.evaluate(() =>
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--note-weight",
        ),
      ),
    ),
  ).toBe(400);
  await ctxHi.close();
});
