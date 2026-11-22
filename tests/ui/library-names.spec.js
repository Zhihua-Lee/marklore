import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";
import { setup as setupIndex, item, row } from "./index-view-setup.js";

// One name per note (desktop/note-names.mjs) in the library tree and the
// index view, renaming as one step, the folder's "open index" button, the
// tree's place kept through refreshes, and scrolling while dragging.

// A library "kb" with a folder "章节" (an index, notes with headings that
// differ from their file names) and a long folder "长列表".
async function library(page, { long = 0 } = {}) {
  await installFolio(page);
  await page.addInitScript((long) => {
    const KB = "C:\\kb";
    const CH = KB + "\\章节";
    const LONG = KB + "\\长列表";
    const note = (folder, parent, name, extra = {}) => ({
      name,
      path: folder + "\\" + name,
      parent,
      directory: false,
      ...extra,
    });
    window.mock = {
      handlers: {},
      calls: [],
      lists: {
        kb: [
          { id: "ch", name: "章节", path: CH, directory: true },
          { id: "long", name: "长列表", path: LONG, directory: true },
          note(KB, "kb", "说明.md"),
        ],
        ch: [
          note(CH, "ch", "_目录.md", { index: true }),
          note(CH, "ch", "第一章_集合与映射.md", {
            listed: true,
            depth: 0,
            title: "第一章：集合与映射",
            heading: "第一章：集合与映射",
          }),
          note(CH, "ch", "1.1 集合.md", {
            listed: true,
            depth: 1,
            title: "1.1 集合",
            heading: "1.1 集合",
          }),
          note(CH, "ch", "1.2 映射.md", {
            listed: true,
            depth: 1,
            title: "1.2 映射",
            heading: "1.2 映射",
          }),
          { id: "sub", name: "习题", path: CH + "\\习题", directory: true },
        ],
        sub: [note(CH + "\\习题", "sub", "习题一.md")],
        long: Array.from({ length: long }, (_, i) =>
          note(LONG, "long", `笔记 ${String(i + 1).padStart(3, "0")}.md`),
        ).concat([
          { id: "far", name: "远处", path: LONG + "\\远处", directory: true },
        ]),
        far: [],
      },
      indexes: { ch: CH + "\\_目录.md", sub: CH + "\\习题\\_目录.md" },
    };
    const doc = (id, path, text) => ({
      id,
      path,
      name: path.split("\\").pop(),
      text,
      version: "v1",
    });
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [],
        restored: [],
        roots: [{ id: "kb", name: "kb", path: KB }],
        settings: { sidebar: true },
      }),
      list: async (id) => window.mock.lists[id] || [],
      folderIndex: async (id) => {
        window.mock.calls.push(["folderIndex", id]);
        const path = window.mock.indexes[id];
        return path ? { path, name: path.split("\\").pop() } : null;
      },
      openChild: async (id, name) => {
        window.mock.calls.push(["openChild", id, name]);
        const folder = { kb: KB, ch: CH, sub: CH + "\\习题", long: LONG }[id];
        return doc(id + ":" + name, folder + "\\" + name, "# " + name + "\n");
      },
      planMove: async (id, name, dest) => ({
        directory: false,
        to: dest,
        children: [],
        moves: [],
        affected: [],
      }),
      moveEntry: async (id, name, dest, options) => {
        window.mock.calls.push(["moveEntry", id, name, dest]);
        return { files: [], moves: [], rewritten: 0, failed: [], drafts: [] };
      },
      planUnify: async (id, options) => {
        window.mock.calls.push(["planUnify", id, options.deep]);
        return {
          folder: CH,
          notes: [
            {
              path: CH + "\\第一章_集合与映射.md",
              folder: CH,
              name: "第一章_集合与映射.md",
              title: "第一章：集合与映射",
              to: "第一章：集合与映射.md",
              heading: null,
              entry: null,
              front: null,
            },
            ...(options.deep
              ? [
                  {
                    path: CH + "\\习题\\习题一.md",
                    folder: CH + "\\习题",
                    name: "习题一.md",
                    title: "习题一",
                    to: null,
                    heading: "习题一",
                    entry: null,
                    front: null,
                  },
                ]
              : []),
          ],
          skipped: [],
        };
      },
      unifyNames: async (id, options) => {
        window.mock.calls.push(["unifyNames", id, options.deep]);
        return {
          files: [],
          moves: [
            [CH + "\\第一章_集合与映射.md", CH + "\\第一章：集合与映射.md"],
          ],
          rewritten: 3,
          updated: 2,
          changed: 2,
          failed: [],
          drafts: [],
        };
      },
    });
  }, long);
  await page.goto("/");
}
const tree = (page) => page.locator("#tree");
const folderRow = (page, name) =>
  tree(page).locator("details.folder > summary", { hasText: name }).first();

test("the tree shows a note by its heading, the file name quietly when it differs", async ({
  page,
}) => {
  await library(page);
  await folderRow(page, "章节").click();
  const first = tree(page).locator(
    'button.file[data-name="第一章_集合与映射.md"]',
  );
  await expect(first.locator(".file-title")).toHaveText("第一章：集合与映射");
  await expect(first.locator(".file-name")).toHaveText("第一章_集合与映射.md");
  // A file named after its heading: the name alone.
  const same = tree(page).locator('button.file[data-name="1.2 映射.md"]');
  await expect(same).toHaveText("1.2 映射");
  await expect(same.locator(".file-name")).toHaveCount(0);
  // A note without a heading, and the index file: their file names.
  await expect(
    tree(page).locator('button.file[data-name="_目录.md"]'),
  ).toHaveText("_目录.md");
});

test("a folder with an index has a button opening it in a new tab; a click on the folder still folds it", async ({
  page,
}) => {
  await library(page);
  const chapters = folderRow(page, "章节");
  await chapters.click();
  await expect(chapters.locator("..")).toHaveAttribute("open", "");
  // A note open first: the index must not take its tab.
  await tree(page).locator('button.file[data-name="1.2 映射.md"]').click();
  await expect(page.getByRole("tab", { name: /1\.2 映射\.md/ })).toBeVisible();
  const open = chapters.getByRole("button", { name: "打开目录（_目录.md）" });
  // Quiet until the row is pointed at.
  await expect(open).toHaveCSS("opacity", "0");
  await chapters.hover();
  await expect(open).toHaveCSS("opacity", "1");
  await open.click();
  await expect(page.getByRole("tab", { name: /_目录\.md/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /1\.2 映射\.md/ })).toBeVisible();
  // The folder stayed open: the button did not fold it.
  await expect(chapters.locator("..")).toHaveAttribute("open", "");
  expect(
    await page.evaluate(() =>
      window.mock.calls.filter((c) => c[0] === "openChild"),
    ),
  ).toContainEqual(["openChild", "ch", "_目录.md"]);
  // A closed folder learns it has an index when it is pointed at, and the
  // keyboard reaches the button from the folder's row.
  const sub = folderRow(page, "习题");
  await sub.hover();
  const subOpen = sub.getByRole("button", { name: "打开目录（_目录.md）" });
  await expect(subOpen).toHaveCount(1);
  await sub.focus();
  await page.keyboard.press("Tab");
  await expect(subOpen).toBeFocused();
  await expect(subOpen).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.mock.calls.filter((c) => c[0] === "openChild").at(-1),
      ),
    )
    .toEqual(["openChild", "sub", "_目录.md"]);
  await expect(sub.locator("..")).not.toHaveAttribute("open", "");
  // A folder without an index gets no button.
  await folderRow(page, "长列表").hover();
  await expect(
    folderRow(page, "长列表").locator(".folder-index-open"),
  ).toHaveCount(0);
});

test("refreshing keeps open folders, folded child pages, the scroll and the focused row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 520 });
  await library(page, { long: 60 });
  await folderRow(page, "章节").click();
  await folderRow(page, "习题").click();
  await folderRow(page, "长列表").click();
  // A child page folded.
  const parent = tree(page).locator(".page", {
    has: page.locator('button.file[data-name="第一章_集合与映射.md"]'),
  });
  await parent.locator(".page-twisty").click();
  await expect(parent).toHaveClass(/closed/);
  const target = tree(page).locator('button.file[data-name="笔记 030.md"]');
  await target.scrollIntoViewIfNeeded();
  await target.focus();
  const scroll = await tree(page).evaluate((el) => el.scrollTop);
  expect(scroll).toBeGreaterThan(100);
  const state = () =>
    page.evaluate(() => ({
      open: [...document.querySelectorAll("#tree details.folder[open]")].map(
        (el) => el.dataset.name,
      ),
      folded: [
        ...document.querySelectorAll("#tree .page.closed > .page-row .file"),
      ].map((el) => el.dataset.name),
      focused: document.activeElement?.dataset?.name || null,
      scroll: document.querySelector("#tree").scrollTop,
    }));
  const before = await state();
  expect(before.open).toEqual(["kb", "章节", "习题", "长列表"]);
  // A change on disk (a note added) rebuilds the tree: all as it was.
  await page.evaluate(() => {
    window.mock.lists.long.unshift({
      name: "000 新.md",
      path: "C:\\kb\\长列表\\000 新.md",
      parent: "long",
      directory: false,
    });
    window.mock.handlers.library();
  });
  await expect(
    tree(page).locator('button.file[data-name="000 新.md"]'),
  ).toBeVisible();
  const after = await state();
  expect(after.open).toEqual(before.open);
  expect(after.folded).toEqual(["第一章_集合与映射.md"]);
  expect(after.focused).toBe("笔记 030.md");
  expect(Math.abs(after.scroll - before.scroll)).toBeLessThan(2);
  // The refresh button: the same.
  await page.locator("#tree-refresh").click();
  await page.waitForTimeout(200);
  expect((await state()).open).toEqual(before.open);
  expect(Math.abs((await state()).scroll - before.scroll)).toBeLessThan(2);
  // A search and back: the tree as it was left.
  await page.locator("#file-filter").fill("笔记");
  await expect(tree(page).locator("details.folder")).toHaveCount(0);
  await page.locator("#file-filter").fill("");
  await expect(folderRow(page, "长列表")).toBeVisible();
  const back = await state();
  expect(back.open).toEqual(before.open);
  expect(back.folded).toEqual(["第一章_集合与映射.md"]);
  expect(Math.abs(back.scroll - before.scroll)).toBeLessThan(2);
  // A folder folded by the reader stays folded.
  await folderRow(page, "习题").click();
  await page.evaluate(() => window.mock.handlers.library());
  await page.waitForTimeout(200);
  expect((await state()).open).toEqual(["kb", "章节", "长列表"]);
});

test("dragging near the tree's edge scrolls it to a target that was off screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 520 });
  await library(page, { long: 80 });
  await folderRow(page, "长列表").click();
  const box = await tree(page).boundingBox();
  const far = folderRow(page, "远处");
  // Far below the visible part of the tree.
  expect((await far.boundingBox()).y).toBeGreaterThan(box.y + box.height);
  // The drag as the browser sends it: dragstart on the row, then dragover
  // on whatever is under the pointer, again and again while it rests.
  await page.evaluate(() => {
    const source = document.querySelector(
      '#tree button.file[data-name="笔记 002.md"]',
    );
    window.drag = new DataTransfer();
    source.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, dataTransfer: window.drag }),
    );
    window.hover = (x, y) => {
      const under = document.elementFromPoint(x, y) || document.body;
      under.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer: window.drag,
        }),
      );
      return under;
    };
    window.rest = (x, y) => {
      clearInterval(window.resting);
      window.resting = setInterval(() => window.hover(x, y), 50);
    };
  });
  const x = box.x + 60;
  // Near the bottom edge it scrolls slowly; past it (over the panel below)
  // faster.
  await page.evaluate(
    ([x, y]) => window.rest(x, y),
    [x, box.y + box.height - 30],
  );
  await expect
    .poll(() => tree(page).evaluate((el) => el.scrollTop))
    .toBeGreaterThan(20);
  const slow = await tree(page).evaluate(async (el) => {
    const a = el.scrollTop;
    await new Promise((r) => setTimeout(r, 300));
    return el.scrollTop - a;
  });
  await page.evaluate(
    ([x, y]) => window.rest(x, y),
    [x, box.y + box.height + 30],
  );
  const fast = await tree(page).evaluate(async (el) => {
    await new Promise((r) => setTimeout(r, 100));
    const a = el.scrollTop;
    await new Promise((r) => setTimeout(r, 300));
    return el.scrollTop - a;
  });
  expect(fast).toBeGreaterThan(slow);
  // The pointer leaving the window: a drag from the tree keeps going.
  await page.evaluate(() => {
    clearInterval(window.resting);
    document.body.dispatchEvent(
      new DragEvent("dragleave", { bubbles: true, relatedTarget: null }),
    );
  });
  const going = await tree(page).evaluate(async (el) => {
    const a = el.scrollTop;
    await new Promise((r) => setTimeout(r, 200));
    return el.scrollTop - a;
  });
  expect(going).toBeGreaterThan(0);
  // Until the target is in view; then dropped onto its middle.
  await expect
    .poll(async () => {
      const now = await far.boundingBox();
      return now.y + now.height <= box.y + box.height;
    })
    .toBe(true);
  // The pointer back in the middle: the scrolling stops (the list may
  // still have moved a little), then the target is found where it is.
  await page.evaluate(
    ([x, y]) => window.rest(x, y),
    [x, box.y + box.height / 2],
  );
  await expect
    .poll(() =>
      tree(page).evaluate(async (el) => {
        const a = el.scrollTop;
        await new Promise((r) => setTimeout(r, 150));
        return el.scrollTop - a;
      }),
    )
    .toBe(0);
  const now = await far.boundingBox();
  const centre = [now.x + 40, now.y + now.height / 2];
  await page.evaluate(([x, y]) => window.rest(x, y), centre);
  await expect(far).toHaveAttribute("data-drop", "move");
  await page.evaluate(([x, y]) => {
    clearInterval(window.resting);
    const under = window.hover(x, y);
    under.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        dataTransfer: window.drag,
      }),
    );
  }, centre);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.mock.calls.filter((c) => c[0] === "moveEntry"),
      ),
    )
    .toEqual([["moveEntry", "long", "笔记 002.md", "C:\\kb\\长列表\\远处"]]);
  // The drop ended the scrolling.
  const still = await tree(page).evaluate(async (el) => {
    const a = el.scrollTop;
    await new Promise((r) => setTimeout(r, 200));
    return el.scrollTop - a;
  });
  expect(still).toBe(0);
});

test("a drop on a row's arrow or in the gap beside it counts for that row", async ({
  page,
}) => {
  await library(page);
  await folderRow(page, "章节").click();
  // Dragged onto the 习题 folder's own arrow area (its left padding).
  const source = tree(page).locator('button.file[data-name="1.2 映射.md"]');
  const goal = folderRow(page, "习题");
  await source.dragTo(goal, { targetPosition: { x: 4, y: 12 } });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.mock.calls.filter((c) => c[0] === "moveEntry"),
      ),
    )
    .toEqual([["moveEntry", "ch", "1.2 映射.md", "C:\\kb\\章节\\习题"]]);
});

test("unify names: the folder's notes listed first, then changed in one step", async ({
  page,
}) => {
  await library(page);
  await folderRow(page, "章节").click({ button: "right" });
  await page
    .locator("#context")
    .getByRole("menuitem", { name: /统一名字/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "统一“章节”中的名字" });
  await expect(dialog.locator(".unify-item")).toHaveCount(1);
  await expect(dialog.locator(".unify-item")).toContainText(
    "文件名 第一章_集合与映射.md → 第一章：集合与映射.md",
  );
  await dialog.getByText("包括子文件夹").click();
  await expect(dialog.locator(".unify-item")).toHaveCount(2);
  await expect(dialog.locator(".unify-item").nth(1)).toContainText("加上标题");
  await dialog.getByRole("button", { name: "统一名字" }).click();
  await expect(page.locator("#toast")).toContainText(
    "已统一 2 篇笔记的名字，更新了 5 个文件",
  );
  await expect(
    page.locator("#toast").getByRole("button", { name: "撤销" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.mock.calls.filter((c) => c[0] === "unifyNames"),
    ),
  ).toEqual([["unifyNames", "ch", true]]);
});

// The index view: a title edited there renames the note through the one
// rename (file, entry, heading and links in main), never only the entry.
test("a title edited in the index view renames the note; a dirty index gets the change in its draft", async ({
  page,
}) => {
  await setupIndex(page);
  await page.evaluate(() => {
    window.mock.renames = [];
    const folio = window.folio;
    folio.planRename = async (id, name, newName, options) => ({
      moves: [["C:/kb/数学分析/" + name, "C:/kb/数学分析/" + newName]],
      newName,
      anchors: [],
      affected: [],
    });
    folio.renameEntry = async (id, name, newName, options) => {
      window.mock.renames.push([id, name, newName, options]);
      return {
        path: "C:/kb/数学分析/" + newName,
        files: [],
        moves: [["C:/kb/数学分析/" + name, "C:/kb/数学分析/" + newName]],
        // The index is open with unsaved changes: its entry is the page's.
        drafts: options.drafts.length
          ? [
              {
                path: "C:/kb/数学分析/_目录.md",
                ops: [
                  {
                    kind: "rename",
                    from: name,
                    to: newName,
                    title: options.title,
                  },
                ],
                draft: true,
              },
            ]
          : [],
        rewritten: 2,
        updated: 0,
        failed: [],
        anchors: [],
      };
    };
  });
  await page.keyboard.press("Control+2");
  // An unsaved change first: the index tab is dirty.
  await item(page, "第三章 函数极限").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await item(page, "符号表").focus();
  await page.keyboard.press("F2");
  const input = row(page, "符号表").locator("input.ix-title-input");
  await input.fill("记号: 约定");
  await input.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.mock.renames))
    .toEqual([
      [
        "nb",
        "符号表.md",
        "记号： 约定.md",
        {
          links: true,
          drafts: ["C:/kb/数学分析/_目录.md"],
          title: "记号: 约定",
        },
      ],
    ]);
  // The draft's entry: the new name and the new file, still unsaved.
  await expect(item(page, "记号: 约定")).toBeVisible();
  await page.keyboard.press("Control+3");
  await expect(page.locator("#editor .cm-content")).toContainText(
    "- [记号: 约定](记号：%20约定.md)",
  );
  // Two notes on disk and the index draft.
  await expect(page.locator("#toast")).toContainText("3 篇笔记中的链接已更新");
});

// Saving a note whose leading heading changed renames it, with no question.
test("a save that changes the leading heading renames the note after it", async ({
  page,
}) => {
  await installFolio(page);
  await page.addInitScript(() => {
    window.mock = { handlers: {}, renames: [], saves: 0 };
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          {
            id: "n",
            path: "C:\\kb\\旧名.md",
            name: "旧名.md",
            text: "# 旧名\n\n正文\n",
            version: "v1",
          },
        ],
        restored: [],
        roots: [],
        settings: { sidebar: false },
      }),
      save: async (id, text, version) => {
        window.mock.saves++;
        return { version: version + "s" };
      },
      currentFolder: async () => ({ id: "kb", name: "kb", path: "C:\\kb" }),
      renameEntry: async (id, name, newName, options) => {
        window.mock.renames.push([id, name, newName, options]);
        return {
          path: "C:\\kb\\新名.md",
          files: [{ id: "n", path: "C:\\kb\\新名.md", name: "新名.md" }],
          moves: [["C:\\kb\\旧名.md", "C:\\kb\\新名.md"]],
          rewritten: 3,
          updated: 1,
          failed: [],
          drafts: [],
          anchors: [{ file: "C:\\kb\\新名.md", from: "旧名", to: "新名" }],
        };
      },
    });
  });
  await page.goto("/");
  await page.keyboard.press("Control+3");
  const editor = page.locator("#editor .cm-content");
  await editor.click();
  // Typing alone renames nothing.
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("新名");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.mock.renames)).toEqual([]);
  await page.keyboard.press("Control+s");
  await expect
    .poll(() => page.evaluate(() => window.mock.renames))
    .toEqual([
      [
        "kb",
        "旧名.md",
        null,
        { links: true, drafts: [], title: "新名", previous: "旧名" },
      ],
    ]);
  await expect(page.locator("#toast")).toContainText("已更新 4 篇笔记");
  await expect(
    page.locator("#toast").getByRole("button", { name: "撤销" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /新名\.md/ })).toBeVisible();
  // Saved again with the same heading: nothing more.
  const savedOnce = await page.evaluate(() => window.mock.saves);
  await page.keyboard.type(" ");
  await page.keyboard.press("Control+s");
  await expect
    .poll(() => page.evaluate(() => window.mock.saves))
    .toBeGreaterThan(savedOnce);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.mock.renames.length)).toBe(1);
});

// The index view shows each note by its one name: the heading main lists
// (desktop/note-names.mjs), the file name muted beside it only when the
// file is named otherwise.
test("the index view shows a note's heading as its name, the file name only when it differs", async ({
  page,
}) => {
  await setupIndex(page);
  await page.evaluate(() => {
    const folio = window.folio;
    const list = folio.list;
    folio.list = async (id) =>
      (await list(id)).map((child) => {
        const heading = /^(?:---[\s\S]*?---\n)?# (.+)$/m.exec(
          window.mock.pages[child.name] || "",
        );
        return heading && !child.index
          ? { ...child, title: heading[1], heading: heading[1] }
          : child;
      });
    window.mock.handlers.library();
  });
  // "第二章 数列极限.md" begins "# 第二章": that is its name.
  const chapter = page.locator("#content .ix-item", {
    has: page.locator(
      ':scope > .ix-row > a.ix-title[href="第二章%20数列极限.md"]',
    ),
  });
  const title = chapter.locator(":scope > .ix-row > .ix-title");
  const file = chapter.locator(":scope > .ix-row > .ix-file");
  await expect(title).toHaveText("第二章");
  await expect(file).toHaveText("第二章 数列极限.md");
  // Quieter than the name.
  const [nameColor, fileColor] = await Promise.all([
    title.evaluate((el) => getComputedStyle(el).color),
    file.evaluate((el) => getComputedStyle(el).color),
  ]);
  expect(fileColor).not.toBe(nameColor);
  // A file named after its heading: the name alone.
  await expect(row(page, "1.1 有理数的稠密性").locator(".ix-file")).toHaveCount(
    0,
  );
  // "books.md" begins "# 参考书目": named so, its file name beside it.
  await expect(row(page, "参考书目").locator(".ix-file")).toHaveText(
    "books.md",
  );
});

// The rename after a save follows what was saved, not what was typed since.
test("a save renames after the heading it saved, even while the next edits come in", async ({
  page,
}) => {
  await installFolio(page);
  await page.addInitScript(() => {
    window.mock = { handlers: {}, renames: [] };
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          {
            id: "n",
            path: "C:\\kb\\A.md",
            name: "A.md",
            text: "# A\n\n正文\n",
            version: "v1",
          },
        ],
        restored: [],
        roots: [],
        settings: { sidebar: false },
      }),
      save: async (id, text, version) => ({ version: version + "s" }),
      currentFolder: async () => ({ id: "kb", name: "kb", path: "C:\\kb" }),
      // A rename that takes a while (a large library).
      renameEntry: async (id, name, newName, options) => {
        window.mock.renames.push(options.title);
        await new Promise((resolve) => setTimeout(resolve, 700));
        const path = "C:\\kb\\" + options.title + ".md";
        return {
          path,
          files: [{ id: "n", path, name: options.title + ".md" }],
          moves: [["C:\\kb\\" + name, path]],
          rewritten: 0,
          updated: 0,
          failed: [],
          drafts: [],
          anchors: [],
        };
      },
    });
  });
  await page.goto("/");
  await page.keyboard.press("Control+3");
  await page.locator("#editor .cm-content").click();
  const retitle = async (name) => {
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(name);
  };
  await retitle("B");
  await page.keyboard.press("Control+s");
  await retitle("C");
  await page.keyboard.press("Control+s");
  // Typed, not saved, while the renames are still running.
  await retitle("D");
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => window.mock.renames)).toEqual(["B", "C"]);
});

// A rename that keeps the file name (only the heading, the entry and links
// change in place) still has open notes read again.
test("a rename that rewrites notes in place has their clean tabs read again", async ({
  page,
}) => {
  await library(page);
  await folderRow(page, "章节").click();
  await tree(page).locator('button.file[data-name="1.1 集合.md"]').click();
  await expect(page.getByRole("tab", { name: /1\.1 集合\.md/ })).toBeVisible();
  await page.evaluate(() => {
    const folio = window.folio;
    window.mock.reads = [];
    const read = folio.read;
    folio.read = async (id, version) => {
      window.mock.reads.push(id);
      return read(id, version);
    };
    folio.planRename = async (id, name, newName) => ({
      moves: [],
      newName: name,
      anchors: [],
      affected: [],
    });
    folio.renameEntry = async (id, name) => ({
      path: "C:\\kb\\章节\\" + name,
      files: [],
      moves: [],
      rewritten: 1,
      updated: 1,
      failed: [],
      drafts: [],
      anchors: [],
    });
  });
  await tree(page).locator('button.file[data-name="1.2 映射.md"]').focus();
  await page.keyboard.press("F2");
  const input = tree(page).getByRole("textbox", { name: "新名称" });
  await input.fill("1.2 映射?");
  await input.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.mock.reads))
    .toContain("ch:1.1 集合.md");
});
