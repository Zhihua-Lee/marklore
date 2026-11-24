import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";
import {
  setup,
  item,
  row,
  saved,
  onenoteIndex,
  onenotePages,
} from "./index-view-setup.js";

// The index view's structure at a glance (src/folder-index-view.css) on a
// OneNote-style notebook of four levels: top-level entries as section
// heads, the second level as the body, deeper levels smaller and quieter,
// equal steps in, one line per entry, counts on folded entries; and
// dragging an entry near the reader's edge scrolls it.
const open = (page, settings = {}) =>
  setup(page, settings, onenoteIndex, { folder: onenotePages });
const looks = (page, title) =>
  item(page, title).evaluate((el) => {
    const row = el.querySelector(":scope > .ix-row");
    const title = row.querySelector(".ix-title");
    const style = getComputedStyle(title);
    return {
      size: parseFloat(style.fontSize),
      weight: Number(style.fontWeight),
      color: style.color,
      left: title.getBoundingClientRect().left,
      arrow: row.firstElementChild.getBoundingClientRect().left,
      top: el.getBoundingClientRect().top,
      height: row.getBoundingClientRect().height,
    };
  });

for (const theme of ["light", "dark"])
  test(`levels read by size, weight, ink and equal steps (${theme})`, async ({
    page,
  }) => {
    await open(page, { theme });
    for (const mode of ["read", "edit"]) {
      if (mode === "edit") {
        await page.keyboard.press("Control+2");
        await expect(page.locator("#content .ix-tools").first()).toBeAttached();
      }
      const part = await looks(page, "第一部分 数学基础");
      const chapter = await looks(page, "1 希尔伯特空间");
      const section = await looks(page, "1.2 完备性");
      const example = await looks(page, "例：L² 空间");
      // Each level smaller (or lighter) than the one above.
      expect(part.size).toBeGreaterThan(chapter.size);
      expect(part.weight).toBeGreaterThan(chapter.weight);
      expect(chapter.weight).toBeGreaterThan(section.weight);
      expect(section.size).toBeGreaterThan(example.size);
      expect(example.color).not.toBe(chapter.color);
      // Every level steps in by the same amount: its arrow under its
      // parent's title.
      expect(Math.abs(chapter.arrow - part.left)).toBeLessThan(1.5);
      expect(Math.abs(section.arrow - chapter.left)).toBeLessThan(1.5);
      expect(Math.abs(example.arrow - section.left)).toBeLessThan(1.5);
      // Rows of a level keep one height; a new part has space above it.
      const next = await looks(page, "1.3 正交基");
      const neighbour = await looks(page, "1.1 内积与范数");
      expect(Math.abs(next.height - neighbour.height)).toBeLessThan(1);
      const last = await looks(page, "3 狄拉克符号");
      const second = await looks(page, "第二部分 波动力学");
      expect(second.top - (last.top + last.height)).toBeGreaterThan(6);
      expect(second.top - (last.top + last.height)).toBeLessThan(11);
      // The first sentence: muted, smaller, on one line.
      const excerpt = await row(page, "1.1 内积与范数")
        .locator(".ix-excerpt")
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            size: parseFloat(style.fontSize),
            color: style.color,
            wrap: style.whiteSpace,
          };
        });
      expect(excerpt.size).toBeLessThan(neighbour.size);
      expect(excerpt.color).not.toBe(chapter.color);
      expect(excerpt.wrap).toBe("nowrap");
    }
    // A flat list (no levels) keeps body-size titles.
    const flat = await looks(page, "常用公式");
    const chapter = await looks(page, "1 希尔伯特空间");
    expect(flat.size).toBe(chapter.size);
  });

test("a folded entry says how many pages it holds", async ({ page }) => {
  await open(page);
  const part = item(page, "第二部分 波动力学");
  const count = part.locator(":scope > .ix-row > .ix-count");
  await expect(count).toBeHidden();
  await part.locator(":scope > .ix-row > .ix-twisty").click();
  await expect(count).toBeVisible();
  await expect(count).toHaveText("11 页");
  // Unfolded: gone again.
  await part.locator(":scope > .ix-row > .ix-twisty").click();
  await expect(count).toBeHidden();
  // One page under it (its own wording, "1 page" in English).
  const chapter = item(page, "2.2 厄米算符与本征值");
  await chapter.locator(":scope > .ix-row > .ix-twisty").click();
  await expect(chapter.locator(":scope > .ix-row > .ix-count")).toHaveText(
    "1 页",
  );
});

test("dragging an entry near the reader's edge scrolls it to entries off screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page);
  // Every first sentence in (the view is drawn again as they come).
  await expect(row(page, "习题索引").locator(".ix-excerpt")).toBeAttached();
  await expect(row(page, "11 变分法").locator(".ix-excerpt")).toBeAttached();
  await page.keyboard.press("Control+2");
  await expect(page.locator("#content .ix-tools").first()).toBeAttached();
  const reader = page.locator("#reader");
  const scrolled = () => reader.evaluate((el) => el.scrollTop);
  await reader.evaluate((el) => (el.scrollTop = 0));
  const box = await reader.boundingBox();
  const x = box.x + box.width / 2;
  const bottom = Math.round(box.y + box.height - 8),
    top = Math.round(box.y + 6),
    middle = Math.round(box.y + box.height / 2);
  let tremble = 0;
  const dragTo = async (y) => {
    await page.mouse.move(x + (tremble++ % 2), y);
    await page.waitForTimeout(40);
  };
  const start = async (title) => {
    const at = await row(page, title).boundingBox();
    await page.mouse.move(at.x + 60, at.y + at.height / 2);
    await page.mouse.down();
    await page.mouse.move(at.x + 70, at.y + at.height / 2 + 6);
  };
  await start("1.1 内积与范数");
  // Held at the bottom edge: the reader scrolls down.
  for (let i = 0; i < 20 && (await scrolled()) < 200; i++) await dragTo(bottom);
  expect(await scrolled()).toBeGreaterThan(200);
  // In the middle it stops (the test's moves reach the page late), short
  // of the end.
  const settle = async (y) => {
    let still = -1;
    await expect
      .poll(async () => {
        const before = await scrolled();
        await dragTo(y);
        await page.waitForTimeout(200);
        still = await scrolled();
        return still - before;
      })
      .toBe(0);
    return still;
  };
  const end = await reader.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(await settle(middle)).toBeLessThan(end - 100);
  // Down again until the list's last chapter shows, dropped after it.
  const goal = row(page, "11 变分法");
  const shown = async () => {
    const at = await goal.boundingBox();
    return (
      at && at.y > box.y + 60 && at.y + at.height < box.y + box.height - 60
    );
  };
  for (let i = 0; i < 40 && !(await shown()); i++) await dragTo(bottom);
  await settle(middle);
  expect(await shown()).toBe(true);
  const at = await goal.boundingBox();
  const drop = Math.round(at.y + at.height * 0.9);
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(at.x + 60 + (i % 2), drop);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  const text = await saved(page);
  expect(text.indexOf("[1.1 内积与范数]")).toBeGreaterThan(
    text.indexOf("[11 变分法]"),
  );
  // Held at the top edge: back up.
  const before = await scrolled();
  await start("10 微扰论");
  for (let i = 0; i < 20 && (await scrolled()) > before - 150; i++)
    await dragTo(top);
  expect(await scrolled()).toBeLessThan(before - 150);
  // Let go outside the list: nothing changes.
  await page.mouse.move(x, 4);
  await page.mouse.up();
});

async function mountFolderTree(
  page,
  {
    rootIndexed = true,
    withExcerpts = true,
    theme = "light",
    width = 1280,
    openFolderA = false,
  } = {},
) {
  await page.setViewportSize({ width, height: 860 });
  await installFolio(page);
  await page.addInitScript(
    ({ rootIndexed, withExcerpts, theme, openFolderA }) => {
      localStorage.setItem("folio-language", "zh");
      const files = new Map();
      const mkPages = (prefix, count, folderId, folderPath) => {
        const list = [];
        for (let i = 1; i <= count; i++) {
          const name = `${prefix}-${String(i).padStart(2, "0")}.md`;
          const p = `${folderPath}/${name}`;
          const title = `${prefix} 第 ${i} 节`;
          const text = withExcerpts
            ? `# ${title}\n\n${title} 的第一句摘要。\n`
            : `# ${title}\n`;
          files.set(p, {
            id: `f-${folderId}-${i}`,
            folderId,
            name,
            path: p,
            title,
            text,
            version: "v1",
          });
          list.push({ name, path: p, title });
        }
        return list;
      };
      const pagesA = mkPages("分析", 35, "dirA", "C:/Lib/FolderA");
      const pagesB = mkPages("代数", 35, "dirB", "C:/Lib/FolderB");
      const subPages = [
        {
          name: "Note1.md",
          path: "C:/Lib/Mixed/Note1.md",
          title: "实数完备性概述",
          text: withExcerpts
            ? "# 实数完备性概述\n\n摘要句子。\n"
            : "# 实数完备性概述\n",
        },
        {
          name: "Note2.md",
          path: "C:/Lib/Mixed/Note2.md",
          title: "极限定理与柯西准则",
          text: withExcerpts
            ? "# 极限定理与柯西准则\n\n摘要句子。\n"
            : "# 极限定理与柯西准则\n",
        },
        {
          name: "Note3.md",
          path: "C:/Lib/Mixed/Note3.md",
          title: "例题：上确界计算",
          text: withExcerpts
            ? "# 例题：上确界计算\n\n摘要句子。\n"
            : "# 例题：上确界计算\n",
        },
      ];
      for (const sp of subPages)
        files.set(sp.path, {
          id: "f-mixed-" + sp.name,
          folderId: "mixed",
          ...sp,
          version: "v1",
        });
      files.set("C:/Lib/Mixed/_目录.md", {
        id: "f-mixed-ix",
        folderId: "mixed",
        name: "_目录.md",
        path: "C:/Lib/Mixed/_目录.md",
        text: [
          "# 混合章节",
          "",
          "- [实数完备性概述](Note1.md)",
          "  - [极限定理与柯西准则](Note2.md)",
          "    - [例题：上确界计算](Note3.md)",
          "",
        ].join("\n"),
        version: "v1",
      });
      files.set("C:/Lib/FolderA/_目录.md", {
        id: "f-a-ix",
        folderId: "dirA",
        name: "_目录.md",
        path: "C:/Lib/FolderA/_目录.md",
        text: [
          "# 数学分析笔记",
          "",
          ...pagesA.map((p) => `- [${p.title}](${p.name})`),
          "",
        ].join("\n"),
        version: "v1",
      });
      files.set("C:/Lib/FolderB/_目录.md", {
        id: "f-b-ix",
        folderId: "dirB",
        name: "_目录.md",
        path: "C:/Lib/FolderB/_目录.md",
        text: [
          "# 高等代数笔记",
          "",
          ...pagesB.map((p) => `- [${p.title}](${p.name})`),
          "",
        ].join("\n"),
        version: "v1",
      });
      for (const [fn, ttl] of [
        ["RootNote.md", "普通一级笔记"],
        ["ChildNote.md", "二级子笔记"],
        ["GrandChild.md", "三级嵌套笔记"],
      ]) {
        files.set(`C:/Lib/${fn}`, {
          id: "f-root-" + fn,
          folderId: "r1",
          name: fn,
          path: `C:/Lib/${fn}`,
          title: ttl,
          text: withExcerpts ? `# ${ttl}\n\n${ttl}的摘要。\n` : `# ${ttl}\n`,
          version: "v1",
        });
      }
      if (rootIndexed) {
        files.set("C:/Lib/_目录.md", {
          id: "f-root-ix",
          folderId: "r1",
          name: "_目录.md",
          path: "C:/Lib/_目录.md",
          text: [
            "# 知识库总目录",
            "",
            "- [数学分析笔记](FolderA/_目录.md)",
            "- [高等代数笔记](FolderB/_目录.md)",
            "- [混合章节](Mixed/_目录.md)",
            "- [普通一级笔记](RootNote.md) 尾随附加说明",
            "  - [二级子笔记](ChildNote.md)",
            "    - [三级嵌套笔记](GrandChild.md)",
            "- [缺失文件夹](MissingDir/)",
            "  - [缺失子页](MissingChild.md)",
            "- [缺失页面](NoSuchNote.md)",
            "",
          ].join("\n"),
          version: "v1",
        });
      }
      const dirs = new Map([
        [
          "r1",
          {
            id: "r1",
            name: "知识库",
            path: "C:/Lib",
            parentId: null,
            childDirs: ["dirA", "dirB", "mixed"],
            childFiles: [
              ...(rootIndexed ? ["C:/Lib/_目录.md"] : []),
              "C:/Lib/RootNote.md",
              "C:/Lib/ChildNote.md",
              "C:/Lib/GrandChild.md",
            ],
          },
        ],
        [
          "dirA",
          {
            id: "dirA",
            name: "FolderA",
            path: "C:/Lib/FolderA",
            parentId: "r1",
            childDirs: [],
            childFiles: [
              "C:/Lib/FolderA/_目录.md",
              ...pagesA.map((p) => p.path),
            ],
          },
        ],
        [
          "dirB",
          {
            id: "dirB",
            name: "FolderB",
            path: "C:/Lib/FolderB",
            parentId: "r1",
            childDirs: [],
            childFiles: [
              "C:/Lib/FolderB/_目录.md",
              ...pagesB.map((p) => p.path),
            ],
          },
        ],
        [
          "mixed",
          {
            id: "mixed",
            name: "Mixed",
            path: "C:/Lib/Mixed",
            parentId: "r1",
            childDirs: [],
            childFiles: [
              "C:/Lib/Mixed/_目录.md",
              ...subPages.map((p) => p.path),
            ],
          },
        ],
      ]);
      const listForDir = (id) => {
        const dir = dirs.get(id);
        if (!dir) return [];
        const ixPath = dir.childFiles.find((p) => p.endsWith("/_目录.md"));
        const ixFile = ixPath ? files.get(ixPath) : null;
        const out = [];
        if (ixFile)
          out.push({
            name: "_目录.md",
            path: ixPath,
            parent: id,
            directory: false,
            index: true,
          });
        for (const cid of dir.childDirs) {
          const d = dirs.get(cid);
          const subIx = d.childFiles.find((p) => p.endsWith("/_目录.md"));
          const subTitle = subIx
            ? /^#\s+(.+)$/m.exec(files.get(subIx).text)?.[1]
            : null;
          out.push({
            id: d.id,
            name: d.name,
            path: d.path,
            parent: id,
            directory: true,
            title: subTitle || d.name,
          });
        }
        for (const fp of dir.childFiles) {
          if (fp.endsWith("/_目录.md")) continue;
          const f = files.get(fp);
          out.push({
            name: f.name,
            path: f.path,
            parent: id,
            directory: false,
            title: f.title,
          });
        }
        return out;
      };
      const byId = new Map([...files.values()].map((f) => [f.id, f]));
      const resolveFromFolder = (folderId, href) => {
        const clean = decodeURIComponent(href.split("#")[0]);
        const dir = dirs.get(folderId);
        return (
          (dir && files.get(dir.path + "/" + clean)) ||
          files.get("C:/Lib/" + clean) ||
          null
        );
      };
      const incoming = openFolderA
        ? [files.get("C:/Lib/FolderA/_目录.md")]
        : rootIndexed
          ? [files.get("C:/Lib/_目录.md")]
          : [
              {
                id: "f-sample",
                folderId: "dirA",
                name: "FolderA/分析-01.md",
                path: "C:/Lib/FolderA/分析-01.md",
                text: "# 示例\n",
                version: "v1",
              },
            ];
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming,
          restored: [],
          roots: [
            {
              id: "r1",
              name: "知识库",
              path: "C:/Lib",
              ...(rootIndexed ? { index: "C:/Lib/_目录.md" } : {}),
            },
          ],
          settings: {
            language: "zh",
            theme,
            sidebar: !rootIndexed && !openFolderA,
            outline: true,
            richEdit: true,
            editSplit: false,
          },
        }),
        list: async (id) => listForDir(id),
        folderIndex: async (id) => {
          const d = dirs.get(id);
          const ix = d?.childFiles.find((p) => p.endsWith("/_目录.md"));
          return ix ? { path: ix, name: "_目录.md" } : null;
        },
        folderIndexText: async (id) => {
          const d = dirs.get(id);
          if (!d) return null;
          const ix = d.childFiles.find((p) => p.endsWith("/_目录.md"));
          const f = ix ? files.get(ix) : null;
          const title = f ? /^#\s+(.+)$/m.exec(f.text)?.[1] : null;
          return {
            folder: {
              id: d.id,
              name: d.name,
              ...(title ? { title } : {}),
              path: d.path,
            },
            index: f ? { name: f.name, path: f.path } : null,
            text: f ? f.text : null,
            items: listForDir(id),
          };
        },
        currentFolder: async (fileId) => {
          const f = byId.get(fileId);
          const d = f ? dirs.get(f.folderId) : null;
          return d
            ? { id: d.id, name: d.name, path: d.path }
            : { id: "r1", name: "知识库", path: "C:/Lib" };
        },
        openChild: async (folderId, name) =>
          files.get(dirs.get(folderId).path + "/" + name) || null,
        preview: async (fileId, href) => {
          const f = byId.get(fileId);
          const hit = resolveFromFolder(f?.folderId || "r1", href);
          if (!hit) throw Error("missing");
          return {
            id: hit.id,
            name: hit.name,
            path: hit.path,
            text: hit.text,
            version: "v1",
          };
        },
        previewChild: async (folderId, href) => {
          const hit = resolveFromFolder(folderId, href);
          if (!hit) throw Error("missing");
          return {
            id: hit.id,
            name: hit.name,
            path: hit.path,
            text: hit.text,
            version: "v1",
          };
        },
        linkStatus: async (_id, hrefs) =>
          hrefs.map((h) =>
            h.includes("Missing") || h.includes("NoSuchNote")
              ? "missing-file"
              : "ok",
          ),
        read: async () => ({ unchanged: true }),
      });
    },
    { rootIndexed, withExcerpts, theme, openFolderA },
  );
  await page.goto("/");
  if (!rootIndexed && !openFolderA) {
    const rootSummary = page.locator("#tree details.folder.root > summary");
    await rootSummary.hover();
    await rootSummary.locator("> .folder-index-open").click();
  }
  await expect(page.locator("#content .ix-item").first()).toBeVisible();
}

async function measureAlignment(page) {
  return page.evaluate(() => {
    const firstTextRect = (el) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = w.nextNode())) {
        if (!node.nodeValue || !node.nodeValue.trim()) continue;
        const r = document.createRange();
        r.selectNodeContents(node);
        const rects = [...r.getClientRects()].filter(
          (x) => x.width > 0 && x.height > 0,
        );
        if (rects.length) return rects[0];
      }
      return null;
    };
    const items = [...document.querySelectorAll("#content .ix-item")].filter(
      (it) =>
        it.offsetParent !== null &&
        !it.parentElement.closest(".ix-item.closed"),
    );
    const rows = items.map((it) => {
      const row = it.querySelector(":scope > .ix-row");
      const tw = row.querySelector(
        ":scope > .ix-twisty, :scope > .ix-twisty-space",
      );
      const title = row.querySelector(":scope > .ix-title");
      const twR = tw.getBoundingClientRect();
      const rowR = row.getBoundingClientRect();
      const titleR = title.getBoundingClientRect();
      const textR = firstTextRect(title);
      const rail =
        it.getAttribute("aria-expanded") === "true"
          ? it.querySelector(":scope > .ix-children > .ix-rail")
          : null;
      const railOffsetX =
        rail && rail.getBoundingClientRect().width > 0
          ? rail.getBoundingClientRect().left +
            rail.getBoundingClientRect().width / 2 -
            (twR.left + twR.width / 2)
          : null;
      const ts = getComputedStyle(title);
      return {
        label: title.textContent.trim(),
        level: Number(it.getAttribute("aria-level")),
        hasTwisty: tw.classList.contains("ix-twisty"),
        expanded: it.getAttribute("aria-expanded"),
        missing: it.classList.contains("missing"),
        deltaY: twR.top + twR.height / 2 - (textR.top + textR.height / 2),
        fontSize: parseFloat(ts.fontSize),
        fontWeight: Number(ts.fontWeight),
        rowTop: rowR.top,
        rowBottom: rowR.bottom,
        rowHeight: rowR.height,
        titleHeight: titleR.height,
        railOffsetX,
      };
    });
    const level1 = rows.filter((r) => r.level === 1);
    const level1Gap =
      level1.length >= 2 ? level1[1].rowTop - level1[0].rowBottom : null;
    return { rows, level1Gap };
  });
}

for (const opts of [
  {
    name: "generated root, excerpts on, light, default width",
    rootIndexed: false,
    withExcerpts: true,
    theme: "light",
    width: 1280,
  },
  {
    name: "generated root, excerpts off, dark, default width",
    rootIndexed: false,
    withExcerpts: false,
    theme: "dark",
    width: 1280,
  },
  {
    name: "written index, excerpts on, light, default width",
    rootIndexed: true,
    withExcerpts: true,
    theme: "light",
    width: 1280,
  },
  {
    name: "written index, excerpts off, dark, narrow width",
    rootIndexed: true,
    withExcerpts: false,
    theme: "dark",
    width: 520,
  },
]) {
  test(`fold triangle aligns within 1 px of title first-line center (${opts.name})`, async ({
    page,
  }) => {
    await mountFolderTree(page, opts);
    // Fold to level 1 so top-level folders display page counts (e.g. "35 页").
    await page.locator("#outline-collapse").click({ modifiers: ["Shift"] });
    await expect(row(page, "数学分析笔记").locator(".ix-count")).toBeVisible();
    await expect(row(page, "数学分析笔记").locator(".ix-count")).toHaveText(
      "35 页",
    );

    for (const mode of ["read", "edit"]) {
      if (mode === "edit") {
        await page.keyboard.press("Control+2");
        if (opts.rootIndexed) {
          await expect(
            page.locator("#content .ix-tools").first(),
          ).toBeAttached();
        }
      }
      // Verify folded level-1 state: steady half-line (~0.5em) gap between all level-1 entries (±0.5 px), equal pitch (±0.5 px), and equal row heights.
      const folded = await measureAlignment(page);
      expect(folded.level1Gap).toBeGreaterThan(5);
      expect(folded.level1Gap).toBeLessThan(11);
      const l1Folded = folded.rows.filter(
        (r) =>
          r.level === 1 && (!r.missing || opts.width >= 800 || mode === "read"),
      );
      const unwrappedPitches = [];
      const unwrappedGaps = [];
      for (let i = 1; i < folded.rows.length; i++) {
        const prev = folded.rows[i - 1];
        const curr = folded.rows[i];
        if (
          prev.level === 1 &&
          curr.level === 1 &&
          (!prev.missing || opts.width >= 800 || mode === "read")
        ) {
          unwrappedPitches.push(curr.rowTop - prev.rowTop);
          unwrappedGaps.push(curr.rowTop - prev.rowBottom);
        }
      }
      expect(
        Math.max(...unwrappedGaps) - Math.min(...unwrappedGaps),
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.max(...unwrappedPitches) - Math.min(...unwrappedPitches),
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.max(...l1Folded.map((r) => r.rowHeight)) -
          Math.min(...l1Folded.map((r) => r.rowHeight)),
      ).toBeLessThanOrEqual(0.5);
      for (const r of folded.rows) {
        expect(
          Math.abs(r.deltaY),
          `${mode} folded ${r.label}`,
        ).toBeLessThanOrEqual(1);
        const maxExtra = r.level === 1 && !r.hasTwisty ? 7 : 6;
        if (!r.missing || opts.width >= 800 || mode === "read") {
          expect(r.rowHeight - r.titleHeight).toBeLessThanOrEqual(maxExtra);
        }
      }

      // Open Mixed through level 4 while keeping FolderA folded so every row kind is visible.
      const ensureExpanded = async (title) => {
        const target = item(page, title);
        if ((await target.getAttribute("aria-expanded")) !== "true") {
          await target.locator(":scope > .ix-row > .ix-twisty").click();
        }
      };
      await ensureExpanded("混合章节");
      await expect(row(page, "实数完备性概述")).toBeVisible();
      await ensureExpanded("实数完备性概述");
      await expect(row(page, "极限定理与柯西准则")).toBeVisible();
      await ensureExpanded("极限定理与柯西准则");
      await expect(row(page, "例题：上确界计算")).toBeVisible();
      if (opts.rootIndexed) {
        await ensureExpanded("普通一级笔记");
        await expect(row(page, "二级子笔记")).toBeVisible();
        await ensureExpanded("二级子笔记");
        await expect(row(page, "三级嵌套笔记")).toBeVisible();
      }
      const itemA = item(page, "数学分析笔记");
      if ((await itemA.getAttribute("aria-expanded")) === "true") {
        await itemA.locator(":scope > .ix-row > .ix-twisty").click();
      }
      // Hover a folder row to keep action controls visible while checking alignment.
      await row(page, "混合章节").hover();

      const expanded = await measureAlignment(page);
      expect(expanded.rows.some((r) => r.level >= 3)).toBe(true);
      expect(
        expanded.rows.some((r) => r.hasTwisty && r.expanded === "false"),
      ).toBe(true);
      expect(
        expanded.rows.some((r) => r.hasTwisty && r.expanded === "true"),
      ).toBe(true);
      // Equal row heights per level within 0.5 px across row kinds (arrow/no-arrow, count, missing, excerpt, tools).
      for (const lv of [1, 2, 3]) {
        const atLv = expanded.rows.filter(
          (r) =>
            r.level === lv &&
            (!r.missing || opts.width >= 800 || mode === "read"),
        );
        if (atLv.length >= 2) {
          const hs = atLv.map((r) => r.rowHeight);
          expect(
            Math.max(...hs) - Math.min(...hs),
            `${mode} level ${lv} heights`,
          ).toBeLessThanOrEqual(0.5);
        }
      }
      // Steady gap above every level-1 row matches folded gap; children stay tight.
      const mixedRow = expanded.rows.find((r) => r.label === "混合章节");
      const algRow = expanded.rows.find((r) => r.label === "高等代数笔记");
      const note1Row = expanded.rows.find((r) => r.label === "实数完备性概述");
      const note2Row = expanded.rows.find(
        (r) => r.label === "极限定理与柯西准则",
      );
      const note3Row = expanded.rows.find(
        (r) => r.label === "例题：上确界计算",
      );
      const afterMixed = expanded.rows.find(
        (r) => r.level === 1 && r.rowTop > note3Row.rowBottom,
      );
      expect(
        Math.abs(mixedRow.rowTop - algRow.rowBottom - folded.level1Gap),
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(afterMixed.rowTop - note3Row.rowBottom - folded.level1Gap),
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(note1Row.rowTop - mixedRow.rowBottom),
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(note2Row.rowTop - note1Row.rowBottom),
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(note3Row.rowTop - note2Row.rowBottom),
      ).toBeLessThanOrEqual(0.5);

      // Folding/unfolding Mixed shifts rows below by exact children height without moving rows above.
      const beforeChildrenH = await item(page, "混合章节")
        .locator(":scope > .ix-children")
        .evaluate((el) => el.getBoundingClientRect().height);
      await item(page, "混合章节")
        .locator(":scope > .ix-row > .ix-twisty")
        .click();
      await expect(row(page, "实数完备性概述")).toBeHidden();
      const afterFold = await measureAlignment(page);
      for (const lbl of ["数学分析笔记", "高等代数笔记", "混合章节"]) {
        const b = expanded.rows.find((r) => r.label === lbl);
        const a = afterFold.rows.find((r) => r.label === lbl);
        expect(
          Math.abs(a.rowTop - b.rowTop),
          `${mode} ${lbl} stationary`,
        ).toBeLessThanOrEqual(0.5);
      }
      const afterFoldNext = afterFold.rows.find(
        (r) => r.label === afterMixed.label,
      );
      expect(
        Math.abs(afterMixed.rowTop - afterFoldNext.rowTop - beforeChildrenH),
        `${mode} fold shift`,
      ).toBeLessThanOrEqual(0.5);
      await item(page, "混合章节")
        .locator(":scope > .ix-row > .ix-twisty")
        .click();
      await expect(row(page, "例题：上确界计算")).toBeVisible();
      const afterReopen = await measureAlignment(page);
      const reopenChildrenH = await item(page, "混合章节")
        .locator(":scope > .ix-children")
        .evaluate((el) => el.getBoundingClientRect().height);
      const afterReopenNext = afterReopen.rows.find(
        (r) => r.label === afterMixed.label,
      );
      expect(
        Math.abs(
          afterReopenNext.rowTop - afterFoldNext.rowTop - reopenChildrenH,
        ),
        `${mode} unfold shift`,
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(
          afterReopen.rows.find((r) => r.label === "混合章节").rowTop -
            mixedRow.rowTop,
        ),
        `${mode} unfold head stationary`,
      ).toBeLessThanOrEqual(0.5);

      for (const r of expanded.rows) {
        expect(
          Math.abs(r.deltaY),
          `${mode} expanded ${r.label} (level ${r.level})`,
        ).toBeLessThanOrEqual(1);
        if (r.railOffsetX !== null) {
          expect(Math.abs(r.railOffsetX)).toBeLessThanOrEqual(1);
        }
        // Normal single-line rows stay snug around their title; only wrapped missing repairs may grow.
        const maxExtra = r.level === 1 && !r.hasTwisty ? 7 : 6;
        if (!r.missing || opts.width >= 800 || mode === "read") {
          expect(
            r.rowHeight - r.titleHeight,
            `${mode} ${r.label}`,
          ).toBeLessThanOrEqual(maxExtra);
        }
      }
      // Collapse all levels back to level 1 before switching mode.
      await page.locator("#outline-collapse").click({ modifiers: ["Shift"] });
    }
  });
}

test("same typography for a page in a flat index and in a nested one, and equal folded level-1 pitch with loose notes", async ({
  page,
}) => {
  // 1. Nested written root: FolderA pages at level 2 (15.2px/500), heads at level 1 (16.72px/600), non-heads at level 1 (15.2px/500).
  await mountFolderTree(page, {
    rootIndexed: true,
    withExcerpts: true,
    theme: "light",
  });
  const nestedMetrics = await measureAlignment(page);
  const nestedHead = nestedMetrics.rows.find((r) => r.label === "数学分析笔记");
  const nestedPage = nestedMetrics.rows.find((r) => r.label === "分析 第 1 节");
  const nestedLoose = nestedMetrics.rows.find((r) => r.label === "缺失页面");
  expect(nestedHead.fontSize).toBeCloseTo(16.72, 1);
  expect(nestedHead.fontWeight).toBe(600);
  expect(nestedPage.fontSize).toBeCloseTo(15.2, 1);
  expect(nestedPage.fontWeight).toBe(500);
  expect(nestedLoose.fontSize).toBeCloseTo(15.2, 1);
  expect(nestedLoose.fontWeight).toBe(500);

  // 2. Generated root with folders (heads) + loose root notes (non-heads): when folded, all level-1 rows have equal pitch (±0.5 px).
  await mountFolderTree(page, {
    rootIndexed: false,
    withExcerpts: true,
    theme: "light",
  });
  await page.locator("#outline-collapse").click({ modifiers: ["Shift"] });
  await expect(row(page, "数学分析笔记").locator(".ix-count")).toHaveText(
    "35 页",
  );
  const genFolded = await measureAlignment(page);
  const genL1 = genFolded.rows.filter((r) => r.level === 1);
  const genHead = genL1.find((r) => r.label === "数学分析笔记");
  const genLoose = genL1.find((r) => r.label === "普通一级笔记");
  expect(genHead.fontSize).toBeCloseTo(16.72, 1);
  expect(genHead.fontWeight).toBe(600);
  expect(genLoose.fontSize).toBeCloseTo(15.2, 1);
  expect(genLoose.fontWeight).toBe(500);
  const genPitches = genL1.slice(1).map((r, i) => r.rowTop - genL1[i].rowTop);
  expect(Math.max(...genPitches) - Math.min(...genPitches)).toBeLessThanOrEqual(
    0.5,
  );

  // 3. FolderA's own flat index: its pages have the exact same size & weight as under the root.
  await mountFolderTree(page, {
    rootIndexed: true,
    withExcerpts: true,
    theme: "light",
    openFolderA: true,
  });
  const flatMetrics = await measureAlignment(page);
  const flatPage = flatMetrics.rows.find((r) => r.label === "分析 第 1 节");
  expect(flatPage.fontSize).toBe(nestedPage.fontSize);
  expect(flatPage.fontWeight).toBe(nestedPage.fontWeight);
});

for (const theme of ["light", "dark"]) {
  test(`capture steady level-1 gap screenshots (${theme})`, async ({
    page,
  }) => {
    await mountFolderTree(page, {
      rootIndexed: true,
      withExcerpts: true,
      theme,
      width: 1280,
    });
    await page.locator("#outline-collapse").click({ modifiers: ["Shift"] });
    await expect(row(page, "数学分析笔记").locator(".ix-count")).toBeVisible();
    await page.mouse.move(10, 10);
    await page.screenshot({
      path: `.local/fold-two-shots/after-steady-folded-${theme}.png`,
    });
    await item(page, "混合章节")
      .locator(":scope > .ix-row > .ix-twisty")
      .click();
    await expect(row(page, "实数完备性概述")).toBeVisible();
    await page.mouse.move(10, 10);
    await page.screenshot({
      path: `.local/fold-two-shots/after-steady-open-${theme}.png`,
    });
  });
}
