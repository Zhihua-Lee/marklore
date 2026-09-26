import { test, expect } from "@playwright/test";

const typographyText =
  "# Typography 字体\n\nLiterata makes long-form English reading feel familiar. 中文与英文并列，**Strong emphasis** 保留层次。\n\nInline $x + \\mathbf{v}$ and code `monospace_code`\n\n```js\nconst readable = true;\n```\n";
const longText = Array.from(
  { length: 60 },
  (_, i) =>
    `## Section ${i}\n\nParagraph ${i}. 中文与 English retain the same position when reading width changes. ${"The current paragraph should remain in view while its lines reflow to the available width. ".repeat(4)}\n\n`,
).join("");

async function boot(page, text = typographyText, folder = false) {
  await page.addInitScript(
    ({ text, folder }) => {
      const file = {
        id: "minimal-note",
        name: "Layout.md",
        path: "C:/synthetic/Layout.md",
        text,
        version: "v1",
      };
      window.mock = { session: null, handlers: {} };
      window.folio = {
        on: (name, callback) => {
          window.mock.handlers[name] = callback;
        },
        ready: async () => ({
          incoming: [file],
          restored: [],
          roots: [],
          settings: JSON.parse(
            localStorage.getItem("minimal-session") || "null",
          )?.settings,
        }),
        read: async () => ({ unchanged: true }),
        session: async (value) => {
          window.mock.session = value;
          localStorage.setItem("minimal-session", JSON.stringify(value));
        },
        ...(folder
          ? {
              currentFolder: async () => ({
                id: "folder",
                path: "C:/synthetic",
                name: "synthetic",
              }),
            }
          : {}),
        list: async () => {
          window.mock.listCalls = (window.mock.listCalls || 0) + 1;
          return folder
            ? [{ name: "Layout.md", path: file.path, directory: false }]
            : [];
        },
        pickFiles: async () => [],
        link: async () => null,
      };
    },
    { text, folder },
  );
  await page.goto("/");
  await expect(
    page.getByRole("tab", { name: "Layout.md", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#content h1, #content h2").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
async function openAppearance(page) {
  await page.locator("#weight").click();
  await expect(page.locator("#appearance")).toBeVisible();
}
async function closeAppearance(page) {
  await page.locator("#appearance-close").click();
}
test("current folder follows the note, navigation typography persists and reopening avoids rescans", async ({
  page,
}) => {
  await boot(
    page,
    "# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\n**Strong** and *italic*.\n\n---\n\nText",
    true,
  );
  const file = page.locator('#tree .file[aria-current="page"]');
  await expect(file).toHaveText("Layout.md");
  const initial = await page.evaluate(() => window.mock.listCalls);
  await page.locator("#sidebar-toggle").click();
  await expect(page.locator("#sidebar")).toBeHidden();
  await page.locator("#sidebar-toggle").click();
  await expect(file).toBeVisible();
  expect(await page.evaluate(() => window.mock.listCalls)).toBe(initial);
  await openAppearance(page);
  await page.locator("#navigation-size").selectOption("11");
  await page.locator("#tab-size").selectOption("10");
  await closeAppearance(page);
  const values = await page.evaluate(() => {
    const style = (q) => getComputedStyle(document.querySelector(q));
    return {
      file: [style("#tree .file").fontSize, style("#tree summary").fontWeight],
      tab: style(".tab-label").fontSize,
      headings: [
        ...document.querySelectorAll("#content :is(h1,h2,h3,h4,h5,h6)"),
      ].map((el) => {
        const rail = el.parentElement.querySelector(":scope > .section-rail");
        const fold = el.querySelector(".fold").getBoundingClientRect();
        return {
          size: parseFloat(getComputedStyle(el).fontSize),
          weight: getComputedStyle(el).fontWeight,
          alignment: Math.abs(
            rail.getBoundingClientRect().left +
              rail.getBoundingClientRect().width / 2 -
              (fold.left + fold.width / 2),
          ),
        };
      }),
      em: style("#content em").fontStyle,
    };
  });
  expect(values.file).toEqual(["11px", "400"]);
  expect(values.tab).toBe("10px");
  expect(values.em).toBe("italic");
  for (let i = 0; i < values.headings.length; i++) {
    expect(values.headings[i].weight).toBe("600");
    expect(values.headings[i].alignment).toBeLessThan(1);
    if (i)
      expect(values.headings[i].size).toBeLessThan(values.headings[i - 1].size);
  }
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator(".modes")).toHaveCSS("--mode-index", "1");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".modes")
      .evaluate((el) => getComputedStyle(el, "::before").transitionDuration),
  ).toBe("0s");
  await expect
    .poll(() =>
      page.evaluate(() => window.mock.session?.settings.navigationSize),
    )
    .toBe(11);
  await page.reload();
  await expect(page.locator("#tree .file")).toHaveCSS("font-size", "11px");
  await page.screenshot({ path: ".local/layout-v0111.png" });
});

for (const dpr of [1, 1.25, 1.5, 2]) {
  test.describe(`reading at device scale ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });
    test("natural text spacing and boxed formulas have no vertical scrollbars", async ({
      page,
    }) => {
      await boot(
        page,
        String.raw`# 对应位置 Typography

对应的位置，普通中文 English **位置与对应 Strong**。

$$
\boxed{J(V)=V^{**}},
$$

$$
\boxed{\frac{\sum_{n=1}^{\infty}x_n}{\sqrt{1+x^2}}}
$$`,
      );
      await page.locator("#sidebar-toggle").click();
      await page.locator("#outline-toggle").click();
      await expect(page.locator(".dock:visible")).toHaveCount(0);
      for (const zoom of [80, 100, 150, 200]) {
        await openAppearance(page);
        await page.locator("#zoom-reset").click();
        for (let i = 0; i < Math.abs(zoom - 100) / 10; i++)
          await page.locator(zoom < 100 ? "#zoom-out" : "#zoom-in").click();
        await closeAppearance(page);
        const metrics = await page.evaluate(() => ({
          dpr: devicePixelRatio,
          spacing: getComputedStyle(document.querySelector("#content p"))
            .letterSpacing,
          weight: getComputedStyle(document.querySelector("#content p"))
            .fontWeight,
          transform: getComputedStyle(document.querySelector("#content"))
            .transform,
          formulas: [...document.querySelectorAll(".math-block")].map((el) => {
            const box = el.getBoundingClientRect();
            const glyphs = el
              .querySelector(".katex-html")
              .getBoundingClientRect();
            return {
              vertical: getComputedStyle(el).overflowY,
              overflow: el.scrollWidth - el.clientWidth,
              insetTop: glyphs.top - box.top,
              insetBottom: box.bottom - glyphs.bottom,
            };
          }),
        }));
        expect(metrics.dpr).toBeCloseTo(dpr, 5);
        expect(metrics.spacing).toBe("normal");
        expect(metrics.weight).toBe("400");
        expect(metrics.transform).toBe("none");
        for (const formula of metrics.formulas) {
          expect(formula.vertical).toBe("hidden");
          expect(formula.overflow).toBeLessThanOrEqual(1);
          expect(formula.insetTop).toBeGreaterThanOrEqual(0);
          expect(formula.insetBottom).toBeGreaterThanOrEqual(0);
        }
        if (zoom === 80)
          await page.screenshot({ path: `.local/reading-v019-dpr-${dpr}.png` });
      }
    });
  });
}

test("file actions, adjacent new tab, corner panels and reading controls stay grouped", async ({
  page,
}) => {
  await boot(page);
  await expect(page.locator(".document-tools > button")).toHaveCount(3);
  expect(
    await page
      .locator(".document-tools > button")
      .evaluateAll((els) => els.map((el) => el.id)),
  ).toEqual(["open", "save", "app-menu-toggle"]);
  await expect(
    page.locator("main > #panel-controls-left #sidebar-toggle"),
  ).toBeVisible();
  await expect(
    page.locator("main > #panel-controls-right #outline-toggle"),
  ).toBeVisible();
  await expect(page.locator(".reading-tools > button").last()).toHaveAttribute(
    "id",
    "weight",
  );
  await page.locator("#theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  for (const width of [1360, 640, 480]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const tabs = document.querySelector("#tabs").getBoundingClientRect();
      const add = document.querySelector("#new").getBoundingClientRect();
      const bar = document.querySelector(".topbar");
      return {
        gap: add.left - tabs.right,
        excess: bar.scrollWidth - bar.clientWidth,
      };
    });
    expect(layout.gap).toBeLessThanOrEqual(5);
    expect(layout.excess).toBeLessThanOrEqual(1);
  }
});

test("sidebars animate in both directions and reduced motion disables transitions", async ({
  page,
}) => {
  await boot(page, longText);
  await expect
    .poll(() =>
      page.locator("#sidebar").evaluate((el) => el.getAnimations().length),
    )
    .toBe(0);
  const closing = await page.evaluate(async () => {
    const dock = document.querySelector("#sidebar");
    const width = dock.getBoundingClientRect().width;
    document.querySelector("#sidebar-toggle").click();
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    return {
      width,
      during: dock.getBoundingClientRect().width,
      animated: dock
        .getAnimations()
        .some((a) => a.transitionProperty === "width"),
    };
  });
  expect(closing.animated).toBe(true);
  expect(closing.during).toBeGreaterThan(0);
  await expect(page.locator("#sidebar")).toBeHidden();
  const opening = await page.evaluate(async () => {
    const dock = document.querySelector("#sidebar");
    document.querySelector("#sidebar-toggle").click();
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    return dock.getAnimations().some((a) => a.transitionProperty === "width");
  });
  expect(opening).toBe(true);
  await expect
    .poll(() =>
      page.locator("#sidebar").evaluate((el) => el.getAnimations().length),
    )
    .toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#sidebar-toggle").click();
  await expect(page.locator("#sidebar")).toBeHidden();
  expect(
    await page.locator("#sidebar").evaluate((el) => el.getAnimations().length),
  ).toBe(0);
  await page
    .locator("#outline button")
    .filter({ hasText: "Section 30" })
    .click();
  await expect
    .poll(() =>
      page
        .locator("#reader")
        .evaluate((el) =>
          Math.abs(
            el.querySelector("#section-30").getBoundingClientRect().top -
              el.getBoundingClientRect().top -
              32,
          ),
        ),
    )
    .toBeLessThan(2);
});

test("ordinary prose has one weight across lists, quotes and tables at 80 percent", async ({
  page,
}) => {
  await boot(
    page,
    "# Reading\n\nRegular English 普通中文.\n\n- Regular English 普通中文.\n\n> Regular English 普通中文.\n\n| Column |\n| --- |\n| Regular English 普通中文. |\n\n**Strong emphasis 粗体** and $\\mathbf{v}+x$.",
  );
  await openAppearance(page);
  await page.locator("#zoom-out").click();
  await page.locator("#zoom-out").click();
  for (const typeface of ["literata", "balanced", "classic", "book"]) {
    await page.locator("#typeface").selectOption(typeface);
    for (const weight of ["auto", "450", "500"]) {
      await page.locator("#text-weight").selectOption(weight);
      const styles = await page.evaluate(() =>
        [
          "#content .section-body > p",
          "#content li",
          "#content blockquote p",
          "#content td",
        ].map((selector) => {
          const s = getComputedStyle(document.querySelector(selector));
          return {
            weight: s.fontWeight,
            size: s.fontSize,
            family: s.fontFamily,
          };
        }),
      );
      for (const value of styles) expect(value).toEqual(styles[0]);
      expect(styles[0].weight).toBe(weight === "auto" ? "400" : weight);
    }
  }
  await page.locator("#reading-preset").click();
  await closeAppearance(page);
  await page.setViewportSize({ width: 640, height: 800 });
  await page.locator("#sidebar-toggle").click();
  await page.locator("#outline-toggle").click();
  const measure = await page.evaluate(() => {
    const content = document.querySelector("#content"),
      section = content.querySelector(".note-section");
    return {
      width: section.getBoundingClientRect().width,
      padding: getComputedStyle(section).paddingLeft,
    };
  });
  expect(measure.width).toBeGreaterThanOrEqual(590);
  expect(measure.padding).toBe("0px");
  await page.screenshot({ path: ".local/reading-v018-80-percent.png" });
});

test("nested chapter rails, collapsed summaries and quiet reading rhythm", async ({
  page,
}) => {
  const source = String.raw`# Functional analysis

English and 中文 share a quiet reading surface.

## Weak convergence

> Banach 空间 \(V\) reflexive，当且仅当每个有界序列都存在弱收敛子列。

### A bounded sequence

1. **Weakly convergent sequence is bounded**

   \[
   u_n\rightharpoonup u\Longrightarrow\sup_n\|u_n\|<\infty.
   \]

2. **Reflexive space**

   \[
   V\simeq V^{**}.
   \]

---

Paragraph after the divider.

## Another chapter

Retained when the other chapter is folded.
`;
  await boot(page, source);
  const parent = page.locator(
    '.note-section[data-fold-key="weak-convergence"]',
  );
  const child = page.locator(
    '.note-section[data-fold-key="a-bounded-sequence"]',
  );
  expect((await child.boundingBox()).x).toBeGreaterThan(
    (await parent.boundingBox()).x,
  );
  const rail = parent.locator(":scope > .section-rail");
  const before = await parent.boundingBox();
  expect((await rail.boundingBox()).height).toBeCloseTo(before.height, 0);
  await rail.hover();
  expect((await parent.boundingBox()).height).toBeCloseTo(before.height, 0);
  await rail.click({ position: { x: 5, y: 60 } });
  await expect(parent).toHaveClass(/collapsed/);
  await expect(parent.locator(":scope > h2 > .section-summary")).toBeVisible();
  await expect(parent.locator(":scope > h2 > .fold")).toHaveText("▸");
  await expect(rail).toHaveAttribute("aria-expanded", "false");
  expect((await rail.boundingBox()).height).toBeLessThan(before.height / 2);
  await page.screenshot({ path: ".local/reading-v017-collapsed.png" });
  await rail.focus();
  await page.keyboard.press("Enter");
  await expect(parent).not.toHaveClass(/collapsed/);
  await expect(child).toBeVisible();
  await expect(page.locator("main > footer, #path, #progress")).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Layout.md", exact: true }),
  ).toHaveAttribute("title", "C:/synthetic/Layout.md");
  const styles = await page.evaluate(() => {
    const q = (s) => document.querySelector(s),
      css = (s) => getComputedStyle(q(s));
    return {
      rule: q("#content hr").getBoundingClientRect().width,
      parent: q("#content hr").parentElement.getBoundingClientRect().width,
      ruleHeight: css("#content hr").height,
      line: css("#content h2").borderBottomWidth,
      mathMargin: css("#content .katex-display").marginTop,
      paper: css("#reader").backgroundColor,
      filter: css("#content").filter,
      shadow: css("#content").textShadow,
      summaryHidden: css("#content .section-summary").display,
    };
  });
  expect(styles.rule / styles.parent).toBeCloseTo(1, 2);
  expect(styles.ruleHeight).toBe("1px");
  expect(styles.line).toBe("0px");
  expect(styles.mathMargin).toBe("0px");
  expect(styles.paper).toBe("rgb(245, 244, 240)");
  expect(styles.filter).toBe("none");
  expect(styles.shadow).toBe("none");
  expect(styles.summaryHidden).toBe("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    await page.screenshot({ path: `.local/reading-v017-${theme}.png` });
  }
  await page.setViewportSize({ width: 480, height: 800 });
  await page.locator("#sidebar-toggle").click();
  await page.locator("#outline-toggle").click();
  await expect(child.locator(":scope > h3 > .fold")).toBeInViewport();
  await page.screenshot({ path: ".local/reading-v017-narrow.png" });
});

for (const deviceScaleFactor of [1, 1.25, 2]) {
  test.describe(`chapter marker polish at device scale ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });
    test("arrow stays on the first-line centre and its guide starts below the node", async ({
      page,
    }) => {
      await boot(
        page,
        "# Chapter 章节\n\nBody.\n\n## Long heading with enough words to wrap across several lines in a narrow column\n\nBody.\n\n### Detail\n\nBody.\n\n#### Fourth\n\nBody.\n\n##### Fifth\n\nBody.\n\n###### Sixth\n\nBody.",
      );
      await page.setViewportSize({ width: 760, height: 900 });
      await page.locator("#sidebar-toggle").click();
      await page.locator("#outline-toggle").click();
      for (const theme of ["light", "dark"]) {
        for (const zoom of [50, 80, 100, 200]) {
          await page.evaluate(
            ({ theme, zoom }) => {
              document.documentElement.dataset.theme = theme;
              document.documentElement.style.setProperty(
                "--note-size",
                `${(16 * zoom) / 100}px`,
              );
            },
            { theme, zoom },
          );
          const measurements = await page
            .locator("#content .note-section")
            .evaluateAll((sections) =>
              sections.map((section) => {
                const heading = section.firstElementChild;
                const fold = heading.querySelector(".fold"),
                  node = fold.getBoundingClientRect();
                const rail = section.querySelector(":scope > .section-rail"),
                  box = rail.getBoundingClientRect();
                const guide = getComputedStyle(rail, "::before");
                return {
                  axis: Math.abs(
                    box.left +
                      parseFloat(guide.left) +
                      parseFloat(guide.width) / 2 -
                      (node.left + node.width / 2),
                  ),
                  baseline: Math.abs(
                    node.top +
                      node.height / 2 -
                      (heading.getBoundingClientRect().top +
                        parseFloat(getComputedStyle(heading).lineHeight) / 2),
                  ),
                  gap:
                    box.top + parseFloat(guide.top) - (node.top + node.height),
                  lineWidth: parseFloat(guide.width),
                };
              }),
            );
          for (const item of measurements) {
            expect(item.axis).toBeLessThan(0.1);
            expect(item.baseline).toBeLessThan(0.1);
            expect(item.gap).toBeGreaterThanOrEqual(-0.1);
            expect(item.lineWidth).toBe(1);
          }
        }
      }
      await page.evaluate(() =>
        document.documentElement.style.setProperty("--note-size", "16px"),
      );
      const fold = page.locator("#content .fold").first();
      await fold.hover();
      await page.screenshot({
        path: `.local/chapter-marker-${deviceScaleFactor}-expanded.png`,
      });
      await fold.click();
      await expect(fold).toHaveAttribute("aria-expanded", "false");
      const collapsedRail = page.locator("#content .section-rail").first();
      expect(
        await collapsedRail.evaluate(
          (el) => getComputedStyle(el, "::before").height,
        ),
      ).toBe("12px");
      await page.screenshot({
        path: `.local/chapter-marker-${deviceScaleFactor}-collapsed.png`,
      });
      await fold.focus();
      await page.keyboard.press("Enter");
      await expect(fold).toHaveAttribute("aria-expanded", "true");
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(
        await fold.evaluate(
          (el) => getComputedStyle(el, "::after").transitionDuration,
        ),
      ).toBe("0s");
    });
  });
}

test("half-screen widths keep the reader full width and toolbar reachable", async ({
  page,
}) => {
  await boot(page);
  for (const width of [680, 640, 512, 480]) {
    await page.setViewportSize({ width, height: 600 });
    const layout = await page.evaluate(() => {
      const main = document.querySelector("main").getBoundingClientRect();
      return {
        mainWidth: main.width,
        overflow: document.documentElement.scrollWidth > innerWidth,
        left: getComputedStyle(document.querySelector("#sidebar")).position,
        right: getComputedStyle(document.querySelector("#right-sidebar"))
          .position,
        controls: [...document.querySelectorAll(".toolbar button")]
          .filter((el) => el.getClientRects().length)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right };
          }),
      };
    });
    expect(layout.mainWidth).toBeGreaterThanOrEqual(width - 2);
    expect(layout.overflow).toBe(false);
    expect(layout.left).toBe("absolute");
    expect(layout.right).toBe("absolute");
    for (const box of layout.controls) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
    }
  }
  await page.locator("#sidebar-toggle").click();
  await page.locator("#outline-toggle").click();
  await expect(page.locator("#sidebar")).toBeHidden();
  await expect(page.locator("#right-sidebar")).toBeHidden();
  expect(
    (await page.locator("#content .fold").first().boundingBox()).x,
  ).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: ".local/half-screen-480.png" });
});

test("reading preset replaces saved Arial, adapts small text and preserves math and zoom", async ({
  page,
}) => {
  await boot(page);
  await openAppearance(page);
  await page.locator("#typeface").selectOption("classic");
  await page.locator("#text-weight").selectOption("400");
  for (let i = 0; i < 3; i++) await page.locator("#zoom-out").click();
  await expect
    .poll(() => page.evaluate(() => window.mock.session?.settings))
    .toMatchObject({ typeface: "classic", zoom: 70, weight: 400 });
  await page.reload();
  await openAppearance(page);
  await expect(page.locator("#typeface")).toHaveValue("classic");
  await page.locator("#reading-preset").click();
  await expect(page.locator("#typeface")).toHaveValue("literata");
  await expect(page.locator("#text-weight")).toHaveValue("auto");
  await expect(page.locator("#zoom-reset")).toHaveText("70%");
  await closeAppearance(page);
  await expect(page.locator("#content p").first()).toHaveCSS(
    "font-weight",
    "400",
  );
  await expect(page.locator("#content p").first()).toHaveCSS(
    "font-size",
    "11.2px",
  );
  await expect(page.locator("#content strong")).toHaveCSS("font-weight", "600");
  await expect(page.locator("#content .formula > .katex")).toHaveCSS(
    "font-weight",
    "400",
  );
  await expect(page.locator("#content .katex .mathbf").first()).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect
    .poll(() => page.evaluate(() => window.mock.session?.settings))
    .toMatchObject({ typeface: "literata", zoom: 70, weight: "auto" });
  await page.reload();
  await expect(page.locator("#content p").first()).toHaveCSS(
    "font-weight",
    "400",
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: ".local/visual-v014/reading-70.png" });
  await openAppearance(page);
  await page.locator("#zoom-out").click();
  await expect(page.locator("#content p").first()).toHaveCSS(
    "font-weight",
    "400",
  );
  await page.locator("#text-weight").selectOption("400");
  await expect(page.locator("#content p").first()).toHaveCSS(
    "font-weight",
    "400",
  );
});

test("panel toggles follow the panel side and remain reachable when panels are hidden", async ({
  page,
}) => {
  await boot(page);
  await expect(
    page.locator("#panel-controls-left #sidebar-toggle"),
  ).toBeVisible();
  await expect(
    page.locator("#panel-controls-right #outline-toggle"),
  ).toBeVisible();
  await openAppearance(page);
  await page.locator("#library-placement").selectOption("right");
  await page.locator("#outline-placement").selectOption("left");
  await closeAppearance(page);
  await expect(
    page.locator("#panel-controls-right #sidebar-toggle"),
  ).toBeVisible();
  await expect(
    page.locator("#panel-controls-left #outline-toggle"),
  ).toBeVisible();
  await page.locator("#sidebar-toggle").click();
  await page.locator("#outline-toggle").click();
  await expect(page.locator("#library-panel")).toBeHidden();
  await expect(page.locator("#outline-panel")).toBeHidden();
  await expect(
    page.locator("#panel-controls-right #sidebar-toggle"),
  ).toBeVisible();
  await expect(
    page.locator("#panel-controls-left #outline-toggle"),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.mock.session?.settings))
    .toMatchObject({
      librarySide: "right",
      outlineSide: "left",
      sidebar: false,
      outline: false,
    });
  await page.reload();
  await expect(
    page.locator("#panel-controls-right #sidebar-toggle"),
  ).toBeVisible();
  await expect(
    page.locator("#panel-controls-left #outline-toggle"),
  ).toBeVisible();
  await page.locator("#sidebar-toggle").click();
  await expect(page.locator("#right-sidebar #library-panel")).toBeVisible();
});

test("document controls remain adjacent in the single tab row as sidebars change", async ({
  page,
}) => {
  await boot(page);
  const centered = async () => {
    const result = await page.evaluate(() => {
      const bar = document.querySelector(".topbar").getBoundingClientRect();
      const modes = document.querySelector(".modes").getBoundingClientRect();
      const tools = document
        .querySelector(".reading-tools")
        .getBoundingClientRect();
      return {
        delta: tools.left - modes.right,
        fits: modes.top >= bar.top && modes.bottom <= bar.bottom,
        display: getComputedStyle(document.querySelector(".toolbar")).display,
      };
    });
    expect(result.display).toBe("flex");
    expect(result.fits).toBe(true);
    expect(result.delta).toBeLessThanOrEqual(8);
  };
  await centered();
  await page.locator("#sidebar-toggle").click();
  await centered();
  await page.locator("#outline-toggle").click();
  await centered();
  await page.setViewportSize({ width: 1000, height: 900 });
  await centered();
});

test("wide reading expands the measure, preserves the current paragraph and persists", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await boot(page, longText);
  await expect(page.locator("#width-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const before = await page.locator("#content").boundingBox();
  expect(before.width).toBeCloseTo(760, 0);
  const measure = await page.locator("#content").evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      left: parseFloat(style.paddingLeft),
      right: parseFloat(style.paddingRight),
      width:
        el.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
    };
  });
  expect(measure).toEqual({ left: 32, right: 48, width: 680 });
  await page.locator("#reader").evaluate((el) => {
    el.scrollTop +=
      el.querySelector("#section-30").getBoundingClientRect().top -
      el.getBoundingClientRect().top -
      32;
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
  await page.locator("#width-toggle").click();
  await expect(page.locator("#width-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(async () => (await page.locator("#content").boundingBox()).width)
    .toBeGreaterThan(before.width + 100);
  await expect.poll(delta).toBeLessThan(100);
  await expect
    .poll(() => page.evaluate(() => window.mock.session?.settings.wide))
    .toBe(true);
  await page.reload();
  await expect(page.locator("#width-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect((await page.locator("#content").boundingBox()).width).toBeGreaterThan(
    before.width + 100,
  );
  await page.locator("#width-toggle").click();
  await expect(page.locator("#width-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect((await page.locator("#content").boundingBox()).width).toBeCloseTo(
    760,
    0,
  );
});

test("Aa keeps zoom settings while the adjacent theme button is directly accessible", async ({
  page,
}) => {
  await boot(page);
  await expect(page.locator("#weight")).toHaveAttribute(
    "aria-label",
    "外观与布局",
  );
  await expect(
    page.locator(".toolbar #zoom-in, .toolbar #zoom-out"),
  ).toHaveCount(0);
  await openAppearance(page);
  await expect(page.locator("#appearance #zoom-reset")).toHaveText("100%");
  for (let i = 0; i < 5; i++)
    await page.locator("#appearance #zoom-out").click();
  await expect(page.locator("#zoom-reset")).toHaveText("50%");
  await page.locator("#zoom-reset").click();
  await expect(page.locator("#zoom-reset")).toHaveText("100%");
  await page.locator("#color-theme").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#color-theme")).toHaveValue("dark");
  await closeAppearance(page);
  await expect(page.locator("#appearance")).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.mock.session?.settings.theme))
    .toBe("dark");
});

test("default typography uses actual Literata and JetBrains with the original inline math scale", async ({
  page,
}, testInfo) => {
  await boot(page);
  const css = await page.evaluate(() => {
    const style = (query) => {
      const value = getComputedStyle(document.querySelector(query));
      return {
        family: value.fontFamily,
        size: parseFloat(value.fontSize),
        weight: value.fontWeight,
        lineHeight: parseFloat(value.lineHeight),
        spacing: value.letterSpacing,
      };
    };
    return {
      paragraph: style("#content p"),
      strong: style("#content strong"),
      math: style("#content .formula > .katex"),
      code: style("#content pre code"),
      boldMath: style("#content .katex .mathbf"),
    };
  });
  expect(css.paragraph.family).toContain("Literata");
  expect(css.paragraph.size).toBe(16);
  expect(css.paragraph.weight).toBe("400");
  expect(css.paragraph.lineHeight / css.paragraph.size).toBeCloseTo(1.7, 2);
  expect(css.strong.weight).toBe("600");
  expect(css.math.size / css.paragraph.size).toBeCloseTo(1, 3);
  expect(css.math.family).toContain("KaTeX_Main");
  expect(css.boldMath.weight).toBe("700");
  expect(css.code.family).toContain("JetBrains Mono");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument"),
    evidence = {};
  for (const [name, selector] of Object.entries({
    prose: "#content p [data-text-from]",
    code: "#content pre code",
  })) {
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    evidence[name] = (
      await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
    ).fonts;
  }
  await cdp.detach();
  await testInfo.attach("original-style-platform-fonts", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
  console.log("Original-style actual fonts:", JSON.stringify(evidence));
  expect(
    evidence.prose.some(
      (font) => /Literata/.test(font.familyName) && font.isCustomFont,
    ),
  ).toBe(true);
  expect(
    evidence.code.some(
      (font) => /JetBrains Mono/.test(font.familyName) && font.isCustomFont,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".local/visual-v013/literata-baseline.png" });
});
