import { test, expect } from "@playwright/test";

test("source edits update the outline without redrawing the hidden preview", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    window.mock.previewHeading = document.querySelector("#content h1");
  });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n\n## Updated source outline\n");
  await expect(
    page
      .locator("#outline")
      .getByRole("button", { name: "Updated source outline", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        window.mock.previewHeading === document.querySelector("#content h1"),
    ),
  ).toBe(true);
  await expect(page.locator("#content h2")).toHaveCount(0);
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(page.locator("#content h2")).toContainText(
    "Updated source outline",
  );
});

const mathText = String.raw`# 混排 Typography

普通中文 English text **重要 Strong**。

阅读时，字体应该让推理本身成为重点，而不是让眼睛费力辨认。 Clear typography keeps attention on the argument. Compare the size and weight of Latin letters, Chinese characters, and mathematical notation in the same paragraph.

$x + \mathbf{v} + \boldsymbol{\theta} + \text{中文} + \textbf{粗体}$
`;
const longText = Array.from(
  { length: 55 },
  (_, i) =>
    `## Section ${i}\n\nParagraph ${i}: 中文 English notes keep the same reading position when panels move. ${"A long sentence makes wrapping depend on the available reading width. ".repeat(3)}\n\n$x_${i}^2$\n\n`,
).join("");

async function boot(page, { count = 1, text = mathText } = {}) {
  await page.addInitScript(
    ({ count, text }) => {
      const files = Array.from({ length: count }, (_, i) => ({
        id: `appearance-${i}`,
        name: `Note ${i} — 很长的中英文标题 Long notebook title.md`,
        path: `C:/synthetic/appearance-${i}.md`,
        text,
        version: "v1",
      }));
      window.mock = { files, handlers: {}, session: null };
      window.folio = {
        on: (name, fn) => {
          window.mock.handlers[name] = fn;
        },
        ready: async () => ({
          incoming: files,
          restored: [],
          roots: [],
          settings: JSON.parse(
            localStorage.getItem("appearance-session") || "null",
          )?.settings,
        }),
        read: async () => ({ unchanged: true }),
        session: async (value) => {
          window.mock.session = value;
          localStorage.setItem("appearance-session", JSON.stringify(value));
        },
        list: async () => [],
        pickFiles: async () => [],
        link: async () => null,
      };
    },
    { count, text },
  );
  await page.goto("/");
  await expect(page.getByRole("tab")).toHaveCount(count);
  await expect(page.locator("#content h1, #content h2").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function appearance(page) {
  await page.locator("#weight").click();
  await expect(page.getByRole("dialog", { name: "外观与布局" })).toBeVisible();
}
async function closeAppearance(page) {
  await page.getByRole("button", { name: "关闭外观设置" }).click();
}
async function actualFonts(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const evidence = {};
  for (const [name, selector] of Object.entries({
    prose: "#content p [data-text-from]",
    math: "#content .katex .mathnormal",
    cjkMath: "#content .katex .cjk_fallback:not(.textbf)",
  })) {
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    expect(nodeId, selector).toBeGreaterThan(0);
    evidence[name] = (
      await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
    ).fonts;
  }
  await cdp.detach();
  return evidence;
}

test("default layout separates the left library from the right outline", async ({
  page,
}) => {
  await boot(page);
  await expect(page.locator("#sidebar > #library-panel")).toBeVisible();
  await expect(page.locator("#right-sidebar > #outline-panel")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "切换文件夹浏览" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "切换本文目录" }),
  ).toHaveAttribute("aria-expanded", "true");
  const geometry = await page.evaluate(() => {
    const library = document
      .querySelector("#library-panel")
      .getBoundingClientRect();
    const main = document.querySelector("main").getBoundingClientRect();
    const outline = document
      .querySelector("#outline-panel")
      .getBoundingClientRect();
    return {
      libraryRight: library.right,
      mainLeft: main.left,
      mainRight: main.right,
      outlineLeft: outline.left,
    };
  });
  expect(geometry.libraryRight).toBeLessThanOrEqual(geometry.mainLeft + 1);
  expect(geometry.outlineLeft).toBeGreaterThanOrEqual(geometry.mainRight - 1);
  await page.getByRole("button", { name: "应用菜单", exact: true }).click();
  await page.screenshot({ path: ".local/visual-v012/menu.png" });
  await page.keyboard.press("Escape");
});

test("panels stack, swap, hide and restore their saved locations", async ({
  page,
}) => {
  await boot(page);
  await appearance(page);
  await page.locator("#outline-placement").selectOption("left");
  await expect(page.locator("#sidebar")).toHaveAttribute(
    "data-stacked",
    "true",
  );
  await expect(
    page.locator("#sidebar > .side-panel:not([hidden])"),
  ).toHaveCount(2);
  await expect(page.locator("#right-sidebar")).toBeHidden();
  await page.locator("#library-placement").selectOption("right");
  await expect(page.locator("#sidebar > #outline-panel")).toBeVisible();
  await expect(page.locator("#right-sidebar > #library-panel")).toBeVisible();
  await page.locator("#outline-placement").selectOption("hidden");
  await expect(page.locator("#sidebar")).toBeHidden();
  await closeAppearance(page);
  await expect
    .poll(() => page.evaluate(() => window.mock.session?.settings))
    .toMatchObject({
      sidebar: true,
      librarySide: "right",
      outline: false,
      outlineSide: "left",
    });
  await page.reload();
  await expect(page.locator("#right-sidebar > #library-panel")).toBeVisible();
  await expect(page.locator("#outline-panel")).toBeHidden();
  await page.getByRole("button", { name: "切换本文目录" }).click();
  await expect(page.locator("#sidebar > #outline-panel")).toBeVisible();
});

test("typeface and weight retain mathematical bold, italic and actual CJK font selection", async ({
  page,
}, testInfo) => {
  await boot(page);
  await appearance(page);
  await page.locator("#typeface").selectOption("balanced");
  await closeAppearance(page);
  await page.evaluate(() => document.fonts.ready);
  const evidence = await actualFonts(page);
  console.log("Actual Chromium font selection:", JSON.stringify(evidence));
  await testInfo.attach("actual-platform-fonts", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
  // This intentionally fails if the declared unified family silently falls back.
  expect(
    evidence.prose.some((font) => /Noto Sans SC/i.test(font.familyName)),
    JSON.stringify(evidence),
  ).toBe(true);
  expect(
    evidence.math.some(
      (font) => /KaTeX/i.test(font.familyName) && font.isCustomFont,
    ),
    JSON.stringify(evidence),
  ).toBe(true);
  expect(
    evidence.cjkMath.some((font) => /Noto Sans SC/i.test(font.familyName)),
    JSON.stringify(evidence),
  ).toBe(true);
  await page.screenshot({ path: ".local/visual-v012/mixed-type-light.png" });
  await appearance(page);
  await page.screenshot({ path: ".local/visual-v012/appearance-settings.png" });
  for (const [typeface, family] of [
    ["balanced", "Noto Sans SC"],
    ["classic", "Arial"],
    ["book", "Cambria"],
  ]) {
    await page.locator("#typeface").selectOption(typeface);
    for (const weight of ["400", "450", "500"]) {
      await page.locator("#text-weight").selectOption(weight);
      const typography = await page.evaluate(() => {
        const content = document.querySelector("#content"),
          math = content.querySelector(".katex");
        const style = (el) => {
          const css = getComputedStyle(el);
          return {
            family: css.fontFamily,
            weight: css.fontWeight,
            style: css.fontStyle,
            size: parseFloat(css.fontSize),
            transform: css.transform,
            stroke: css.webkitTextStrokeWidth,
            shadow: css.textShadow,
          };
        };
        return {
          prose: style(content),
          math: style(math),
          bold: style(math.querySelector(".mathbf")),
          symbol: style(math.querySelector(".boldsymbol")),
          cjk: style(math.querySelector(".cjk_fallback:not(.textbf)")),
          cjkBold: style(math.querySelector(".cjk_fallback.textbf")),
          sizeRatio:
            parseFloat(getComputedStyle(math).fontSize) /
            parseFloat(getComputedStyle(content).fontSize),
        };
      });
      expect(typography.prose.family).toContain(family);
      expect(typography.prose.weight).toBe(weight);
      expect(typography.math.family).toContain("KaTeX_Main");
      expect(typography.math.weight).toBe("400");
      expect(typography.bold.weight).toBe("700");
      expect(typography.symbol.weight).toBe("700");
      expect(typography.symbol.style).toBe("italic");
      expect(typography.cjk.family).toContain(family);
      expect(typography.cjk.weight).toBe("400");
      expect(typography.cjkBold.weight).toBe("700");
      expect(typography.cjk.size / typography.prose.size).toBeCloseTo(1, 3);
      expect(typography.cjkBold.size / typography.prose.size).toBeCloseTo(1, 3);
      expect(typography.sizeRatio).toBeCloseTo(1.21, 2);
      for (const styles of [typography.prose, typography.math]) {
        expect(styles.transform).toBe("none");
        expect(styles.stroke).toBe("0px");
        expect(styles.shadow).toBe("none");
      }
    }
  }
  await closeAppearance(page);
  await expect
    .poll(() => page.evaluate(() => window.mock.session?.settings))
    .toMatchObject({ typeface: "book", weight: 500 });
  await page.setViewportSize({ width: 820, height: 900 });
  const readSize = await page
    .locator("#content")
    .evaluate((el) => getComputedStyle(el).fontSize);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  expect(
    await page
      .locator("#content")
      .evaluate((el) => getComputedStyle(el).fontSize),
  ).toBe(readSize);
});

test("long overflowing tabs keep every close glyph inside the compact bar", async ({
  page,
}) => {
  await boot(page, { count: 20 });
  await expect(page.locator(".topbar")).toHaveAttribute(
    "data-overflow",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "向左浏览标签" }),
  ).toBeVisible();
  for (const width of [1360, 820]) {
    await page.setViewportSize({ width, height: 900 });
    const result = await page.evaluate(() => {
      const bar = document.querySelector(".topbar").getBoundingClientRect(),
        host = document.querySelector("#tabs");
      return {
        height: bar.height,
        overflowY: getComputedStyle(host).overflowY,
        scrollbar: getComputedStyle(host).scrollbarWidth,
        boxes: [...host.querySelectorAll(".tab-close, .tab-close svg")].map(
          (el) => {
            const box = el.getBoundingClientRect();
            return {
              top: box.top - bar.top,
              bottom: bar.bottom - box.bottom,
              width: box.width,
              height: box.height,
            };
          },
        ),
      };
    });
    expect(result.height).toBeCloseTo(43, 3);
    expect(result.overflowY).toBe("hidden");
    expect(result.scrollbar).toBe("none");
    for (const box of result.boxes) {
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeGreaterThanOrEqual(0);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }
  }
});

test("arrow controls and dragging browse the strip while keyboard arrows select tabs", async ({
  page,
}) => {
  await boot(page, { count: 20 });
  const scroll = () => page.locator("#tabs").evaluate((el) => el.scrollLeft);
  const selected = await page
    .getByRole("tab", { selected: true })
    .textContent();
  const initial = await scroll();
  await page.getByRole("button", { name: "向左浏览标签" }).click();
  await expect.poll(scroll).toBeLessThan(initial);
  const afterBack = await scroll();
  await page.getByRole("button", { name: "向右浏览标签" }).click();
  await expect.poll(scroll).toBeGreaterThan(afterBack);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(selected);
  const dragStart = await page.locator("#tabs").evaluate((host) => {
    const viewport = host.getBoundingClientRect();
    for (const label of host.querySelectorAll(".tab-label")) {
      const box = label.getBoundingClientRect();
      const left = Math.max(box.left, viewport.left),
        right = Math.min(box.right, viewport.right);
      if (right - left > 50)
        return { x: left + 15, y: (box.top + box.bottom) / 2 };
    }
    throw Error("No visible tab label for drag gesture");
  });
  const beforeDrag = await scroll();
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 200, dragStart.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(scroll).toBeLessThan(beforeDrag);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(selected);
  await page.getByRole("tab", { selected: true }).focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Note 0 —",
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "Note 1 —",
  );
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { selected: true })).toHaveText(selected);
  await expect(page.locator(".tab-label[tabindex='0']")).toHaveCount(1);
});

test("typing keeps tab DOM and does not snap the scrolled-away strip", async ({
  page,
}) => {
  await boot(page, { count: 18 });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.evaluate(() => {
    window.mock.activeButton = document.querySelector(
      ".tab-label[aria-selected='true']",
    );
    document.querySelector("#tabs").scrollLeft = 0;
  });
  await page.keyboard.type("\nKeep the current DOM and strip position.");
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "● Note 17 —",
  );
  expect(
    await page.evaluate(
      () =>
        window.mock.activeButton ===
        document.querySelector(".tab-label[aria-selected='true']"),
    ),
  ).toBe(true);
  expect(
    await page.locator("#tabs").evaluate((el) => el.scrollLeft),
  ).toBeLessThan(2);
  await expect(page.locator(".cm-content")).toContainText(
    "Keep the current DOM",
  );
});

test("theme and layout retain article nodes and semantic reading position", async ({
  page,
}) => {
  await boot(page, { text: longText });
  await page.locator("#reader").evaluate((el) => {
    const heading = el.querySelector("#section-30");
    el.scrollTop +=
      heading.getBoundingClientRect().top - el.getBoundingClientRect().top - 32;
    window.mock.headingNode = heading;
    window.mock.mathNode = el.querySelector(".katex");
  });
  const delta = () =>
    page
      .locator("#reader")
      .evaluate((el) =>
        Math.abs(
          el.querySelector("#section-30").getBoundingClientRect().top -
            el.getBoundingClientRect().top -
            32,
        ),
      );
  await appearance(page);
  await page.locator("#theme").click();
  await closeAppearance(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(delta).toBeLessThan(80);
  await page.screenshot({ path: ".local/visual-v012/reading-dark.png" });
  expect(
    await page.evaluate(
      () =>
        window.mock.headingNode === document.querySelector("#section-30") &&
        window.mock.mathNode === document.querySelector("#reader .katex"),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "切换本文目录" }).click();
  await expect(page.locator("#right-sidebar")).toBeHidden();
  await expect.poll(delta).toBeLessThan(100);
  await appearance(page);
  await page.locator("#library-placement").selectOption("right");
  await closeAppearance(page);
  await expect(page.locator("#right-sidebar > #library-panel")).toBeVisible();
  await expect.poll(delta).toBeLessThan(100);
  expect(
    await page.evaluate(
      () => window.mock.headingNode === document.querySelector("#section-30"),
    ),
  ).toBe(true);
});
