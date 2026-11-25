import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";
import { picture } from "./image-layout-helpers.js";

const imgA = picture(160, 72, [180, 210, 200]);
const imgB = picture(160, 72, [205, 195, 175]);
const dotImg = picture(18, 18, [70, 140, 120]);

const narrowSortableTable =
  "| ID | Explanation | Notes |\n| --- | --- | --- |\n" +
  Array.from(
    { length: 6 },
    (_, i) =>
      `| ${i + 1} | A repeated explanation sentence that wraps across lines when narrow. | ${i === 0 ? "One long cell with extra details to test wrapping width balance cleanly. ".repeat(2) : "OK"} |`,
  ).join("\n");

const sweepNote = [
  "---",
  "title: Sweep Parity Fixture",
  "tags: [parity, 测试]",
  "date: 2026-11-24",
  "---",
  "",
  "# 1 Parity Sweep 测试总览",
  "",
  "Short EN paragraph before Chinese.",
  "",
  '这是一段中文段落，包含 **粗体**、*斜体*、`行内代码`、==高亮==、<span style="color:#b42318">红字</span>、$a_i^2 + b_i^2$ 公式、[链接](https://example.com)、<kbd>Ctrl+S</kbd> 以及脚注[^fn1]与[^zh1]。',
  "",
  "这是一段较长的纯中文测试段落，用来验证长段落自动换行时的行高、字距与块间距，确保在默认宽度与窄窗口下切换阅读与编辑模式时每一行文字都不会产生位移或换行变化。",
  "",
  "This is a longer mixed English and 中文 paragraph designed to wrap across several lines at both 1360px and 700px viewports so we verify line height, wrapping, inline code `fooBar()`, inline image ![dot](" +
    dotImg +
    "), and paragraph spacing.",
  "",
  "## 2 Headings Sequence 标题序列",
  "",
  "### 2.1 Heading H3 后接段落",
  "",
  "Paragraph between H3 and H4.",
  "",
  "#### 2.1.1 Heading H4 后接列表",
  "",
  "- Tight bullet 1",
  "- Tight bullet 2",
  "",
  "##### 2.1.1.1 Heading H5 后接引用",
  "",
  "> Quote after H5.",
  "",
  "###### 2.1.1.1.1 Heading H6 后接代码块",
  "",
  "```js",
  "const parityCheck = true;",
  "```",
  "",
  "## 3 Lists 列表与深层嵌套",
  "",
  "- Bullet depth 1",
  "  - Bullet depth 2",
  "    - Bullet depth 3",
  "      - Bullet depth 4",
  "        - Bullet depth 5",
  "          - Bullet depth 6 leaf with 中文文本",
  "",
  "1. Ordered loose item 1",
  "",
  "   Second paragraph in item 1.",
  "",
  "   > Quote inside list item",
  "",
  "   ```py",
  "   print('in-list')",
  "   ```",
  "",
  "2. Ordered loose item 2",
  "",
  "   $$",
  "   \\sum_{k=1}^n k = \\frac{n(n+1)}{2}",
  "   $$",
  "",
  "3. Ordered loose item 3 with table",
  "",
  "   | K | V |",
  "   | --- | --- |",
  "   | a | b |",
  "",
  "- [ ] Task tight one",
  "- [x] Task tight two",
  "- [ ] Task tight three",
  "",
  "- [ ] Task loose one",
  "",
  "  Body under task.",
  "",
  "- [x] Task loose two",
  "",
  "## 4 Quotes & Callouts 引用",
  "",
  "> Outer quote line.",
  ">",
  "> > Nested level 2 quote with 中文。",
  ">",
  "> Final quote paragraph.",
  "",
  "> [!NOTE]",
  "> Callout syntax check in Read vs Edit.",
  "",
  "## 5 Code & Math 代码与公式",
  "",
  "    indented code line 1",
  "    indented code line 2",
  "",
  "```javascript",
  "function hello(name) {",
  "  return `Hello, ${name}`;",
  "}",
  "```",
  "",
  "$$",
  "\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}",
  "$$",
  "",
  "## 6 Tables 表格全集",
  "",
  "| Col A | Col B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "| 3 | 4 |",
  "",
  narrowSortableTable,
  "",
  "| C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  "| alpha-cell | beta-cell | gamma-cell | delta-cell | epsilon-cell | zeta-cell | eta-cell | theta-cell |",
  "",
  "| 项 | 说明 | 公式 |",
  "| --- | --- | --- |",
  "| 1 | 中文说明与长文本在窄容器下自动换行比较。 | $\\sum_{i=1}^n (x_i-y_i)^2$ |",
  "| 2 | 第二行内容对比 | $E=mc^2$ |",
  "",
  "## 7 Images & Columns 图片",
  "",
  `![Solo image](${imgA})`,
  "",
  `<img src="${imgB}" width="110" alt="Sized">`,
  "",
  `<img src="${imgA}" width="30%" alt="Pct30">`,
  "",
  `<p align="left"><img src="${imgB}" width="20%" alt="Left"></p>`,
  "",
  `<p align="right"><img src="${imgA}" width="20%" alt="Right"></p>`,
  "",
  `<img src="${imgA}" width="49%" alt="RowA"> <img src="${imgB}" width="49%" alt="RowB">`,
  "",
  `![Side A](${imgA}) ![Side B](${imgB})`,
  "",
  '<div class="columns">',
  '<div class="column" data-width="58%">',
  "",
  "Column text with $x^2$ and **bold**.",
  "",
  "</div>",
  '<div class="column" data-width="42%">',
  "",
  `![ColImg](${imgB})`,
  "",
  "</div>",
  "</div>",
  "",
  "## 8 Rules, Details, HTML & Diagrams",
  "",
  "---",
  "",
  "<details>",
  "<summary>Closed details 中间折叠</summary>",
  "",
  "Hidden paragraph inside closed details.",
  "",
  "</details>",
  "",
  "<details open>",
  "<summary>Open details 展开卡片</summary>",
  "",
  "Visible paragraph inside open details.",
  "",
  "- list inside open details",
  "",
  "</details>",
  "",
  "<div>HTML div block 内容</div>",
  "",
  "```mermaid",
  "graph LR",
  "  A[Start] --> B[End]",
  "```",
  "",
  "# 9 Second H1 & Heading Transitions",
  "",
  "Paragraph after second H1.",
  "",
  "#### H4 after paragraph",
  "",
  "$$",
  "a^2 + b^2 = c^2",
  "$$",
  "",
  "##### H5 after math",
  "",
  "| T1 | T2 |",
  "| --- | --- |",
  "| x | y |",
  "",
  "### H3 after table",
  "",
  "Paragraph before extra blank lines.",
  "",
  "",
  "",
  "Paragraph after extra blank lines.",
  "",
  "[^fn1]: English footnote body.",
  "[^zh1]: 中文脚注说明内容。",
  "",
].join("\n");

const leadingCases = {
  leadH1: "# Leading H1 Title\n\nAfter.",
  leadH2: "## Leading H2 Heading\n\nAfter.",
  leadH3: "### Leading H3 Heading\n\nAfter.",
  leadPara: "Leading plain paragraph.\n\nAfter.",
  leadList: "- First item\n- Second item\n\nAfter.",
  leadOrderedList: "1. First item\n2. Second item\n\nAfter.",
  leadTaskList: "- [ ] Open task\n- [x] Done task\n\nAfter.",
  leadQuote: "> Leading quote\n\nAfter.",
  leadNestedQuote: "> Outer quote\n>\n> > Inner quote\n\nAfter.",
  leadCode: "```js\nconst a = 1;\n```\n\nAfter.",
  leadIndentedCode: "    indented = 1\n\nAfter.",
  leadMath: "$$\nx^2 + y^2 = z^2\n$$\n\nAfter.",
  leadTable: narrowSortableTable + "\n\nAfter.",
  leadHr: "---\n\nAfter.",
  leadImage: `![Solo](${imgA})\n\nAfter.`,
  leadImageAligned: `<p align="left"><img src="${imgB}" width="20%" alt="LeadLeft"></p>\n\nAfter.`,
  leadImageRow: `<img src="${imgA}" width="49%" alt="LeadRowA"> <img src="${imgB}" width="49%" alt="LeadRowB">\n\nAfter.`,
  leadColumns:
    '<div class="columns">\n<div class="column" data-width="50%">\n\nLeft col\n\n</div>\n<div class="column" data-width="50%">\n\nRight col\n\n</div>\n</div>\n\nAfter.',
  leadDetailsClosed:
    "<details>\n<summary>Leading closed</summary>\n\nInner\n\n</details>\n\nAfter.",
  leadDetailsOpen:
    "<details open>\n<summary>Leading open</summary>\n\nInner\n\n</details>\n\nAfter.",
  leadHtmlDiv: "<div>Leading HTML div</div>\n\nAfter.",
  leadMermaid: "```mermaid\ngraph LR\n  A --> B\n```\n\nAfter.",
  leadFmPara: "---\ntags: [a]\n---\n\nParagraph after FM.\n\nAfter.",
  leadFmH1: "---\ntags: [a]\n---\n\n# Heading 1 After FM\n\nAfter.",
  leadFmH2: "---\ntags: [a]\n---\n\n## Heading 2 After FM\n\nAfter.",
  leadFmDetailsClosed:
    "---\ntags: [a]\n---\n\n<details>\n<summary>After FM closed</summary>\n\nInner\n\n</details>\n\nAfter.",
  leadFmDetailsOpen:
    "---\ntags: [a]\n---\n\n<details open>\n<summary>After FM open</summary>\n\nInner\n\n</details>\n\nAfter.",
};

const MATRIX = [
  { name: "light-default", theme: "light", width: 1360 },
  { name: "dark-default", theme: "dark", width: 1360 },
  { name: "light-narrow", theme: "light", width: 700 },
  { name: "dark-narrow", theme: "dark", width: 700 },
];

async function openNote(page, text, theme, width, readingStyle = "standard") {
  await page.setViewportSize({ width, height: 900 });
  await installFolio(page);
  await page.addInitScript(
    ({ text, theme, readingStyle }) => {
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [
            {
              id: "sweep",
              path: "C:/notes/Sweep.md",
              name: "Sweep.md",
              text,
              version: "v1",
            },
          ],
          roots: [],
          restored: [],
          settings: {
            sidebar: false,
            outline: false,
            richEdit: true,
            theme,
            readingStyle,
          },
        }),
      });
    },
    { text, theme, readingStyle },
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#content")).toBeVisible();
}

async function settlePane(page, paneSel, scrollerSel) {
  await page.evaluate(() => document.fonts.ready);
  const max = await page.evaluate(
    (sel) => document.querySelector(sel).scrollHeight,
    scrollerSel,
  );
  for (let y = 0; y <= max; y += 450) {
    await page.evaluate(
      ({ sel, y }) => {
        document.querySelector(sel).scrollTop = y;
      },
      { sel: scrollerSel, y },
    );
    await page.waitForTimeout(110);
  }
  await page.evaluate((sel) => {
    document.querySelector(sel).scrollTop = 0;
  }, scrollerSel);
  await expect
    .poll(() =>
      page.evaluate((pane) => {
        const math = document.querySelectorAll(
          pane + " [data-folio-math], " + pane + " .math-pending",
        ).length;
        const diagrams = [
          ...document.querySelectorAll(pane + " code.language-mermaid"),
        ].filter(
          (c) =>
            !c.closest("pre")?.classList.contains("diagram-host") &&
            !c.closest("pre")?.querySelector(".diagram-error"),
        ).length;
        const measures = document.querySelectorAll(
          pane + " .table-measure",
        ).length;
        return math + diagrams + measures;
      }, paneSel),
    )
    .toBe(0);
  let stable = await page.evaluate(
    (sel) => document.querySelector(sel).scrollHeight,
    scrollerSel,
  );
  for (let tries = 0; tries < 8; tries++) {
    await page.waitForTimeout(120);
    const next = await page.evaluate(
      (sel) => document.querySelector(sel).scrollHeight,
      scrollerSel,
    );
    if (next === stable) break;
    stable = next;
  }
}

async function snapshotBlocks(page, mode) {
  return page.evaluate((mode) => {
    const read = mode === "read";
    const scroller = document.querySelector(read ? "#reader" : "#rich-reader");
    const host = document.querySelector(
      read ? "#content" : "#rich .ProseMirror",
    );
    const sRect = scroller.getBoundingClientRect();
    const skipText =
      ".fold,.section-summary,.code-toolbar,.table-sort,.katex-mathml,annotation,.fm-actions,.raw-inline[data-kind='anchor']";
    const firstTextRect = (el) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (n.parentElement?.closest(skipText))
            return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const n = w.nextNode();
      if (!n) return null;
      const idx = n.nodeValue.search(/\S/);
      const r = document.createRange();
      r.setStart(n, Math.max(0, idx));
      r.setEnd(n, Math.min(n.length, Math.max(0, idx) + 1));
      const box = r.getBoundingClientRect();
      return box.height || box.width ? { left: box.left - sRect.left } : null;
    };
    const metric = (el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === "string" ? el.className : "",
        text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 36),
        top: r.top - sRect.top,
        height: r.height,
        left: r.left - sRect.left,
        width: r.width,
        textLeft: firstTextRect(el)?.left ?? null,
      };
    };
    const blocks = [];
    if (read) {
      const walk = (container) => {
        for (const ch of container.children) {
          if (
            ch.classList.contains("footnotes-sep") ||
            ch.classList.contains("footnotes")
          )
            continue;
          if (ch.classList.contains("note-section")) {
            const h = ch.querySelector(
              ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6",
            );
            if (h) blocks.push(metric(h));
            const body = ch.querySelector(":scope > .section-body");
            if (body) walk(body);
          } else {
            blocks.push(metric(ch));
          }
        }
      };
      walk(host);
    } else {
      for (const ch of host.children) {
        if (
          ch.classList.contains("ProseMirror-gapcursor") ||
          ch.tagName === "BR"
        )
          continue;
        if (
          ch.dataset?.kind === "text" &&
          /^\[\^[^\]]+\]:/.test(ch.textContent)
        )
          continue;
        blocks.push(metric(ch));
      }
    }
    const listItems = [...host.querySelectorAll("li")]
      .filter((li) => !li.closest("section.footnotes"))
      .map(metric);
    const cols = [...host.querySelectorAll(".columns > .column")].map(metric);
    const inner = [
      ...host.querySelectorAll(
        "li blockquote, li pre, li .table-scroll > table:not(.table-measure), li .math-block",
      ),
    ].map(metric);
    return { blocks, listItems, cols, inner };
  }, mode);
}

function assertBoxMatch(label, rb, eb, r0 = 0, e0 = 0, checkRelTop = true) {
  if (checkRelTop) {
    expect(
      Math.abs(eb.top - e0 - (rb.top - r0)),
      `${label} top (${rb.tag} "${rb.text}")`,
    ).toBeLessThan(0.5);
  }
  expect(
    Math.abs(eb.height - rb.height),
    `${label} height (${rb.tag} "${rb.text}")`,
  ).toBeLessThan(0.5);
  expect(
    Math.abs(eb.width - rb.width),
    `${label} width (${rb.tag} "${rb.text}")`,
  ).toBeLessThan(0.5);
  expect(
    Math.abs(eb.left - rb.left),
    `${label} left (${rb.tag} "${rb.text}")`,
  ).toBeLessThan(0.5);
  if (rb.textLeft != null && eb.textLeft != null) {
    expect(
      Math.abs(eb.textLeft - rb.textLeft),
      `${label} textLeft (${rb.tag} "${rb.text}")`,
    ).toBeLessThan(0.5);
  }
}

for (const cfg of MATRIX) {
  test(`complete block sweep matches Read and Edit within 0.5 px (${cfg.name})`, async ({
    page,
  }) => {
    await openNote(page, sweepNote, cfg.theme, cfg.width);
    await settlePane(page, "#content", "#reader");
    const read = await snapshotBlocks(page, "read");

    await page.keyboard.press("Control+2");
    await expect(page.locator("#rich-reader")).toBeVisible();
    await settlePane(page, "#rich", "#rich-reader");
    const edit = await snapshotBlocks(page, "edit");

    expect(edit.blocks.length, `${cfg.name} block count`).toBe(
      read.blocks.length,
    );
    const r0 = read.blocks[0].top;
    const e0 = edit.blocks[0].top;
    for (let i = 0; i < read.blocks.length; i++) {
      assertBoxMatch(
        `${cfg.name} block[${i}]`,
        read.blocks[i],
        edit.blocks[i],
        r0,
        e0,
      );
    }

    expect(edit.listItems.length, `${cfg.name} li count`).toBe(
      read.listItems.length,
    );
    for (let i = 0; i < read.listItems.length; i++) {
      assertBoxMatch(
        `${cfg.name} li[${i}]`,
        read.listItems[i],
        edit.listItems[i],
        r0,
        e0,
      );
    }

    expect(edit.cols.length, `${cfg.name} column count`).toBe(read.cols.length);
    for (let i = 0; i < read.cols.length; i++) {
      assertBoxMatch(
        `${cfg.name} col[${i}]`,
        read.cols[i],
        edit.cols[i],
        r0,
        e0,
      );
    }

    expect(edit.inner.length, `${cfg.name} nested list-block count`).toBe(
      read.inner.length,
    );
    for (let i = 0; i < read.inner.length; i++) {
      assertBoxMatch(
        `${cfg.name} inner[${i}]`,
        read.inner[i],
        edit.inner[i],
        r0,
        e0,
      );
    }

    // Footnote section at the end stays rendered in Read and verbatim in Edit.
    await expect(page.locator("#content section.footnotes")).toBeAttached();
    await expect(
      page.locator('#rich .raw-block[data-kind="text"]').last(),
    ).toContainText("[^fn1]:");
  });
}

for (const readingStyle of ["relaxed", "compact"]) {
  test(`complete block sweep matches Read and Edit within 0.5 px (${readingStyle})`, async ({
    page,
  }) => {
    await openNote(page, sweepNote, "light", 1360, readingStyle);
    await settlePane(page, "#content", "#reader");
    const read = await snapshotBlocks(page, "read");

    await page.keyboard.press("Control+2");
    await expect(page.locator("#rich-reader")).toBeVisible();
    await settlePane(page, "#rich", "#rich-reader");
    const edit = await snapshotBlocks(page, "edit");

    expect(edit.blocks.length, `${readingStyle} block count`).toBe(
      read.blocks.length,
    );
    const r0 = read.blocks[0].top;
    const e0 = edit.blocks[0].top;
    for (let i = 0; i < read.blocks.length; i++) {
      assertBoxMatch(
        `${readingStyle} block[${i}]`,
        read.blocks[i],
        edit.blocks[i],
        r0,
        e0,
      );
    }

    expect(edit.listItems.length, `${readingStyle} li count`).toBe(
      read.listItems.length,
    );
    for (let i = 0; i < read.listItems.length; i++) {
      assertBoxMatch(
        `${readingStyle} li[${i}]`,
        read.listItems[i],
        edit.listItems[i],
        r0,
        e0,
      );
    }

    expect(edit.cols.length, `${readingStyle} column count`).toBe(
      read.cols.length,
    );
    for (let i = 0; i < read.cols.length; i++) {
      assertBoxMatch(
        `${readingStyle} col[${i}]`,
        read.cols[i],
        edit.cols[i],
        r0,
        e0,
      );
    }

    expect(edit.inner.length, `${readingStyle} nested list-block count`).toBe(
      read.inner.length,
    );
    for (let i = 0; i < read.inner.length; i++) {
      assertBoxMatch(
        `${readingStyle} inner[${i}]`,
        read.inner[i],
        edit.inner[i],
        r0,
        e0,
      );
    }
  });
}

for (const cfg of MATRIX) {
  test(`first-block parity across all block kinds (${cfg.name})`, async ({
    page,
  }) => {
    test.slow();
    for (const [name, md] of Object.entries(leadingCases)) {
      await openNote(page, md, cfg.theme, cfg.width);
      await settlePane(page, "#content", "#reader");
      const read = await snapshotBlocks(page, "read");

      await page.keyboard.press("Control+2");
      await expect(page.locator("#rich-reader")).toBeVisible();
      await settlePane(page, "#rich", "#rich-reader");
      const edit = await snapshotBlocks(page, "edit");

      expect(edit.blocks.length, `${cfg.name} ${name} count`).toBe(
        read.blocks.length,
      );
      for (let i = 0; i < read.blocks.length; i++) {
        assertBoxMatch(
          `${cfg.name} ${name}[${i}]`,
          read.blocks[i],
          edit.blocks[i],
          0,
          0,
          false,
        );
        expect(
          Math.abs(edit.blocks[i].top - read.blocks[i].top),
          `${cfg.name} ${name}[${i}] absTop`,
        ).toBeLessThan(0.5);
      }
    }
  });
}

test("narrow sortable tables never wrap headers and sort cleanly; details keep open/closed state and toggle", async ({
  page,
}) => {
  const note = [
    "<details>",
    "<summary>Closed details</summary>",
    "",
    "Hidden paragraph.",
    "",
    "</details>",
    "",
    "<details open>",
    "<summary>Open details</summary>",
    "",
    "Visible paragraph.",
    "",
    "</details>",
    "",
    narrowSortableTable,
    "",
    "End paragraph.",
  ].join("\n");
  await openNote(page, note, "light", 700);
  await settlePane(page, "#content", "#reader");

  const readState = await page.evaluate(() => ({
    closedOpen: document.querySelectorAll("#content details")[0].open,
    openOpen: document.querySelectorAll("#content details")[1].open,
    thHeights: [...document.querySelectorAll("#content th")].map(
      (th) => th.getBoundingClientRect().height,
    ),
    sortBox: document
      .querySelector("#content th .table-sort")
      .getBoundingClientRect(),
    thBox: document.querySelector("#content th").getBoundingClientRect(),
  }));
  expect(readState.closedOpen).toBe(false);
  expect(readState.openOpen).toBe(true);
  for (const h of readState.thHeights) expect(h).toBeLessThan(50);
  expect(readState.sortBox.top).toBeGreaterThanOrEqual(readState.thBox.top);
  expect(readState.sortBox.bottom).toBeLessThanOrEqual(readState.thBox.bottom);

  // Clicking sort button sorts ascending then descending.
  await page.locator("#content th .table-sort").first().click();
  await expect(page.locator("#content th").first()).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await page.locator("#content th .table-sort").first().click();
  await expect(page.locator("#content th").first()).toHaveAttribute(
    "aria-sort",
    "descending",
  );

  await page.keyboard.press("Control+2");
  await expect(page.locator("#rich-reader")).toBeVisible();
  await settlePane(page, "#rich", "#rich-reader");

  const editState = await page.evaluate(() => ({
    closedFolded: document
      .querySelectorAll("#rich .rich-details")[0]
      .classList.contains("rich-folded"),
    openFolded: document
      .querySelectorAll("#rich .rich-details")[1]
      .classList.contains("rich-folded"),
    thHeights: [...document.querySelectorAll("#rich th")].map(
      (th) => th.getBoundingClientRect().height,
    ),
  }));
  expect(editState.closedFolded).toBe(true);
  expect(editState.openFolded).toBe(false);
  for (let i = 0; i < readState.thHeights.length; i++) {
    expect(
      Math.abs(editState.thHeights[i] - readState.thHeights[i]),
    ).toBeLessThan(0.5);
  }

  // Toggling closed details card in Edit unfolds it via marker click.
  const firstSummary = page
    .locator("#rich .rich-details .rich-summary")
    .first();
  const sBox = await firstSummary.boundingBox();
  await page.mouse.click(sBox.x - 10, sBox.y + sBox.height / 2);
  await expect(page.locator("#rich .rich-details").first()).not.toHaveClass(
    /rich-folded/,
  );
});

const ANCHOR_SWEEP_NOTE = [
  '<a id="before-title"></a>',
  "",
  "# 锚点排版基准标题",
  "",
  '<a id="before-h2"></a>',
  "",
  "## 第一节 A",
  '<a id="right-after-h2"></a>',
  "",
  '包含<a id="inline-a"></a>行内锚点的正文段。',
  "",
  '<a id="before-h3"></a>',
  "",
  "### 子节 1",
  "",
  '<a id="sec-first"></a>',
  "",
  "子节内容第一段。",
  "",
  '<a id="consec-1"></a>',
  "",
  '<a id="consec-2"></a>',
  "",
  "#### 四级标题",
  "",
  "##### 五级标题",
  "",
  "###### 六级标题",
  "",
  '<a id="sec-last"></a>',
  "",
  "## 第二节 B",
  "",
  "- 列表项一",
  "- 列表项二",
  "",
  '  <a id="list-anchor"></a>',
  "",
  "  列表项二续段",
  "",
  "> 引用第一行",
  ">",
  '> <a id="bq-anchor"></a>',
  ">",
  "> 引用第二段",
  "",
  '<a id="before-table"></a>',
  "",
  "| Col A | Col B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  '<a id="before-code"></a>',
  "",
  "```js",
  "const anchored = true;",
  "```",
  "",
].join("\n");

test("standalone anchors have zero height/gap and match Read and Edit within 0.5 px across column widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await installFolio(page);
  await page.addInitScript(
    ({ text }) => {
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [
            {
              id: "anchor-sweep",
              path: "C:/notes/Anchors.md",
              name: "Anchors.md",
              text,
              version: "v1",
            },
          ],
          roots: [],
          restored: [],
          settings: {
            sidebar: false,
            outline: true,
            richEdit: true,
          },
        }),
      });
    },
    { text: ANCHOR_SWEEP_NOTE },
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#content h1.note-title")).toHaveText(
    "锚点排版基准标题",
  );
  await expect(
    page
      .locator("#outline button")
      .evaluateAll((els) => els.map((b) => b.dataset.depth)),
  ).resolves.toEqual(["0", "1", "2", "3", "4", "0"]);

  const measureAnchorsZero = async (sel) =>
    page
      .locator(sel)
      .evaluateAll((els) =>
        els.map(
          (el) => Math.round(el.getBoundingClientRect().height * 10) / 10,
        ),
      );
  const readAnchors = await measureAnchorsZero("#content p.anchor-only");
  expect(readAnchors.length).toBe(12);
  expect(readAnchors.every((h) => h === 0)).toBe(true);

  for (const readingStyle of ["standard", "relaxed", "compact"]) {
    for (const columnWidth of ["window", "measure", "fixed"]) {
      await page.locator("#weight").click();
      await page.locator("#reading-style").selectOption(readingStyle);
      await page.locator("#column-width").selectOption(columnWidth);
      await page.locator("#appearance-close").click();
      await page.keyboard.press("Control+1");
      await settlePane(page, "#content", "#reader");
      const read = await snapshotBlocks(page, "read");
      read.blocks = read.blocks.filter((b) => !b.cls.includes("anchor-only"));

      await page.keyboard.press("Control+2");
      await expect(page.locator("#rich-reader")).toBeVisible();
      await settlePane(page, "#rich", "#rich-reader");
      const edit = await snapshotBlocks(page, "edit");
      edit.blocks = edit.blocks.filter((b) => !b.cls.includes("anchor-only"));

      expect(
        edit.blocks.length,
        `${readingStyle}/${columnWidth} visible count`,
      ).toBe(read.blocks.length);
      const r0 = read.blocks[0].top;
      const e0 = edit.blocks[0].top;
      for (let i = 0; i < read.blocks.length; i++) {
        assertBoxMatch(
          `anchors-${readingStyle}-${columnWidth} block[${i}]`,
          read.blocks[i],
          edit.blocks[i],
          r0,
          e0,
        );
      }
      const editAnchors = await measureAnchorsZero(
        "#rich .ProseMirror p.anchor-only",
      );
      expect(editAnchors.length).toBe(12);
      expect(editAnchors.every((h) => h === 0)).toBe(true);
    }
  }

  // Clicking the margin `#` marker in Edit reveals `<a id="..."></a>` source.
  const firstMarker = page
    .locator('#rich .ProseMirror p.anchor-only .raw-inline[data-kind="anchor"]')
    .first();
  await expect(firstMarker).toBeVisible();
  await firstMarker.click();
  await expect(page.locator("#rich .ProseMirror .math-src")).toContainText(
    '<a id="before-title"></a>',
  );
});
