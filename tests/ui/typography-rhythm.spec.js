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

  // Default columnWidth ("window"): fills pane up to 56em at 1366 & 1920.
  const win1366 = await measureRead();
  expect(win1366.fontSize).toBeCloseTo(16, 1);
  expect(win1366.lineHeight / win1366.fontSize).toBeCloseTo(1.7, 2);
  expect(win1366.measure).toBeCloseTo(56 * 16, 1);

  await page.setViewportSize({ width: 1920, height: 1080 });
  const win1920 = await measureRead();
  expect(win1920.fontSize).toBeCloseTo(16 * 1.09, 2);
  expect(win1920.measure).toBeCloseTo(56 * 16 * 1.09, 1);

  for (const [cw, expected1920] of [
    ["measure", 42 * 16 * 1.09],
    ["fixed", 680],
    ["window", 56 * 16 * 1.09],
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
        (f) => /Noto Sans SC/i.test(f.familyName) && f.isCustomFont,
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
    lineHeight: false,
    spacing: false,
    headingScale: false,
    fluidSize: false,
    columnWidth: false,
    autoWeight: false,
    chineseFont: false,
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
    expect(readPara.w).toBe(896);
    expect(readPara.fw).toBe("450");
    return;
  }

  // Settings only opens the panel; it floats beside the note, Settings closed.
  await page.locator("#weight").click();
  await expect(page.locator("#typo-lab")).toBeHidden();
  await page.locator("#typo-lab-open").click();
  await expect(page.locator("#appearance")).not.toHaveAttribute("open", "");
  await expect(page.locator("#typo-lab")).toBeVisible();
  await expect(page.locator("#typo-lab input[type=checkbox]")).toHaveCount(7);
  await page.locator("#typo-lab-all-old").click();

  const oldMetrics = await page.evaluate(() => {
    const p = document.querySelector("#content p");
    const h1 = document.querySelector("#content h1");
    const h2 = document.querySelector("#content h2");
    const ul = document.querySelector("#content ul");
    const bq = document.querySelector("#content blockquote");
    const math = document.querySelector("#content .math-block");
    const table = document.querySelector("#content .table-scroll");
    const code = document.querySelector("#content .code-block");
    const hr = document.querySelector("#content hr:not(.footnotes-sep)");
    const gap = (a, b) =>
      Math.round(
        (b.getBoundingClientRect().top - a.getBoundingClientRect().bottom) * 10,
      ) / 10;
    return {
      pWidth: Math.round(p.getBoundingClientRect().width * 10) / 10,
      pWeight: getComputedStyle(p).fontWeight,
      h1Fs: Math.round(parseFloat(getComputedStyle(h1).fontSize) * 10) / 10,
      h1ToP: gap(h1, p),
      pToH2: gap(document.querySelectorAll("#content p")[1], h2),
      h2ToP: gap(h2, document.querySelectorAll("#content p")[2]),
      olToBq: gap(document.querySelector("#content ol"), bq),
      mathGap: gap(math.previousElementSibling, math),
      tableGap: gap(table.previousElementSibling, table),
      codeGap: gap(code.previousElementSibling, code),
      hrGap: gap(document.querySelector("#content ul.contains-task-list"), hr),
    };
  });
  expect(oldMetrics.pWidth).toBe(680);
  expect(oldMetrics.pWeight).toBe("400");
  expect(oldMetrics.h1Fs).toBeCloseTo(29.6, 1);
  expect(Math.abs(oldMetrics.h1ToP - 20.7)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(oldMetrics.pToH2 - 25.6)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(oldMetrics.h2ToP - 15.6)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(oldMetrics.olToBq - 20.8)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(oldMetrics.mathGap - 28)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(oldMetrics.tableGap - 22.4)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(oldMetrics.codeGap - 20)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(oldMetrics.hrGap - 32)).toBeLessThanOrEqual(0.5);

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

  // The panel stays open beside the note while switching modes.
  await expect(page.locator("#typo-lab")).toBeVisible();
  await page.locator("#typo-lab-all-new").click();
  const newEdit = await page.evaluate(() => {
    const p = document.querySelector("#rich .ProseMirror p");
    return {
      w: Math.round(p.getBoundingClientRect().width * 10) / 10,
      fw: getComputedStyle(p).fontWeight,
    };
  });
  expect(newEdit.w).toBe(896);
  expect(newEdit.fw).toBe("450");
});
