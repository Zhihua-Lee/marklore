import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Connected navigation specs: downward lazy expansion in index views,
// read-only nested scope + open-folder action, upward breadcrumbs & sibling
// switchers on index views and notes (Read/Edit parity, outside-library
// hiding, setting toggle), generated read-only root contents, and outline
// updates for expanded trees.

async function setupConnected(
  page,
  {
    rootIndexed = true,
    initialFile = rootIndexed ? "C:/Lib/_目录.md" : "C:/Lib/Preface.md",
    settings = {},
    includeOutside = false,
  } = {},
) {
  await installFolio(page);
  await page.addInitScript(
    ({ rootIndexed, initialFile, settings, includeOutside }) => {
      const rootIndex = [
        "# 微积分知识库",
        "",
        "全库总目录说明。",
        "",
        "- [第一部分 基础](Part1/_目录.md)",
        "- [前言](Preface.md)",
        "",
      ].join("\n");

      const part1Index = [
        "# 第一部分 基础",
        "",
        "- [导言](Intro.md)",
        "- [第一节 实数系](Section1.md)",
        "  - [详细推导](Detail.md)",
        "- [进阶专题](Sub/_目录.md)",
        "- [随笔目录](Plain/)",
        "",
      ].join("\n");

      const subIndex = [
        "# 进阶专题",
        "",
        "- [深层推导](DeepNote.md)",
        "- [底层归档](Inner/_目录.md)",
        "",
      ].join("\n");

      const innerIndex = ["# 底层归档", "", "- [最深一页](Bottom.md)", ""].join(
        "\n",
      );

      const files = new Map([
        ...(rootIndexed
          ? [
              [
                "C:/Lib/_目录.md",
                {
                  id: "f-root-ix",
                  folderId: "r1",
                  name: "_目录.md",
                  path: "C:/Lib/_目录.md",
                  text: rootIndex,
                  version: "v1",
                },
              ],
            ]
          : []),
        [
          "C:/Lib/Preface.md",
          {
            id: "f-preface",
            folderId: "r1",
            name: "Preface.md",
            path: "C:/Lib/Preface.md",
            title: "写在前面",
            text: "---\ntags: [导论]\n---\n\n# 写在前面\n\n全书的阅读顺序与体例说明。\n",
            version: "v1",
          },
        ],
        [
          "C:/Lib/Part1/_目录.md",
          {
            id: "f-p1-ix",
            folderId: "part1",
            name: "_目录.md",
            path: "C:/Lib/Part1/_目录.md",
            text: part1Index,
            version: "v1",
          },
        ],
        [
          "C:/Lib/Part1/Intro.md",
          {
            id: "f-intro",
            folderId: "part1",
            name: "Intro.md",
            path: "C:/Lib/Part1/Intro.md",
            title: "导言",
            text: "# 导言\n\n从数轴与公理系统讲起。\n",
            version: "v1",
          },
        ],
        [
          "C:/Lib/Part1/Section1.md",
          {
            id: "f-sec1",
            folderId: "part1",
            name: "Section1.md",
            path: "C:/Lib/Part1/Section1.md",
            title: "第一节 实数系",
            text: "# 第一节 实数系\n\n介绍 Dedekind 分割与确界公理。\n",
            version: "v1",
          },
        ],
        [
          "C:/Lib/Part1/Detail.md",
          {
            id: "f-detail",
            folderId: "part1",
            name: "Detail.md",
            path: "C:/Lib/Part1/Detail.md",
            title: "详细推导",
            text: "---\nnotebook: 微积分\nsection: 第一部分\n---\n\n# 详细推导\n\n这里给出上确界存在性的完整证明。\n",
            version: "v1",
          },
        ],
        [
          "C:/Lib/Part1/Sub/_目录.md",
          {
            id: "f-sub-ix",
            folderId: "sub",
            name: "_目录.md",
            path: "C:/Lib/Part1/Sub/_目录.md",
            text: subIndex,
            version: "v1",
          },
        ],
        [
          "C:/Lib/Part1/Sub/DeepNote.md",
          {
            id: "f-deep",
            folderId: "sub",
            name: "DeepNote.md",
            path: "C:/Lib/Part1/Sub/DeepNote.md",
            title: "深层推导",
            text: "# 深层推导\n\n深层笔记的第一句话。\n",
            version: "v1",
          },
        ],
        [
          "C:/Lib/Part1/Sub/Inner/_目录.md",
          {
            id: "f-inner-ix",
            folderId: "inner",
            name: "_目录.md",
            path: "C:/Lib/Part1/Sub/Inner/_目录.md",
            text: innerIndex,
            version: "v1",
          },
        ],
        [
          "C:/Lib/Part1/Sub/Inner/Bottom.md",
          {
            id: "f-bottom",
            folderId: "inner",
            name: "Bottom.md",
            path: "C:/Lib/Part1/Sub/Inner/Bottom.md",
            title: "最深一页",
            text: "# 最深一页\n\n抵达目录最深处的说明。\n",
            version: "v1",
          },
        ],
        [
          "C:/Lib/Part1/Plain/Alpha.md",
          {
            id: "f-alpha",
            folderId: "plain",
            name: "Alpha.md",
            path: "C:/Lib/Part1/Plain/Alpha.md",
            title: "Alpha 标题",
            text: "# Alpha 标题\n\n无目录子文件夹里的第一篇。\n",
            version: "v1",
          },
        ],
        [
          "C:/Lib/Part1/Plain/Beta.md",
          {
            id: "f-beta",
            folderId: "plain",
            name: "Beta.md",
            path: "C:/Lib/Part1/Plain/Beta.md",
            title: "Beta 标题",
            text: "# Beta 标题\n\n无目录子文件夹里的第二篇。\n",
            version: "v1",
          },
        ],
        ...(includeOutside
          ? [
              [
                "C:/Outside/Free.md",
                {
                  id: "f-outside",
                  folderId: "outside-dir",
                  name: "Free.md",
                  path: "C:/Outside/Free.md",
                  title: "库外笔记",
                  text: "# 库外笔记\n\n不在任何笔记库中。\n",
                  version: "v1",
                },
              ],
            ]
          : []),
      ]);

      const dirs = new Map([
        [
          "r1",
          {
            id: "r1",
            name: "微积分",
            path: "C:/Lib",
            parentId: null,
            childDirs: ["part1"],
            childFiles: rootIndexed
              ? ["C:/Lib/_目录.md", "C:/Lib/Preface.md"]
              : ["C:/Lib/Preface.md"],
            order: rootIndexed
              ? ["part1", "Preface.md"]
              : ["part1", "Preface.md"],
          },
        ],
        [
          "part1",
          {
            id: "part1",
            name: "Part1",
            path: "C:/Lib/Part1",
            parentId: "r1",
            childDirs: ["sub", "plain"],
            childFiles: [
              "C:/Lib/Part1/_目录.md",
              "C:/Lib/Part1/Intro.md",
              "C:/Lib/Part1/Section1.md",
              "C:/Lib/Part1/Detail.md",
            ],
            order: ["Intro.md", "Section1.md", "sub", "plain"],
          },
        ],
        [
          "sub",
          {
            id: "sub",
            name: "Sub",
            path: "C:/Lib/Part1/Sub",
            parentId: "part1",
            childDirs: ["inner"],
            childFiles: [
              "C:/Lib/Part1/Sub/_目录.md",
              "C:/Lib/Part1/Sub/DeepNote.md",
            ],
            order: ["DeepNote.md", "inner"],
          },
        ],
        [
          "inner",
          {
            id: "inner",
            name: "Inner",
            path: "C:/Lib/Part1/Sub/Inner",
            parentId: "sub",
            childDirs: [],
            childFiles: [
              "C:/Lib/Part1/Sub/Inner/_目录.md",
              "C:/Lib/Part1/Sub/Inner/Bottom.md",
            ],
            order: ["Bottom.md"],
          },
        ],
        [
          "plain",
          {
            id: "plain",
            name: "Plain",
            path: "C:/Lib/Part1/Plain",
            parentId: "part1",
            childDirs: ["plain-sub"],
            childFiles: [
              "C:/Lib/Part1/Plain/Beta.md",
              "C:/Lib/Part1/Plain/Alpha.md",
            ],
            order: null,
          },
        ],
        [
          "plain-sub",
          {
            id: "plain-sub",
            name: "NestedPlainDir",
            path: "C:/Lib/Part1/Plain/NestedPlainDir",
            parentId: "plain",
            childDirs: [],
            childFiles: [],
            order: null,
          },
        ],
      ]);

      const byFileId = new Map([...files.values()].map((f) => [f.id, f]));

      function listForDir(dirId) {
        const dir = dirs.get(dirId);
        if (!dir) return [];
        const ixPath = dir.childFiles.find((p) => p.endsWith("/_目录.md"));
        const ixFile = ixPath ? files.get(ixPath) : null;
        const out = [];
        if (ixFile) {
          out.push({
            name: ixFile.name,
            path: ixFile.path,
            parent: dir.id,
            directory: false,
            index: true,
          });
        }
        const dirChildren = dir.childDirs.map((cid) => {
          const d = dirs.get(cid);
          return {
            id: d.id,
            name: d.name,
            path: d.path,
            parent: dir.id,
            directory: true,
          };
        });
        const noteChildren = dir.childFiles
          .filter((p) => !p.endsWith("/_目录.md"))
          .map((p) => {
            const f = files.get(p);
            return {
              name: f.name,
              path: f.path,
              parent: dir.id,
              directory: false,
              title: f.title,
            };
          });
        const all = [...dirChildren, ...noteChildren].sort(
          (a, b) =>
            Number(b.directory) - Number(a.directory) ||
            a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
        );
        if (!ixFile || !dir.order) return out.concat(all);
        const byKey = new Map();
        for (const c of all) {
          if (c.directory) byKey.set(c.id, c);
          else byKey.set(c.name, c);
        }
        const seen = new Set();
        for (const k of dir.order) {
          const hit = byKey.get(k);
          if (hit) {
            seen.add(hit);
            out.push({
              ...hit,
              listed: true,
              depth: 0,
            });
          }
          if (k === "Section1.md") {
            const detail = byKey.get("Detail.md");
            if (detail) {
              seen.add(detail);
              out.push({ ...detail, listed: true, depth: 1 });
            }
          }
        }
        for (const c of all) if (!seen.has(c)) out.push(c);
        return out;
      }

      function siblingItem(child, dir, currentKey) {
        if (child.directory) {
          return {
            kind: "folder",
            name: child.name,
            path: child.path,
            folderId: child.id,
            indexName: null,
            fileName: null,
            current: child.id === currentKey || child.path === currentKey,
          };
        }
        return {
          kind: "note",
          name: child.title || child.name.replace(/\.md$/, ""),
          path: child.path,
          folderId: dir.id,
          indexName: null,
          fileName: child.name,
          current: child.path === currentKey,
        };
      }

      function siblingsForDirChild(parentDir, childKey, onlyTopLevel = true) {
        const items = listForDir(parentDir.id).filter(
          (i) => !i.index && (!onlyTopLevel || i.depth !== 1),
        );
        return items.map((item) => siblingItem(item, parentDir, childKey));
      }

      function computeBreadcrumb(query) {
        let dirId = query.folderId || null;
        let file = query.fileId ? byFileId.get(query.fileId) : null;
        if (file) dirId = file.folderId;
        if (!dirId || !dirs.has(dirId)) return null;

        const chain = [];
        let cur = dirs.get(dirId);
        while (cur) {
          chain.unshift(cur);
          cur = cur.parentId ? dirs.get(cur.parentId) : null;
        }
        if (chain[0].id !== "r1") return null;

        const isNote = Boolean(file && file.name !== "_目录.md");
        const segments = [];
        segments.push({
          kind: "root",
          name: chain[0].name,
          path: chain[0].path,
          folderId: chain[0].id,
          clickable: isNote || chain.length > 1,
          current: !isNote && chain.length === 1,
          siblings: [],
        });

        for (let i = 1; i < chain.length; i++) {
          const folder = chain[i];
          const parent = chain[i - 1];
          const isCur = !isNote && i === chain.length - 1;
          segments.push({
            kind: "folder",
            name: folder.name,
            path: folder.path,
            folderId: folder.id,
            clickable: !isCur,
            current: isCur,
            siblings: siblingsForDirChild(parent, folder.id, true),
          });
        }

        if (!isNote)
          return { root: chain[0], kind: file ? "index" : "folder", segments };

        const leafDir = chain.at(-1);
        if (file.path === "C:/Lib/Part1/Detail.md") {
          const sec1 = files.get("C:/Lib/Part1/Section1.md");
          const detail = files.get("C:/Lib/Part1/Detail.md");
          segments.push({
            kind: "note",
            name: sec1.title,
            path: sec1.path,
            folderId: leafDir.id,
            fileName: sec1.name,
            clickable: true,
            current: false,
            siblings: siblingsForDirChild(leafDir, sec1.path, true),
          });
          segments.push({
            kind: "note",
            name: query.title || detail.title,
            path: detail.path,
            folderId: leafDir.id,
            fileName: detail.name,
            clickable: false,
            current: true,
            siblings: [
              siblingItem(
                { ...detail, directory: false },
                leafDir,
                detail.path,
              ),
            ],
          });
        } else {
          segments.push({
            kind: "note",
            name: query.title || file.title || file.name.replace(/\.md$/, ""),
            path: file.path,
            folderId: leafDir.id,
            fileName: file.name,
            clickable: false,
            current: true,
            siblings: siblingsForDirChild(leafDir, file.path, true),
          });
        }
        return { root: chain[0], kind: "note", segments };
      }

      const startFile = files.get(initialFile);
      window.mock = {
        indexTextCalls: [],
        previewCalls: [],
        opened: [],
        saves: [],
        handlers: {},
        openOutsideNote: () => files.get("C:/Outside/Free.md"),
      };

      window.folio = folioTest.mock({
        on: (name, fn) => (window.mock.handlers[name] = fn),
        ready: async () => ({
          incoming: [
            {
              id: startFile.id,
              name: startFile.name,
              path: startFile.path,
              text: startFile.text,
              version: startFile.version,
            },
          ],
          restored: [],
          roots: [
            {
              id: "r1",
              name: "微积分",
              path: "C:/Lib",
              ...(rootIndexed ? { index: "C:/Lib/_目录.md" } : {}),
            },
          ],
          settings: { sidebar: true, outline: true, ...settings },
        }),
        list: async (id) => listForDir(id),
        folderIndex: async (id) => {
          const dir = dirs.get(id);
          if (!dir) return null;
          const ix = dir.childFiles.find((p) => p.endsWith("/_目录.md"));
          return ix ? { path: ix, name: "_目录.md" } : null;
        },
        folderIndexText: async (id) => {
          window.mock.indexTextCalls.push(id);
          const dir = dirs.get(id);
          if (!dir) return null;
          const ixPath = dir.childFiles.find((p) => p.endsWith("/_目录.md"));
          const ixFile = ixPath ? files.get(ixPath) : null;
          return {
            folder: { id: dir.id, name: dir.name, path: dir.path },
            index: ixFile ? { name: ixFile.name, path: ixFile.path } : null,
            text: ixFile ? ixFile.text : null,
            items: listForDir(id),
          };
        },
        currentFolder: async (fileId) => {
          const f = byFileId.get(fileId);
          const d = f ? dirs.get(f.folderId) : null;
          return d ? { id: d.id, name: d.name, path: d.path } : null;
        },
        openChild: async (folderId, name) => {
          const dir = dirs.get(folderId);
          if (!dir) throw Error("Not found");
          const p = dir.path + "/" + name;
          const f = files.get(p);
          if (!f) throw Error("Missing child: " + p);
          window.mock.opened.push(p);
          return {
            id: f.id,
            name: f.name,
            path: f.path,
            text: f.text,
            version: f.version,
          };
        },
        previewChild: async (folderId, name) => {
          window.mock.previewCalls.push(`${folderId}:${name}`);
          const dir = dirs.get(folderId);
          const f = dir ? files.get(dir.path + "/" + name) : null;
          return f
            ? { id: f.id, path: f.path, name: f.name, text: f.text }
            : null;
        },
        preview: async (baseId, href) => {
          window.mock.previewCalls.push(`preview:${href}`);
          const base = byFileId.get(baseId);
          const dir = base ? dirs.get(base.folderId) : null;
          const rel = decodeURIComponent(href).replace(/\/$/, "");
          const f = dir ? files.get(dir.path + "/" + rel) : null;
          return f
            ? { id: f.id, path: f.path, name: f.name, text: f.text }
            : null;
        },
        link: async (baseId, target) => {
          const base = byFileId.get(baseId);
          const dir = base ? dirs.get(base.folderId) : null;
          const rel = decodeURIComponent(target);
          const f = dir ? files.get(dir.path + "/" + rel) : null;
          if (!f) return null;
          window.mock.opened.push(f.path);
          return {
            id: f.id,
            name: f.name,
            path: f.path,
            text: f.text,
            version: f.version,
          };
        },
        read: async (fileId, version) => {
          const f = byFileId.get(fileId);
          if (!f || f.version === version) return { unchanged: true };
          return { text: f.text, version: f.version };
        },
        save: async (fileId, text) => {
          const f = byFileId.get(fileId);
          window.mock.saves.push({ fileId, path: f?.path, text });
          if (f) {
            f.text = text;
            f.version = "v" + (window.mock.saves.length + 1);
          }
          return { version: f?.version || "v2", saved: text };
        },
        breadcrumb: async (query) => computeBreadcrumb(query),
      });
    },
    { rootIndexed, initialFile, settings, includeOutside },
  );
  await page.goto("/");
}

const ixItem = (page, title) =>
  page
    .locator("#content .ix-item")
    .filter({
      has: page.locator(":scope > .ix-row > .ix-title", { hasText: title }),
    })
    .first();

test("nested index expands lazily to 2 levels and supports expand-all / top-level-only with persistent folds", async ({
  page,
}) => {
  await setupConnected(page, { rootIndexed: true });
  await expect(ixItem(page, "进阶专题")).toBeVisible();

  // Default 2 levels open: Part1 is open, showing level-2 items; level-2 subfolders & sub-pages start closed.
  await expect(ixItem(page, "第一部分 基础")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(ixItem(page, "第一节 实数系")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(ixItem(page, "进阶专题")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(ixItem(page, "随笔目录")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(ixItem(page, "深层推导")).toHaveCount(0);

  // Lazy loading check: sub, inner, and plain were NOT fetched on initial open.
  const initialCalls = await page.evaluate(() => window.mock.indexTextCalls);
  expect(initialCalls).toContain("part1");
  expect(initialCalls).not.toContain("sub");
  expect(initialCalls).not.toContain("inner");
  expect(initialCalls).not.toContain("plain");

  // Unfolded children haven't fetched excerpts yet.
  const initialPreviews = await page.evaluate(() => window.mock.previewCalls);
  expect(initialPreviews).not.toContain("sub:DeepNote.md");
  expect(initialPreviews).not.toContain("inner:Bottom.md");
  expect(initialPreviews).not.toContain("part1:Detail.md");

  // Expanding Sub lazily loads Sub's index & first sentence without touching Inner.
  await ixItem(page, "进阶专题")
    .locator(":scope > .ix-row > .ix-twisty")
    .click();
  await expect(ixItem(page, "深层推导")).toBeVisible();
  await expect(
    ixItem(page, "深层推导").locator(":scope > .ix-row > .ix-excerpt"),
  ).toHaveText("深层笔记的第一句话。");
  await expect(ixItem(page, "底层归档")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(await page.evaluate(() => window.mock.indexTextCalls)).not.toContain(
    "inner",
  );

  // Expanding unindexed subfolder Plain lists folder first then notes in tree order.
  await ixItem(page, "随笔目录")
    .locator(":scope > .ix-row > .ix-twisty")
    .click();
  await expect(
    ixItem(page, "随笔目录").locator(
      ":scope > .ix-children > .ix-item > .ix-row > .ix-title",
    ),
  ).toHaveText(["NestedPlainDir", "Alpha 标题", "Beta 标题"]);

  // Header control: 只看第一层 collapses Level 1.
  await page.getByRole("button", { name: "只看第一层" }).click();
  await expect(ixItem(page, "第一部分 基础")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(ixItem(page, "进阶专题")).toBeHidden();

  // Header control: 展开全部 expands everything recursively including Inner -> 最深一页.
  await page.getByRole("button", { name: "展开全部" }).click();
  await expect(ixItem(page, "最深一页")).toBeVisible();
  await expect(ixItem(page, "详细推导")).toBeVisible();

  // Fold state persists across Edit -> Read mode switch and in session tabs.
  await page.keyboard.press("Control+2");
  await expect(ixItem(page, "最深一页")).toBeVisible();
  await page.keyboard.press("Control+1");
  await expect(ixItem(page, "最深一页")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.mock.session?.tabs?.[0]?.folds?.length ?? 0),
    )
    .toBeGreaterThan(0);
});

test("nested rows are read-only in Edit mode and open-folder action opens child index", async ({
  page,
}) => {
  await setupConnected(page, { rootIndexed: true });
  await expect(ixItem(page, "进阶专题")).toBeVisible();
  await page.keyboard.press("Control+2");

  // Own row stays editable; nested subfolder row does not.
  const ownRow = ixItem(page, "写在前面").locator(":scope > .ix-row");
  const nestedItem = ixItem(page, "第一节 实数系");
  const nestedRow = nestedItem.locator(":scope > .ix-row");
  await expect(ownRow).toHaveAttribute("draggable", "true");
  await expect(ownRow.locator(".ix-tools")).toBeAttached();

  await expect(nestedItem).toHaveAttribute("data-nested", "true");
  await expect(nestedRow).not.toHaveAttribute("draggable", "true");
  await expect(nestedRow.locator(".ix-tools")).toHaveCount(0);

  // Keyboard edit shortcuts on nested row never modify anything.
  await nestedItem.focus();
  await page.keyboard.press("F2");
  await expect(page.locator(".ix-title-input")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(nestedItem).toHaveAttribute("aria-level", "2");
  await page.keyboard.press("Delete");
  await expect(nestedItem).toBeVisible();

  // Double-clicking a nested title never starts inline rename (clicking navigates).
  await nestedRow.locator(".ix-title").dblclick();
  await expect(page.locator(".ix-title-input")).toHaveCount(0);
  expect(await page.evaluate(() => window.mock.saves)).toEqual([]);
  await page.getByRole("tab", { name: "_目录.md" }).first().click();

  // Dragging an own row onto a nested row drops nothing.
  await ownRow.dragTo(
    ixItem(page, "第一节 实数系").locator(":scope > .ix-row"),
  );
  await expect(page.locator("#editor .cm-content")).not.toBeFocused();
  expect(await page.evaluate(() => window.mock.saves)).toEqual([]);

  // Nested subfolder header has an action to open that subfolder's own index.
  const subRow = ixItem(page, "进阶专题").locator(":scope > .ix-row");
  await subRow.hover();
  await subRow.locator('[data-ix="open-folder"]').click();
  await expect(
    page.getByRole("tab", { name: "_目录.md", exact: false }).nth(1),
  ).toBeVisible();
  await expect(page.locator("#content h1")).toHaveText("进阶专题");
  // The newly opened child index's own entries are now editable.
  await expect(
    ixItem(page, "深层推导").locator(":scope > .ix-row"),
  ).not.toHaveAttribute("data-nested");
});

test("breadcrumbs connect index views upward and notes with sibling switcher and Read/Edit parity", async ({
  page,
}) => {
  await setupConnected(page, {
    rootIndexed: true,
    initialFile: "C:/Lib/Part1/Sub/_目录.md",
  });

  // Index view breadcrumb shows 微积分 › Part1 › Sub (last segment non-clickable).
  const readCrumb = page.locator("#breadcrumb-read");
  await expect(readCrumb).toBeVisible();
  await expect(readCrumb.locator(".bc-link, .bc-current")).toHaveText([
    "微积分",
    "Part1",
    "Sub",
  ]);
  await expect(readCrumb.locator(".bc-current")).toHaveText("Sub");

  // Sibling chevron on Part1 opens dropdown in root index order.
  await readCrumb.locator(".bc-item").nth(1).locator(".bc-chevron").click();
  const menu = page.locator("#breadcrumb-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator('[role="menuitem"] .bc-menu-label')).toHaveText([
    "Part1/",
    "写在前面",
  ]);
  await expect(
    menu.locator('[role="menuitem"][aria-current="true"]'),
  ).toContainText("Part1");

  // Escape closes menu; click Part1 segment navigates upward in the same index tab.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await readCrumb.getByRole("button", { name: "Part1", exact: true }).click();
  await expect(page.locator("#content h1")).toHaveText("第一部分 基础");
  await expect(page.getByRole("tab")).toHaveCount(1);
});

test("note breadcrumb lists nested parent pages, preserves Read/Edit title alignment, respects setting and hides outside library", async ({
  page,
}) => {
  await setupConnected(page, {
    rootIndexed: true,
    initialFile: "C:/Lib/Part1/Detail.md",
    settings: { richEdit: true },
    includeOutside: true,
  });

  const readCrumb = page.locator("#breadcrumb-read");
  await expect(readCrumb).toBeVisible();
  await expect(readCrumb.locator(".bc-link, .bc-current")).toHaveText([
    "微积分",
    "Part1",
    "第一节 实数系",
    "详细推导",
  ]);
  await expect(readCrumb.locator(".bc-current")).toHaveText("详细推导");

  // Sibling chevron on parent page 第一节 实数系 jumps sideways.
  await readCrumb.locator(".bc-item").nth(2).locator(".bc-chevron").click();
  const menu = page.locator("#breadcrumb-menu");
  await expect(menu.locator('[role="menuitem"] .bc-menu-label')).toHaveText([
    "导言",
    "第一节 实数系",
    "Sub/",
    "Plain/",
  ]);
  await menu.getByRole("menuitem", { name: "导言" }).click();
  await expect(page.locator("#content h1")).toHaveText("导言");
  await page.getByRole("tab", { name: "Detail.md" }).click();

  // Compare breadcrumb & title position parity between Read mode and Edit mode.
  const readMetrics = await page.evaluate(() => {
    const crumb = document
      .querySelector("#breadcrumb-read")
      .getBoundingClientRect();
    const prose = document.querySelector("#content").getBoundingClientRect();
    const fm = document
      .querySelector("#content .front-matter")
      ?.getBoundingClientRect();
    const h1 = document.querySelector("#content h1").getBoundingClientRect();
    return {
      crumbTop: crumb.top,
      crumbLeft: crumb.left,
      crumbHeight: crumb.height,
      proseTop: prose.top,
      fmTop: fm?.top ?? null,
      h1Top: h1.top,
      h1Left: h1.left,
    };
  });
  await page.keyboard.press("Control+2");
  await expect(page.locator("#breadcrumb-rich")).toBeVisible();
  const editMetrics = await page.evaluate(() => {
    const crumb = document
      .querySelector("#breadcrumb-rich")
      .getBoundingClientRect();
    const prose = document.querySelector("#rich").getBoundingClientRect();
    const fm = document
      .querySelector("#rich .ProseMirror .front-matter")
      ?.getBoundingClientRect();
    const h1 = document
      .querySelector("#rich .ProseMirror h1")
      .getBoundingClientRect();
    return {
      crumbTop: crumb.top,
      crumbLeft: crumb.left,
      crumbHeight: crumb.height,
      proseTop: prose.top,
      fmTop: fm?.top ?? null,
      h1Top: h1.top,
      h1Left: h1.left,
    };
  });
  expect(
    Math.abs(editMetrics.crumbHeight - readMetrics.crumbHeight),
  ).toBeLessThan(1);
  expect(Math.abs(editMetrics.crumbTop - readMetrics.crumbTop)).toBeLessThan(1);
  expect(Math.abs(editMetrics.crumbLeft - readMetrics.crumbLeft)).toBeLessThan(
    1,
  );
  expect(Math.abs(editMetrics.proseTop - readMetrics.proseTop)).toBeLessThan(1);
  expect(Math.abs(editMetrics.h1Left - readMetrics.h1Left)).toBeLessThan(1.5);
  await page.getByRole("tab", { name: "Intro.md" }).click();
  await page.keyboard.press("Control+1");
  const introReadH1 = await page.locator("#content h1").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left };
  });
  await page.keyboard.press("Control+2");
  await expect(page.locator("#breadcrumb-rich")).toBeVisible();
  const introEditH1 = await page
    .locator("#rich .ProseMirror h1")
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left };
    });
  expect(Math.abs(introEditH1.top - introReadH1.top)).toBeLessThan(1.5);
  expect(Math.abs(introEditH1.left - introReadH1.left)).toBeLessThan(1.5);
  await page.getByRole("tab", { name: "Detail.md" }).click();

  // Setting in 设置 → 导航与滚动 hides and restores breadcrumb.
  await page.locator("#weight").click();
  await page.locator("#settings-navigation #show-breadcrumb").click();
  await page.locator("#appearance-close").click();
  await expect(page.locator("#breadcrumb-rich")).toBeHidden();
  await page.keyboard.press("Control+1");
  await expect(page.locator("#breadcrumb-read")).toBeHidden();

  await page.locator("#weight").click();
  await page.locator("#settings-navigation #show-breadcrumb").click();
  await page.locator("#appearance-close").click();
  await expect(page.locator("#breadcrumb-read")).toBeVisible();

  // Outside library note hides breadcrumb.
  await page.evaluate(() => {
    const f = window.mock.openOutsideNote();
    window.mock.handlers.open([f]);
  });
  await expect(page.locator("#content h1")).toHaveText("库外笔记");
  await expect(page.locator("#breadcrumb-read")).toBeHidden();
});

test("library root without index opens generated read-only contents and never saves an index", async ({
  page,
}) => {
  await setupConnected(page, {
    rootIndexed: false,
    initialFile: "C:/Lib/Preface.md",
  });
  const rootSummary = page.locator("#tree details.folder.root > summary");
  await rootSummary.hover();
  const openBtn = rootSummary.locator("> .folder-index-open");
  await expect(openBtn).toHaveAttribute("aria-label", "打开目录");
  await openBtn.click();

  await expect(page.locator("#content h1")).toHaveText("微积分");
  await expect(ixItem(page, "Part1")).toBeVisible();
  await expect(ixItem(page, "导言")).toBeVisible();
  await expect(ixItem(page, "写在前面")).toBeVisible();

  // Generated view is read-only even in Edit mode and refuses writing any index file.
  await page.keyboard.press("Control+2");
  await expect(page.locator("#content .ix-tools")).toHaveCount(0);
  await expect(page.locator("#content .ix-new")).toHaveCount(0);
  await page.keyboard.press("Control+s");
  await expect(page.locator("#toast")).toContainText("只读");
  expect(await page.evaluate(() => window.mock.saves)).toEqual([]);
});

test("outline lists expanded nested levels and updates as branches fold and unfold", async ({
  page,
}) => {
  await setupConnected(page, { rootIndexed: true });
  const outlineEntries = page.locator("#outline .outline-entry");
  await expect(outlineEntries).toHaveText([
    "第一部分 基础",
    "导言",
    "第一节 实数系",
    "进阶专题",
    "随笔目录",
    "写在前面",
  ]);

  // Expand Sub -> nested chapters inside Sub appear in outline.
  await ixItem(page, "进阶专题")
    .locator(":scope > .ix-row > .ix-twisty")
    .click();
  await expect(outlineEntries).toHaveText([
    "第一部分 基础",
    "导言",
    "第一节 实数系",
    "进阶专题",
    "深层推导",
    "底层归档",
    "随笔目录",
    "写在前面",
  ]);

  // 只看第一层 removes expanded nested levels from outline.
  await page.getByRole("button", { name: "只看第一层" }).click();
  await expect(outlineEntries).toHaveText(["第一部分 基础", "写在前面"]);
});

for (const theme of ["light", "dark"]) {
  test(`capture connected navigation screenshots (${theme})`, async ({
    page,
  }) => {
    // 1. Nested index view (light / dark)
    await setupConnected(page, {
      rootIndexed: true,
      settings: { theme, sidebar: true, outline: true },
    });
    await ixItem(page, "进阶专题")
      .locator(":scope > .ix-row > .ix-twisty")
      .click();
    await expect(ixItem(page, "深层推导")).toBeVisible();
    await page.screenshot({
      path: `.local/nav-shots/index-nested-${theme}.png`,
    });

    // 2. Note with breadcrumb and open siblings dropdown
    await setupConnected(page, {
      rootIndexed: true,
      initialFile: "C:/Lib/Part1/Detail.md",
      settings: { theme, sidebar: true, outline: false },
    });
    const readCrumb = page.locator("#breadcrumb-read");
    await expect(readCrumb).toBeVisible();
    await readCrumb.locator(".bc-item").nth(2).locator(".bc-chevron").click();
    await expect(page.locator("#breadcrumb-menu")).toBeVisible();
    await page.screenshot({
      path: `.local/nav-shots/note-breadcrumb-${theme}.png`,
    });

    // 3. Generated library root contents view
    await setupConnected(page, {
      rootIndexed: false,
      initialFile: "C:/Lib/Preface.md",
      settings: { theme, sidebar: true, outline: true },
    });
    const rootSummary = page.locator("#tree details.folder.root > summary");
    await rootSummary.hover();
    await rootSummary.locator("> .folder-index-open").click();
    await expect(ixItem(page, "导言")).toBeVisible();
    await page.screenshot({
      path: `.local/nav-shots/root-generated-${theme}.png`,
    });
  });
}
