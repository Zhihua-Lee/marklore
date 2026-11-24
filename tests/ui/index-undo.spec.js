import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// End-to-end Part 1 coverage: every index view mutation, repair, new-page
// creation, file-rename retitle, prose edit, and focus/scroll restoration across
// Read and Edit modes with Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y and toolbar buttons.
async function mountUndoDesk(
  page,
  {
    indexText,
    extraNotes = {},
    longCount = 0,
    settings = {},
    missing = null,
    unlisted = [],
  } = {},
) {
  const initialIndex =
    indexText ||
    [
      "# Guide",
      "",
      "Intro paragraph for testing prose undo.",
      "",
      "- [Alpha](Alpha.md)",
      "- [Beta](Beta.md)",
      "  - [Beta Child](Beta%20Child.md)",
      "- [Gamma](Gamma.md)",
      ...Array.from(
        { length: longCount },
        (_, i) => `- [Item ${i + 1}](Item-${i + 1}.md)`,
      ),
      ...(missing ? [`- [${missing.title}](${missing.href})`] : []),
      "",
    ].join("\n");

  const initialFiles = {
    "Alpha.md": "# Alpha\n\nAlpha body.\n",
    "Beta.md": "# Beta\n\nBeta body.\n",
    "Beta Child.md": "# Beta Child\n\nChild body.\n",
    "Gamma.md": "# Gamma\n\nGamma body.\n",
    ...Object.fromEntries(
      Array.from({ length: longCount }, (_, i) => [
        `Item-${i + 1}.md`,
        `# Item ${i + 1}\n\nSentence ${i + 1}.\n`,
      ]),
    ),
    ...Object.fromEntries(
      unlisted.map((n) => [n, `# ${n.replace(/\.md$/i, "")}\n\nLoose.\n`]),
    ),
    ...extraNotes,
  };

  await installFolio(page);
  await page.addInitScript(
    ({ initialIndex, initialFiles, settings }) => {
      const folderId = "kb";
      const folderPath = "C:/kb";
      const indexPath = folderPath + "/_目录.md";
      const indexId = "idx";
      let seq = 1;
      const files = new Map();
      const order = [];

      function addDiskFile(
        name,
        text,
        id = name === "_目录.md" ? indexId : "f-" + seq++,
      ) {
        const path = folderPath + "/" + name;
        const entry = { id, path, name, text, version: "v" + seq++ };
        files.set(name.toLowerCase(), entry);
        if (!order.includes(name.toLowerCase())) order.push(name.toLowerCase());
        return entry;
      }

      addDiskFile("_目录.md", initialIndex, indexId);
      for (const [name, text] of Object.entries(initialFiles))
        addDiskFile(name, text);

      const firstSentence = (text) => {
        const lines = String(text || "")
          .replace(/^#[^\n]*\n+/, "")
          .trim()
          .split(/\n+/);
        return (lines[0] || "").trim();
      };
      const headingOf = (text) => {
        const m = /^#\s+(.+)$/m.exec(String(text || ""));
        return m ? m[1].trim() : null;
      };
      const safeName = (title, ext = ".md") =>
        title
          .trim()
          .replace(/[<>:"/\\|?*]+/g, "-")
          .replace(/\s+/g, " ") + ext;

      window.calls = [];
      window.trashed = [];
      window.confirm = () => true;
      let lastMove = null;
      let savedIndexVersion = 0;

      const rewriteIndexEntry = (text, oldName, newName, newTitle) =>
        text
          .split("\n")
          .map((line) => {
            if (
              !line.includes(`(${encodeURI(oldName)})`) &&
              !line.includes(`(${oldName})`)
            )
              return line;
            return line.replace(
              /\[[^\]]+\]\([^)]+\)/,
              `[${newTitle}](${encodeURI(newName)})`,
            );
          })
          .join("\n");

      window.folio = folioTest.mock({
        ready: async () => {
          const idx = files.get("_目录.md".toLowerCase());
          return {
            incoming: [
              {
                id: idx.id,
                name: idx.name,
                path: idx.path,
                text: idx.text,
                version: idx.version,
              },
            ],
            restored: [],
            roots: [{ id: folderId, name: "kb", path: folderPath }],
            settings: {
              language: "zh-CN",
              sidebar: false,
              richEdit: true,
              editSplit: false,
              ...settings,
            },
          };
        },
        currentFolder: async (fileId) => {
          const hit = [...files.values()].find((f) => f.id === fileId);
          return hit ? { id: folderId, name: "kb", path: folderPath } : null;
        },
        list: async (id) => {
          if (id !== folderId) return [];
          return order
            .map((k) => files.get(k))
            .filter(Boolean)
            .map((f) => ({
              name: f.name,
              path: f.path,
              parent: folderId,
              directory: false,
              index: f.name === "_目录.md",
              title: headingOf(f.text) || f.name.replace(/\.[^.]+$/, ""),
              heading: headingOf(f.text) || undefined,
              excerpt: firstSentence(f.text),
            }));
        },
        read: async (fileId, sinceVersion) => {
          const f = [...files.values()].find((x) => x.id === fileId);
          if (!f) throw new Error("not found");
          if (sinceVersion && f.version === sinceVersion)
            return { unchanged: true };
          return {
            id: f.id,
            name: f.name,
            path: f.path,
            text: f.text,
            version: f.version,
            unchanged: false,
          };
        },
        save: async (fileId, text) => {
          const f = [...files.values()].find((x) => x.id === fileId);
          if (!f) throw new Error("not found");
          f.text = text;
          f.version = "s" + ++savedIndexVersion;
          window.calls.push({ kind: "save", name: f.name });
          return { version: f.version };
        },
        previewChild: async (id, name) => {
          if (id !== folderId) throw new Error("not found");
          const f = files.get(String(name).toLowerCase());
          if (!f) throw new Error("not found");
          return { id: f.id, path: f.path, name: f.name, text: f.text };
        },
        openChild: async (id, name) => {
          if (id !== folderId) throw new Error("not found");
          const f = files.get(String(name).toLowerCase());
          if (!f) throw new Error("not found");
          return {
            id: f.id,
            name: f.name,
            path: f.path,
            text: f.text,
            version: f.version,
          };
        },
        link: async (_fromId, href) => {
          const decoded = decodeURIComponent(String(href || "").split("#")[0]);
          const f = files.get(decoded.toLowerCase());
          if (!f) throw new Error("not found: " + decoded);
          return {
            id: f.id,
            name: f.name,
            path: f.path,
            text: f.text,
            version: f.version,
          };
        },
        createEntry: async (id, name, kind, text, place) => {
          window.calls.push({
            kind: "createEntry",
            folderId: id,
            name,
            entryKind: kind,
            list: place?.list !== false,
          });
          if (kind === "folder")
            return { name, path: folderPath + "/" + name, directory: true };
          const made = addDiskFile(
            name,
            text || `# ${name.replace(/\.[^.]+$/, "")}\n\n`,
          );
          return {
            id: made.id,
            name: made.name,
            path: made.path,
            text: made.text,
            version: made.version,
          };
        },
        trashEntry: async (id, name, options) => {
          const unlist = Array.isArray(options)
            ? true
            : options?.unlist !== false;
          window.calls.push({ kind: "trashEntry", folderId: id, name, unlist });
          const f = files.get(String(name).toLowerCase());
          if (!f) throw new Error("missing");
          files.delete(String(name).toLowerCase());
          window.trashed.push({
            name: f.name,
            path: f.path,
            text: f.text,
            unlist,
          });
          return { path: f.path, index: null };
        },
        planRename: async (_id, name, guess, { title } = {}) => ({
          moves: [[folderPath + "/" + name, folderPath + "/" + guess]],
          affected: [],
          anchors: [],
          newName: guess,
          title,
        }),
        renameEntry: async (id, name, newName, opts = {}) => {
          const drafts = opts.drafts || [];
          const f = files.get(String(name).toLowerCase());
          if (!f) throw new Error("missing: " + name);
          const oldName = f.name;
          const oldPath = f.path;
          const oldText = f.text;
          const oldTitle =
            headingOf(oldText) || oldName.replace(/\.[^.]+$/, "");
          const targetName = newName || safeName(opts.title || oldTitle);
          const targetTitle = opts.title || targetName.replace(/\.[^.]+$/, "");
          files.delete(oldName.toLowerCase());
          f.name = targetName;
          f.path = folderPath + "/" + targetName;
          f.text = f.text.replace(/^#\s+.+$/m, "# " + targetTitle);
          f.version = "r" + seq++;
          files.set(targetName.toLowerCase(), f);
          const idx = order.indexOf(oldName.toLowerCase());
          if (idx >= 0) order[idx] = targetName.toLowerCase();

          const idxFile = files.get("_目录.md".toLowerCase());
          const idxDirty = drafts.some(
            (d) => d.toLowerCase() === idxFile.path.toLowerCase(),
          );
          const op = {
            kind: "rename",
            from: oldName,
            to: targetName,
            title: targetTitle,
          };
          const prevIdxText = idxFile.text;
          if (!idxDirty) {
            idxFile.text = rewriteIndexEntry(
              idxFile.text,
              oldName,
              targetName,
              targetTitle,
            );
            idxFile.version = "r" + seq++;
          }
          lastMove = {
            kind: "rename",
            label: { kind: "rename", name: oldName, to: targetName },
            oldName,
            newName: targetName,
            oldTitle,
            targetTitle,
            oldPath,
            newPath: f.path,
            oldText,
            fileId: f.id,
            wasCleanIndex: !idxDirty,
            prevIdxText,
          };
          window.calls.push({
            kind: "renameEntry",
            from: oldName,
            to: targetName,
            cleanIndex: !idxDirty,
          });
          return {
            path: f.path,
            files: [{ id: f.id, path: f.path, name: f.name }],
            moves: [[oldPath, f.path]],
            rewritten: 0,
            updated: !idxDirty,
            drafts: idxDirty ? [{ path: idxFile.path, ops: [op] }] : [],
          };
        },
        lastMove: async () => (lastMove ? { label: lastMove.label } : null),
        undoMove: async (drafts = []) => {
          if (!lastMove) throw new Error("nothing to undo");
          const m = lastMove;
          lastMove = null;
          const f = files.get(m.newName.toLowerCase());
          if (f) {
            files.delete(m.newName.toLowerCase());
            f.name = m.oldName;
            f.path = m.oldPath;
            f.text = m.oldText;
            f.version = "u" + seq++;
            files.set(m.oldName.toLowerCase(), f);
            const idx = order.indexOf(m.newName.toLowerCase());
            if (idx >= 0) order[idx] = m.oldName.toLowerCase();
          }
          const idxFile = files.get("_目录.md".toLowerCase());
          const idxDirty = drafts.some(
            (d) => d.toLowerCase() === idxFile.path.toLowerCase(),
          );
          const op = {
            kind: "rename",
            from: m.newName,
            to: m.oldName,
            title: m.oldTitle,
          };
          if (!idxDirty) {
            idxFile.text = rewriteIndexEntry(
              idxFile.text,
              m.newName,
              m.oldName,
              m.oldTitle,
            );
            idxFile.version = "u" + seq++;
          }
          window.calls.push({
            kind: "undoMove",
            revertedTo: m.oldName,
            cleanIndex: !idxDirty,
          });
          return {
            links: true,
            skipped: [],
            files: f ? [{ id: f.id, path: f.path, name: f.name }] : [],
            moves: [[m.newPath, m.oldPath]],
            drafts: idxDirty ? [{ path: idxFile.path, ops: [op] }] : [],
          };
        },
        repairOptions: async () => ({
          candidates: [
            {
              path: folderPath + "/Alpha.md",
              name: "Alpha.md",
              rel: "Alpha.md",
              reason: "same-name",
            },
          ],
        }),
      });
      window.__undoDebug = {
        hasFile: (name) => files.has(String(name).toLowerCase()),
        fileText: (name) => files.get(String(name).toLowerCase())?.text ?? null,
        setFileText: (name, text) => {
          const f = files.get(String(name).toLowerCase());
          if (f) {
            f.text = text;
            f.version = "m" + seq++;
          }
        },
        lastMove: () => lastMove,
      };
    },
    { initialIndex, initialFiles, settings },
  );

  await page.goto("/");
  await expect(
    page.locator("#content .ix-list .ix-item").first(),
  ).toBeVisible();
  if ((settings.mode ?? "edit") === "edit") {
    await page.locator('[data-mode="edit"]').click();
  }
}

const rowNamed = (page, title) =>
  page.locator("#content .ix-item").filter({
    has: page.locator(`> .ix-row .ix-title:text-is("${title}")`),
  });

const pressCtrl = (page, key, { shift = false } = {}) =>
  page.keyboard.press(`${shift ? "Control+Shift+" : "Control+"}${key}`);

test("removing first item, prose block edits, empty reader clicks, and tabbar clicks stay undoable with focus restored", async ({
  page,
}) => {
  await mountUndoDesk(page);

  // 1. Remove first entry (i === 0, no children): focus stays on remaining first entry (not BODY).
  const first = rowNamed(page, "Alpha");
  await first.hover();
  await first
    .locator("> .ix-row")
    .getByRole("button", { name: "移出目录（不删除文件）" })
    .click();
  await expect(rowNamed(page, "Alpha")).toHaveCount(0);
  const focusAfterRemove = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    cls: document.activeElement?.className,
    title: document.activeElement?.querySelector?.(".ix-title")?.textContent,
  }));
  expect(focusAfterRemove.cls).toContain("ix-item");
  expect(focusAfterRemove.title).toBe("Beta");

  // Click empty margin of #reader (outside .ix-list) -> Ctrl+Z still undoes and restores focus.
  await page.locator("#reader").click({ position: { x: 8, y: 8 } });
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("reader");
  await pressCtrl(page, "z");
  await expect(rowNamed(page, "Alpha")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.activeElement?.querySelector?.(".ix-title")?.textContent,
    ),
  ).toBe("Alpha");

  // Click tab label (outside #reader) -> Ctrl+Shift+Z & Ctrl+Z still work.
  await page.locator(".tab-label").first().click();
  await pressCtrl(page, "Z", { shift: true });
  await expect(rowNamed(page, "Alpha")).toHaveCount(0);
  await pressCtrl(page, "z");
  await expect(rowNamed(page, "Alpha")).toHaveCount(1);

  // 2. Prose block edit with Ctrl+Enter keeps focus inside index view and is undoable/redoable.
  const prose = page.locator("#content > p", { hasText: "Intro paragraph" });
  await prose.dblclick();
  const blockArea = page.locator(".ix-block-editor");
  await expect(blockArea).toBeVisible();
  // Ctrl+Z inside .ix-block-editor edits text in the textarea, NOT the index entries behind it.
  await blockArea.fill("Intro edited inside box.");
  await page.keyboard.press("Control+Enter");
  await expect(blockArea).toHaveCount(0);
  await expect(
    page.locator("#content > p", { hasText: "Intro edited inside box." }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "BODY",
  );

  await pressCtrl(page, "z");
  await expect(
    page.locator("#content > p", { hasText: "Intro paragraph" }),
  ).toBeVisible();
  await pressCtrl(page, "y");
  await expect(
    page.locator("#content > p", { hasText: "Intro edited inside box." }),
  ).toBeVisible();

  // 3. Typing in #file-filter keeps Ctrl+Z inside the filter input (does not undo the note).
  await page.getByRole("button", { name: "切换文件夹浏览" }).click();
  await page.locator("#file-filter").fill("abc");
  await pressCtrl(page, "z");
  await expect(
    page.locator("#content > p", { hasText: "Intro edited inside box." }),
  ).toBeVisible();
});

test("mixed index + prose edits, repairs, Read mode empty clicks, toolbar history, and scrollTop preservation", async ({
  page,
}) => {
  await mountUndoDesk(page, {
    longCount: 35,
    missing: { title: "Missing", href: "Missing.md" },
    unlisted: ["Loose.md"],
    settings: { readingFormat: true },
  });

  // Switch to Read mode (even with readingFormat enabled) -> empty #reader click still undoes repairs.
  await page.locator('[data-mode="read"]').click();
  const broken = rowNamed(page, "Missing");
  await broken
    .locator("> .ix-row")
    .getByRole("button", { name: "改为指向…" })
    .click();
  const pick = page.locator(".ix-relocate");
  await pick.selectOption("Alpha.md");
  await expect(
    rowNamed(page, "Missing")
      .locator("> .ix-row")
      .getByRole("button", { name: "创建" }),
  ).toHaveCount(0);

  // Click empty whitespace outside .ix-list in Read mode, press Ctrl+Z -> undoes repair.
  await page.locator("#reader").click({ position: { x: 8, y: 8 } });
  await pressCtrl(page, "z");
  await expect(
    rowNamed(page, "Missing")
      .locator("> .ix-row")
      .getByRole("button", { name: "创建" }),
  ).toBeVisible();
  await pressCtrl(page, "y");
  await expect(
    rowNamed(page, "Missing")
      .locator("> .ix-row")
      .getByRole("button", { name: "创建" }),
  ).toHaveCount(0);
  await pressCtrl(page, "z");
  await expect(
    rowNamed(page, "Missing")
      .locator("> .ix-row")
      .getByRole("button", { name: "创建" }),
  ).toBeVisible();

  // Switch back to Edit mode, mix edits in order, verify toolbar buttons and scrollTop preservation.
  await page.locator('[data-mode="edit"]').click();
  await rowNamed(page, "Item 12").scrollIntoViewIfNeeded();
  const topBefore = await page.evaluate(
    () => document.getElementById("reader").scrollTop,
  );

  // Op 1: Tab on Item 12 (stays scrolled where Item 12 is)
  const item12 = rowNamed(page, "Item 12");
  await item12.focus();
  await page.keyboard.press("Tab");
  await expect(item12).toHaveAttribute("aria-level", "2");
  const topAfterTab = await page.evaluate(
    () => document.getElementById("reader").scrollTop,
  );
  expect(Math.abs(topAfterTab - topBefore)).toBeLessThanOrEqual(4);

  // Op 2: Alt+ArrowDown on Item 12, keeping it near viewport
  await page.keyboard.press("Alt+ArrowDown");
  const topAfterAlt = await page.evaluate(
    () => document.getElementById("reader").scrollTop,
  );
  expect(Math.abs(topAfterAlt - topBefore)).toBeLessThanOrEqual(8);

  // Op 3: Repair Missing by creating it (no index edit), then click Unlisted "加入目录"
  await rowNamed(page, "Missing")
    .locator("> .ix-row")
    .getByRole("button", { name: "创建" })
    .click();
  await expect(
    rowNamed(page, "Missing")
      .locator("> .ix-row")
      .getByRole("button", { name: "创建" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /未列入目录/ }).click();
  await page
    .locator(".ix-unlisted")
    .getByRole("button", { name: "加入目录" })
    .first()
    .click();
  await expect(rowNamed(page, "Loose")).toHaveCount(1);

  // Scroll back near Item 12, then Toolbar Undo undoes Op 3 (Loose) and Op 2 (Alt+Down) & Op 1 (Tab) without losing scrollTop.
  await rowNamed(page, "Item 12").scrollIntoViewIfNeeded();
  const scrollCheck = await page.evaluate(
    () => document.getElementById("reader").scrollTop,
  );
  await page.locator('.edit-history [data-edit="undo"]').click();
  await expect(rowNamed(page, "Loose")).toHaveCount(0);
  await expect(item12).toHaveAttribute("aria-level", "2");
  expect(
    await page.evaluate(() => window.__undoDebug.hasFile("Missing.md")),
  ).toBe(true);

  await page.locator('.edit-history [data-edit="undo"]').click();
  await page.locator('.edit-history [data-edit="undo"]').click();
  await expect(item12).toHaveAttribute("aria-level", "1");
  const topAfterUndo = await page.evaluate(
    () => document.getElementById("reader").scrollTop,
  );
  expect(Math.abs(topAfterUndo - scrollCheck)).toBeLessThanOrEqual(8);

  // Toolbar Redo redoes Op 1, Op 2, Op 3 in order.
  await page.locator('.edit-history [data-edit="redo"]').click();
  await expect(item12).toHaveAttribute("aria-level", "2");
  await page.locator('.edit-history [data-edit="redo"]').click();
  await page.locator('.edit-history [data-edit="redo"]').click();
  await expect(rowNamed(page, "Loose")).toHaveCount(1);
});

test("new page and new child page recycle untouched files on Ctrl+Z, recreate on Redo, and keep modified files with toast", async ({
  page,
}) => {
  await mountUndoDesk(page, { unlisted: ["Existing.md"] });

  // 1. New sub-page under Alpha -> untouched -> Ctrl+Z trashes file with unlist:false -> Redo recreates it.
  const alpha = rowNamed(page, "Alpha");
  await alpha.hover();
  await alpha
    .locator("> .ix-row")
    .getByRole("button", { name: "新建子页" })
    .click();
  const input = page.locator(".ix-new-row .ix-title-input");
  await input.fill("Fresh Sub");
  await input.press("Enter");

  await expect(rowNamed(page, "Fresh Sub")).toHaveCount(1);
  expect(
    await page.evaluate(() => window.__undoDebug.hasFile("Fresh Sub.md")),
  ).toBe(true);

  await pressCtrl(page, "z");
  await expect(rowNamed(page, "Fresh Sub")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__undoDebug.hasFile("Fresh Sub.md")),
  ).toBe(false);
  const trashCall = await page.evaluate(() =>
    window.calls.filter((c) => c.kind === "trashEntry").at(-1),
  );
  expect(trashCall).toMatchObject({ name: "Fresh Sub.md", unlist: false });

  // Redo recreates Fresh Sub.md and restores index entry.
  await pressCtrl(page, "Z", { shift: true });
  await expect(rowNamed(page, "Fresh Sub")).toHaveCount(1);
  expect(
    await page.evaluate(() => window.__undoDebug.fileText("Fresh Sub.md")),
  ).toContain("# Fresh Sub");

  // 2. Modified new page -> Ctrl+Z removes entry, keeps file on disk, and shows toast.
  await page.getByRole("button", { name: "新建页面" }).click();
  const topInput = page.locator(".ix-new-row .ix-title-input");
  await topInput.fill("Edited Note");
  await topInput.press("Enter");
  await expect(rowNamed(page, "Edited Note")).toHaveCount(1);

  await page.evaluate(() =>
    window.__undoDebug.setFileText(
      "Edited Note.md",
      "# Edited Note\n\nUser wrote text here.\n",
    ),
  );
  await pressCtrl(page, "z");
  await expect(rowNamed(page, "Edited Note")).toHaveCount(0);
  await expect(page.locator("#toast")).toContainText("已有修改，未移入回收站");
  expect(
    await page.evaluate(() => window.__undoDebug.hasFile("Edited Note.md")),
  ).toBe(true);

  // Redo puts index entry back WITHOUT overwriting user edits in Edited Note.md!
  await pressCtrl(page, "y");
  await expect(rowNamed(page, "Edited Note")).toHaveCount(1);
  expect(
    await page.evaluate(() => window.__undoDebug.fileText("Edited Note.md")),
  ).toContain("User wrote text here.");

  // 3. New page whose file is opened in an unsaved (dirty) tab -> keeps file and shows toast.
  await page.getByRole("button", { name: "新建页面" }).click();
  await page.locator(".ix-new-row .ix-title-input").fill("Dirty Tab Page");
  await page.locator(".ix-new-row .ix-title-input").press("Enter");
  await expect(rowNamed(page, "Dirty Tab Page")).toHaveCount(1);
  await rowNamed(page, "Dirty Tab Page")
    .locator("> .ix-row .ix-title")
    .click({ modifiers: ["Control"] });
  await expect(page.locator(".tab.active")).toContainText("Dirty Tab Page");
  await page.locator('[data-mode="source"]').click();
  await page.locator("#editor .cm-content").click();
  await page.keyboard.type("\nUnsaved edit.");
  await page.locator(".tab-label", { hasText: "_目录.md" }).click();
  await expect(page.locator(".tab.active")).toContainText("_目录.md");
  await pressCtrl(page, "z");
  await expect(rowNamed(page, "Dirty Tab Page")).toHaveCount(0);
  await expect(page.locator("#toast")).toContainText("已有修改，未移入回收站");
  expect(
    await page.evaluate(() => window.__undoDebug.hasFile("Dirty Tab Page.md")),
  ).toBe(true);

  // 4. Listing a pre-existing file via "新建页面": Ctrl+Z only removes index entry, never trashes it.
  await page.getByRole("button", { name: "新建页面" }).click();
  await page.locator(".ix-new-row .ix-title-input").fill("Existing");
  await page.locator(".ix-new-row .ix-title-input").press("Enter");
  await expect(rowNamed(page, "Existing")).toHaveCount(1);
  await pressCtrl(page, "z");
  await expect(rowNamed(page, "Existing")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__undoDebug.hasFile("Existing.md")),
  ).toBe(true);
});

test("retitle runs undoMove as a batch, blocks redo with toast, preserves prior undo, and stays menu-undoable if edited after", async ({
  page,
}) => {
  await mountUndoDesk(page);

  // Case A: Clean index after prior saved Tab edit -> Retitle Alpha -> Alpha Renamed.
  await rowNamed(page, "Gamma").focus();
  await page.keyboard.press("Tab");
  await expect(rowNamed(page, "Gamma")).toHaveAttribute("aria-level", "2");
  await pressCtrl(page, "s");
  await expect(page.locator(".tab.active")).not.toHaveClass(/dirty/);

  // Retitle Alpha -> Alpha Renamed
  await rowNamed(page, "Alpha").locator("> .ix-row .ix-title").dblclick();
  const edit = page.locator(".ix-title-input");
  await expect(edit).toBeVisible();
  await edit.fill("Alpha Renamed");
  await edit.press("Enter");

  await expect(rowNamed(page, "Alpha Renamed")).toHaveCount(1);
  expect(
    await page.evaluate(() => window.__undoDebug.hasFile("Alpha Renamed.md")),
  ).toBe(true);
  expect(
    await page.evaluate(() => window.__undoDebug.hasFile("Alpha.md")),
  ).toBe(false);

  // Ctrl+Z right after Retitle undoes the file rename as one batch, keeps focus on Alpha (not tree).
  await pressCtrl(page, "z");
  await expect(rowNamed(page, "Alpha")).toHaveCount(1);
  expect(
    await page.evaluate(() => window.__undoDebug.hasFile("Alpha.md")),
  ).toBe(true);
  expect(
    await page.evaluate(() => window.__undoDebug.hasFile("Alpha Renamed.md")),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => document.activeElement?.querySelector?.(".ix-title")?.textContent,
    ),
  ).toBe("Alpha");

  // Ctrl+Shift+Z / Ctrl+Y right after undoing rename shows clear toast and does not redo rename.
  await pressCtrl(page, "Z", { shift: true });
  await expect(page.locator("#toast")).toContainText("改名无法重做");
  await pressCtrl(page, "y");
  await expect(page.locator("#toast")).toContainText("改名无法重做");
  await expect(rowNamed(page, "Alpha")).toHaveCount(1);

  // Next Ctrl+Z still undoes the earlier saved Tab on Gamma!
  await pressCtrl(page, "z");
  await expect(rowNamed(page, "Gamma")).toHaveAttribute("aria-level", "1");

  // Case B: Dirty index -> Retitle -> Ctrl+Z undoes rename, next Ctrl+Z undoes dirty edit.
  await rowNamed(page, "Gamma").focus();
  await page.keyboard.press("Tab");
  await expect(rowNamed(page, "Gamma")).toHaveAttribute("aria-level", "2");
  await rowNamed(page, "Alpha").locator("> .ix-row .ix-title").dblclick();
  await page.locator(".ix-title-input").fill("Alpha Dirty");
  await page.locator(".ix-title-input").press("Enter");
  await expect(rowNamed(page, "Alpha Dirty")).toHaveCount(1);

  await pressCtrl(page, "z");
  await expect(rowNamed(page, "Alpha")).toHaveCount(1);
  await pressCtrl(page, "z");
  await expect(rowNamed(page, "Gamma")).toHaveAttribute("aria-level", "1");

  // Case C: Retitle then edit another index row -> Ctrl+Z undoes the later index edit only,
  // and lastMove stays undoable from the menu.
  await rowNamed(page, "Alpha").locator("> .ix-row .ix-title").dblclick();
  await page.locator(".ix-title-input").fill("Alpha Kept");
  await page.locator(".ix-title-input").press("Enter");
  await expect(rowNamed(page, "Alpha Kept")).toHaveCount(1);

  await rowNamed(page, "Gamma").focus();
  await page.keyboard.press("Tab");
  await expect(rowNamed(page, "Gamma")).toHaveAttribute("aria-level", "2");

  await pressCtrl(page, "z");
  await expect(rowNamed(page, "Gamma")).toHaveAttribute("aria-level", "1");
  await expect(rowNamed(page, "Alpha Kept")).toHaveCount(1);
  expect(
    await page.evaluate(() => window.__undoDebug.lastMove()?.newName),
  ).toBe("Alpha Kept.md");
});
