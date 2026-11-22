import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// The tree's hierarchy work: child pages, indent and outdent (keyboard and
// drag), a folder asked to start an index, renames and moves that update
// the links to them (asked first, undone in one step), and drafts open
// with unsaved changes patched in memory, never written.
async function setup(page, { settings = {} } = {}) {
  await installFolio(page);
  await page.addInitScript((settings) => {
    const KB = "C:\\kb",
      BOX = "C:\\kb\\Box";
    const at = (folder, name) => folder + "\\" + name;
    // kb has an index: its order and nesting; Box has none yet.
    const state = {
      order: [
        ["Plan.md", 0],
        ["Child.md", 1],
        ["Other.md", 0],
      ],
      loose: ["Loose.md"],
      box: ["a.md", "b.md"],
      boxIndex: false,
      last: null,
    };
    const note = (folder, parent, name, extra = {}) => ({
      name,
      path: at(folder, name),
      parent,
      directory: false,
      ...extra,
    });
    const listing = (id) =>
      id === "kb"
        ? [
            note(KB, "kb", "_目录.md", { index: true }),
            ...state.order.map(([name, depth]) =>
              note(KB, "kb", name, { depth, listed: true }),
            ),
            { id: "box", name: "Box", path: BOX, directory: true },
            ...state.loose.map((name) => note(KB, "kb", name)),
          ]
        : id === "box"
          ? state.boxIndex
            ? [
                note(BOX, "box", "_目录.md", { index: true }),
                ...state.box.map((name) =>
                  note(BOX, "box", name, { depth: 0, listed: true }),
                ),
              ]
            : state.box.map((name) => note(BOX, "box", name))
          : [];
    const texts = {
      "Other.md": "# Other\n\nSee [the plan](Plan.md#goals).\n",
    };
    const folderOf = (id) => (id === "box" ? BOX : KB);
    window.calls = [];
    window.state = state;
    window.mock = { handlers: {} };
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [],
        restored: [],
        roots: [{ id: "kb", name: "kb", path: KB }],
        settings: { sidebar: true, ...settings },
      }),
      list: async (id) => listing(id),
      openChild: async (id, name) => ({
        id: name,
        name,
        path: at(folderOf(id), name),
        text: texts[name] || "# " + name + "\n",
        version: "1",
      }),
      // What a note holds on disk now (window.disk, by name), slow if asked.
      read: async (id, version) => {
        (window.reads ??= []).push(id);
        const disk = window.disk?.[id];
        if (!disk || disk.version === version) return { unchanged: true };
        if (disk.delay) await new Promise((r) => setTimeout(r, disk.delay));
        return { text: disk.text, version: disk.version };
      },
      save: async (...args) => {
        window.calls.push(["save", args[0]]);
        return { version: "2" };
      },
      reorderIndex: async (id, move) => {
        window.calls.push(["reorder", id, move]);
        return at(folderOf(id), "_目录.md");
      },
      editIndex: async (id, op) => {
        window.calls.push(["edit", id, op]);
        if (op.kind === "indent" && op.ref === "Other.md")
          state.order[2][1] = 1;
        if (op.kind === "outdent" && op.ref === "Child.md")
          state.order[1][1] = 0;
        return { path: at(folderOf(id), "_目录.md") };
      },
      createIndex: async (id) => {
        window.calls.push(["createIndex", id]);
        state.boxIndex = true;
        return { path: at(BOX, "_目录.md") };
      },
      createEntry: async (id, name, kind, text, place) => {
        window.calls.push(["create", id, name, kind, place]);
        if (id === "kb") {
          const parent = state.order.findIndex(([n]) => n === place?.under);
          state.order.splice(parent + 1, 0, [name, parent >= 0 ? 1 : 0]);
        }
        return {
          id: "new",
          name,
          path: at(folderOf(id), name),
          text,
          version: "n1",
          index: null,
        };
      },
      planRename: async (id, name, newName) => ({
        moves: [[at(folderOf(id), name), at(folderOf(id), newName)]],
        affected:
          name === "Plan.md" || name === "Roadmap.md"
            ? [{ path: at(KB, "Third.md"), name: "Third.md", links: 2 }]
            : [],
      }),
      renameEntry: async (id, name, newName, options) => {
        window.calls.push(["rename", id, name, newName, options]);
        const row = state.order.find(([n]) => n === name);
        if (row) row[0] = newName;
        const moves = [[at(folderOf(id), name), at(folderOf(id), newName)]];
        state.last = {
          label: { kind: "rename", name, to: newName },
          moves,
        };
        return {
          path: moves[0][1],
          // An open note renamed keeps its tab.
          files:
            name === "Other.md"
              ? [{ id: name, path: moves[0][1], name: newName }]
              : [],
          moves,
          rewritten: options.links ? 1 : 0,
          drafts: [],
          failed: [],
        };
      },
      marks: async () => ({ marks: [], run: null }),
      setContext: async (value) => (window.contexts ??= []).push(value),
      lastMove: async () =>
        state.last ? { label: state.last.label, at: "now" } : null,
      undoMove: async (drafts) => {
        window.calls.push(["undo", drafts]);
        const moves = state.last.moves.map(([a, b]) => [b, a]);
        const { name, to } = state.last.label;
        const row = state.order.find(([n]) => n === to);
        if (row) row[0] = name;
        const { links = true, files = [] } = state.last;
        state.last = null;
        return { moves, files, links, restored: [], skipped: [] };
      },
      libraryFolders: async () => [
        { path: KB, name: "kb", rel: "kb" },
        { path: BOX, name: "Box", rel: "kb\\Box" },
        // A large library, when a test asks.
        ...Array.from({ length: window.manyFolders || 0 }, (_, i) => ({
          path: at(KB, "F" + i),
          name: "F" + i,
          rel: "kb\\F" + i,
        })),
      ],
      planMove: async (id, name, dest) => ({
        directory: false,
        to: dest,
        children:
          name === "Plan.md" && !window.childrenError ? ["Child.md"] : [],
        childrenError: window.childrenError || null,
        moves: [[at(folderOf(id), name), at(dest, name)]],
        movesWith: [
          [at(folderOf(id), name), at(dest, name)],
          [at(KB, "Child.md"), at(dest, "Child.md")],
        ],
        affected: [{ path: at(KB, "Third.md"), name: "Third.md", links: 1 }],
        affectedWith: [
          { path: at(KB, "Third.md"), name: "Third.md", links: 1 },
          { path: at(KB, "Fourth.md"), name: "Fourth.md", links: 1 },
        ],
      }),
      moveEntry: async (id, name, dest, options) => {
        window.calls.push(["move", id, name, dest, options]);
        state.order = state.order.filter(
          ([n]) => n !== name && !(options.children && n === "Child.md"),
        );
        state.box.push(name);
        const moves = [[at(folderOf(id), name), at(dest, name)]];
        // An open note moved keeps its tab (its handle follows).
        const files =
          name === "Other.md" ? [{ id: name, path: at(dest, name), name }] : [];
        state.last = {
          label: { kind: "move", name, to: "Box" },
          moves,
          links: options.links,
          files: files.map((f) => ({ ...f, path: moves[0][0] })),
        };
        return {
          path: at(dest, name),
          files,
          moves,
          rewritten: options.links ? 2 : 0,
          drafts: [],
          failed: [],
        };
      },
    });
  }, settings);
  await page.goto("/");
  await expect(
    page.locator("#tree").getByRole("button", { name: "Plan.md", exact: true }),
  ).toBeVisible();
}
const tree = (page) => page.locator("#tree");
const row = (page, name) =>
  tree(page).getByRole("button", { name, exact: true });
const calls = (page, kind) =>
  page.evaluate(
    (kind) => window.calls.filter((c) => !kind || c[0] === kind),
    kind,
  );
async function menu(page, locator, item) {
  await locator.click({ button: "right" });
  await page.locator("#context").getByRole("menuitem", { name: item }).click();
}

test("a child page is made under its note; the unlisted come after a quiet line", async ({
  page,
}) => {
  await setup(page);
  // Loose.md and the Box folder are not in the index: after the separator.
  const separator = tree(page).getByRole("separator");
  await expect(separator).toHaveText("未列入目录");
  expect(
    await tree(page)
      .locator('details.folder[data-path="C:\\\\kb"] > :not(summary)')
      .evaluateAll((list) =>
        list.map((el) => el.textContent.trim().split("\n")[0]),
      ),
  ).toEqual([
    "_目录.md",
    "Plan.mdChild.md",
    "Other.md",
    "未列入目录",
    "Box",
    "Loose.md",
  ]);
  await menu(page, row(page, "Other.md"), "新建子页");
  const name = tree(page).getByRole("textbox", { name: "新子页名称" });
  await expect(name).toBeFocused();
  await name.fill("Details");
  await name.press("Enter");
  await expect(page.getByRole("tab", { name: "Details.md" })).toBeVisible();
  expect((await calls(page, "create"))[0]).toEqual([
    "create",
    "kb",
    "Details.md",
    "note",
    { under: "Other.md", drafts: [] },
  ]);
  // Listed under Other, which now folds like a folder.
  await expect(
    tree(page).locator(".page .pages .file", { hasText: "Details.md" }),
  ).toBeVisible();
  // The index itself has no child pages and does not move.
  await row(page, "_目录.md").click({ button: "right" });
  await expect(
    page.locator("#context").getByRole("menuitem", { name: "新建子页" }),
  ).toBeDisabled();
  await expect(
    page.locator("#context").getByRole("menuitem", { name: "移动到…" }),
  ).toBeDisabled();
});

test("indent and outdent by keyboard and by drag", async ({ page }) => {
  await setup(page);
  // Alt+Shift+→: under the note above; Alt+Shift+←: a level up.
  await row(page, "Other.md").focus();
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await expect
    .poll(() => calls(page, "edit"))
    .toEqual([["edit", "kb", { kind: "indent", ref: "Other.md" }]]);
  await expect(row(page, "Other.md")).toBeFocused();
  await expect(
    tree(page).locator(".pages .file", { hasText: "Other.md" }),
  ).toBeVisible();
  await row(page, "Child.md").focus();
  await page.keyboard.press("Alt+Shift+ArrowLeft");
  await expect
    .poll(() => page.evaluate(() => window.calls.at(-1)))
    .toEqual(["edit", "kb", { kind: "outdent", ref: "Child.md" }]);
  // Drag: into the middle of a note is under it, onto an edge beside it.
  const plan = row(page, "Plan.md");
  const box = await plan.boundingBox();
  await row(page, "Child.md").dragTo(plan, {
    targetPosition: { x: 20, y: box.height / 2 },
  });
  await expect
    .poll(() => page.evaluate(() => window.calls.at(-1)))
    .toEqual([
      "reorder",
      "kb",
      { name: "Child.md", target: "Plan.md", place: "into" },
    ]);
  await row(page, "Child.md").dragTo(plan, {
    targetPosition: { x: 20, y: 1 },
  });
  await expect
    .poll(() => page.evaluate(() => window.calls.at(-1)))
    .toEqual([
      "reorder",
      "kb",
      { name: "Child.md", target: "Plan.md", place: "before" },
    ]);
});

test("a folder without an index is asked first, never given one silently", async ({
  page,
}) => {
  await setup(page);
  await tree(page).getByText("Box", { exact: true }).click();
  await expect(row(page, "b.md")).toBeVisible();
  // Drag to reorder: the question; cancelled, nothing is written.
  await row(page, "b.md").dragTo(row(page, "a.md"), {
    targetPosition: { x: 20, y: 1 },
  });
  const dialog = page.getByRole("dialog", { name: "建立目录" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("为“Box”建立目录？");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
  // Asked again by Alt+Shift+→; this time the index is made, then used.
  await row(page, "b.md").focus();
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "建立 _目录.md" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => calls(page))
    .toEqual([
      ["createIndex", "box"],
      ["edit", "box", { kind: "indent", ref: "b.md" }],
    ]);
  await expect(row(page, "_目录.md").last()).toBeVisible();
});

test("a rename asks about the notes linking to it; one undo takes it back", async ({
  page,
}) => {
  await setup(page);
  await menu(page, row(page, "Plan.md"), "重命名…");
  const input = tree(page).getByRole("textbox", { name: "新名称" });
  await input.fill("Roadmap");
  await input.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "把“Plan.md”改名为“Roadmap.md”",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".tree-dialog-list li")).toHaveText([
    "Third.md2 处",
  ]);
  const update = dialog.getByRole("button", {
    name: "更新 1 篇笔记的链接",
  });
  await expect(update).toBeFocused();
  await expect(dialog.getByRole("button", { name: "只改名" })).toBeVisible();
  await update.click();
  await expect
    .poll(() => calls(page, "rename"))
    .toEqual([
      [
        "rename",
        "kb",
        "Plan.md",
        "Roadmap.md",
        { links: true, drafts: [], title: "Roadmap" },
      ],
    ]);
  const toast = page.locator("#toast");
  await expect(toast).toContainText("已改名，1 篇笔记中的链接已更新");
  await expect(row(page, "Roadmap.md")).toBeVisible();
  // The menu names what undo takes back.
  await row(page, "Other.md").click({ button: "right" });
  await expect(
    page.locator("#context").getByRole("menuitem", {
      name: /撤销上次改名\/移动/,
    }),
  ).toContainText("“Plan.md”改名为“Roadmap.md”");
  await page.keyboard.press("Escape");
  // The toast's undo.
  await toast.getByRole("button", { name: "撤销" }).click();
  await expect.poll(() => calls(page, "undo")).toEqual([["undo", []]]);
  await expect(row(page, "Plan.md")).toBeVisible();
  await expect(toast).toContainText("已撤销上次改名/移动");

  // "Rename only": the links stay, and the toast says so.
  await menu(page, row(page, "Plan.md"), "重命名…");
  await input.fill("Roadmap");
  await input.press("Enter");
  await dialog.getByRole("button", { name: "只改名" }).click();
  await expect
    .poll(() => page.evaluate(() => window.calls.at(-1)))
    .toEqual([
      "rename",
      "kb",
      "Plan.md",
      "Roadmap.md",
      { links: false, drafts: [], title: "Roadmap" },
    ]);
  await expect(toast).toContainText("1 篇笔记中的链接仍指向旧名称");
  // Esc in the question cancels: nothing renamed.
  const before = (await calls(page, "rename")).length;
  await menu(page, row(page, "Roadmap.md"), "重命名…");
  await input.fill("Plan");
  await input.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "把“Roadmap.md”改名为“Plan.md”" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await calls(page, "rename")).length).toBe(before);
});

test("move to a folder: picked from a list or dropped on it, child pages along", async ({
  page,
}) => {
  await setup(page);
  await menu(page, row(page, "Plan.md"), "移动到…");
  const picker = page.getByRole("dialog", { name: "把“Plan.md”移动到…" });
  await expect(picker).toBeVisible();
  // Its own folder is not offered; typing filters.
  await expect(picker.locator(".folder-option")).toHaveCount(1);
  await picker.getByRole("searchbox", { name: "筛选文件夹" }).fill("nothing");
  await expect(picker.getByText("没有可移动到的文件夹")).toBeVisible();
  await picker.getByRole("searchbox", { name: "筛选文件夹" }).fill("box");
  await expect(picker.locator(".folder-option.active")).toContainText("Box");
  await page.keyboard.press("Enter");
  const ask = page.getByRole("dialog", { name: "把“Plan.md”移到“Box”" });
  await expect(ask).toBeVisible();
  // With its child page (the default), two notes' links change.
  const along = ask.getByRole("checkbox", { name: "同时移动 1 个子页" });
  await expect(along).toBeChecked();
  await expect(ask.locator(".tree-dialog-list li")).toHaveCount(2);
  await along.uncheck();
  await expect(ask.locator(".tree-dialog-list li")).toHaveCount(1);
  await along.check();
  await ask.getByRole("button", { name: "更新 2 篇笔记的链接" }).click();
  await expect
    .poll(() => calls(page, "move"))
    .toEqual([
      [
        "move",
        "kb",
        "Plan.md",
        "C:\\kb\\Box",
        { links: true, children: true, drafts: [] },
      ],
    ]);
  await expect(page.locator("#toast")).toContainText(
    "已移到“Box”，2 篇笔记中的链接已更新",
  );
  await expect(row(page, "Plan.md")).toHaveCount(0);

  // Dropped on the middle of a folder's name: moved there.
  const folder = tree(page).getByText("Box", { exact: true });
  const box = await folder.boundingBox();
  await row(page, "Other.md").dragTo(folder, {
    targetPosition: { x: 20, y: box.height / 2 },
  });
  const ask2 = page.getByRole("dialog", { name: "把“Other.md”移到“Box”" });
  await expect(ask2).toBeVisible();
  await expect(ask2.getByRole("checkbox")).toHaveCount(0);
  await ask2.getByRole("button", { name: "只移动" }).click();
  await expect
    .poll(() => page.evaluate(() => window.calls.at(-1)))
    .toEqual([
      "move",
      "kb",
      "Other.md",
      "C:\\kb\\Box",
      { links: false, children: false, drafts: [] },
    ]);
});

test("a draft with unsaved changes is patched in memory, not written", async ({
  page,
}) => {
  await setup(page);
  await row(page, "Other.md").click();
  await expect(page.getByRole("tab", { name: /Other\.md/ })).toBeVisible();
  await page.keyboard.press("Control+3");
  await page.locator("#editor .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("More.");
  await menu(page, row(page, "Plan.md"), "重命名…");
  const input = tree(page).getByRole("textbox", { name: "新名称" });
  await input.fill("Roadmap");
  await input.press("Enter");
  // The draft's own link counts, beside the notes on disk.
  const dialog = page.getByRole("dialog", {
    name: "把“Plan.md”改名为“Roadmap.md”",
  });
  await expect(dialog.locator(".tree-dialog-list li")).toHaveText([
    "Other.md1 处",
    "Third.md2 处",
  ]);
  await dialog.getByRole("button", { name: "更新 2 篇笔记的链接" }).click();
  await expect
    .poll(() => calls(page, "rename"))
    .toEqual([
      [
        "rename",
        "kb",
        "Plan.md",
        "Roadmap.md",
        { links: true, drafts: ["C:\\kb\\Other.md"], title: "Roadmap" },
      ],
    ]);
  // In the editor: the link follows; the tab is still unsaved; no save.
  await expect(page.locator("#editor .cm-content")).toContainText(
    "See [the plan](Roadmap.md#goals).More.",
  );
  await expect(page.getByRole("tab", { name: /Other\.md/ })).toContainText("●");
  expect(await calls(page, "save")).toEqual([]);
  await expect(page.locator("#conflict")).toBeHidden();
  await expect(page.locator("#toast")).toContainText(
    "已改名，2 篇笔记中的链接已更新",
  );
  // Undo patches it back in memory too.
  await page.locator("#toast").getByRole("button", { name: "撤销" }).click();
  await expect
    .poll(() => calls(page, "undo"))
    .toEqual([["undo", ["C:\\kb\\Other.md"]]]);
  await expect(page.locator("#editor .cm-content")).toContainText(
    "See [the plan](Plan.md#goals).More.",
  );
});

// Review finding 2: saved notes in other tabs follow a rename or move at
// once, and typing while a note is being read again raises the conflict
// bar instead of losing the newer disk version.
test("saved notes in background tabs are read again after a rename", async ({
  page,
}) => {
  await setup(page);
  await row(page, "Other.md").click();
  await row(page, "Child.md").click();
  await expect(page.locator(".tab.active")).toContainText("Child.md");
  await page.evaluate(() => {
    window.reads = [];
    window.disk = {
      "Other.md": {
        text: "# Other\n\nSee [the plan](Roadmap.md#goals).\n",
        version: "2",
      },
    };
  });
  await menu(page, row(page, "Plan.md"), "重命名…");
  const input = tree(page).getByRole("textbox", { name: "新名称" });
  await input.fill("Roadmap");
  await input.press("Enter");
  await page.getByRole("dialog").getByRole("button", { name: /^更新/ }).click();
  // Read while still in the background, not only when shown.
  await expect
    .poll(() => page.evaluate(() => window.reads.includes("Other.md")))
    .toBe(true);
  await page.evaluate(() => (window.disk["Other.md"].delay = 2000));
  await page.getByRole("tab", { name: /Other\.md/ }).click();
  await expect(page.locator("#content")).toContainText("See the plan");
  await page.keyboard.press("Control+3");
  await expect(page.locator("#editor .cm-content")).toContainText(
    "Roadmap.md#goals",
  );
});

test("typing while a note is read again shows the conflict, not a stale version", async ({
  page,
}) => {
  await setup(page);
  await row(page, "Other.md").click();
  await page.keyboard.press("Control+3");
  await row(page, "Child.md").click();
  await page.evaluate(() => {
    window.disk = {
      "Other.md": {
        text: "# Other\n\nChanged elsewhere.\n",
        version: "2",
        delay: 600,
      },
    };
  });
  await page.getByRole("tab", { name: /Other\.md/ }).click();
  await page.locator("#editor .cm-content").click();
  await page.keyboard.type("x");
  await expect(page.locator("#conflict")).toBeVisible({ timeout: 4000 });
});

// Review finding 3: an undo after "Move only" leaves a moved draft's own
// links as they are (they were never rewritten).
test("undo after 'move only' does not rewrite the moved draft's links", async ({
  page,
}) => {
  await setup(page);
  await row(page, "Other.md").click();
  await page.keyboard.press("Control+3");
  await page.locator("#editor .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("More.");
  await menu(page, row(page, "Other.md"), "移动到…");
  await page.keyboard.press("Enter");
  await page
    .getByRole("dialog", { name: "把“Other.md”移到“Box”" })
    .getByRole("button", { name: "只移动" })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.calls.at(-1)?.[0]))
    .toBe("move");
  await page.locator("#toast").getByRole("button", { name: "撤销" }).click();
  await expect.poll(() => calls(page, "undo")).toHaveLength(1);
  await expect(page.locator("#editor .cm-content")).toContainText(
    "See [the plan](Plan.md#goals).More.",
  );
});

// Review finding 5: a draft in the editor of Edit mode takes an encoded
// link from a rename and stays in that editor.
test("a draft in the Edit mode editor is patched and keeps its editor", async ({
  page,
}) => {
  await setup(page, { settings: { richEdit: true, editSplit: false } });
  await row(page, "Other.md").click();
  await page.keyboard.press("Control+2");
  const editor = page.locator("#rich .ProseMirror");
  await expect(editor).toContainText("See the plan.");
  await editor.getByText("See the plan.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" More.");
  await menu(page, row(page, "Plan.md"), "重命名…");
  const input = tree(page).getByRole("textbox", { name: "新名称" });
  await input.fill("Road map");
  await input.press("Enter");
  await page.getByRole("dialog").getByRole("button", { name: /^更新/ }).click();
  await expect(page.locator("#toast")).toContainText("已改名");
  await expect(page.locator("#toast")).not.toContainText("源码栏");
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("See the plan. More.");
  await expect(editor.locator('a[href="Road%20map.md#goals"]')).toHaveCount(1);
});

// Review finding 6: what follows a move in the page.
test("child pages that cannot go along are said so in the question", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(
    () => (window.childrenError = "目标文件夹中已有“Child.md”"),
  );
  await menu(page, row(page, "Plan.md"), "移动到…");
  await page.keyboard.press("Enter");
  const ask = page.getByRole("dialog", { name: "把“Plan.md”移到“Box”" });
  await expect(ask).toContainText(
    "子页不能一起移动：目标文件夹中已有“Child.md”",
  );
  await expect(ask.getByRole("checkbox")).toHaveCount(0);
});

test("a folder left out of search stays left out after a rename", async ({
  page,
}) => {
  await setup(page, { settings: { searchExclude: ["C:\\kb\\Box"] } });
  await tree(page).getByText("Box", { exact: true }).focus();
  await page.keyboard.press("F2");
  const input = tree(page).getByRole("textbox", { name: "新名称" });
  await input.fill("Crate");
  await input.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => window.mock.session?.settings?.searchExclude),
    )
    .toEqual(["C:\\kb\\Crate"]);
});

test("the AI's view of the open note follows its rename", async ({ page }) => {
  await setup(page);
  await row(page, "Other.md").click();
  await expect
    .poll(() => page.evaluate(() => (window.contexts || []).length))
    .toBeGreaterThan(0);
  const before = await page.evaluate(() => window.contexts.length);
  await menu(page, row(page, "Other.md"), "重命名…");
  const input = tree(page).getByRole("textbox", { name: "新名称" });
  await input.fill("Else");
  await input.press("Enter");
  await expect(page.getByRole("tab", { name: /Else\.md/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.contexts.length))
    .toBeGreaterThan(before);
});

// Review finding 7: the folder list past its first 300, the drop on a
// folder shown, keyboard moves that change nothing, unlisted entries.
test("the folder list never chooses a folder it does not show", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => (window.manyFolders = 320));
  await menu(page, row(page, "Plan.md"), "移动到…");
  const picker = page.getByRole("dialog", { name: "把“Plan.md”移动到…" });
  await expect(picker.locator(".folder-option")).toHaveCount(300);
  for (let i = 0; i < 310; i++) await page.keyboard.press("ArrowDown");
  await expect(picker.locator(".folder-option.active")).toHaveCount(1);
  await expect(picker.locator(".folder-option.active")).toContainText("F298");
});

test("a drop into a folder is shown like the others", async ({ page }) => {
  await setup(page);
  const shadow = await tree(page)
    .getByText("Box", { exact: true })
    .evaluate((el) => {
      el.classList.add("drop-target");
      el.dataset.drop = "move";
      return getComputedStyle(el).boxShadow;
    });
  expect(shadow).not.toBe("none");
});

test("keyboard moves that change nothing ask nothing; unlisted entries say why", async ({
  page,
}) => {
  await setup(page);
  await tree(page).getByText("Box", { exact: true }).click();
  await row(page, "a.md").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await row(page, "b.md").focus();
  await page.keyboard.press("Alt+Shift+ArrowLeft");
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(300);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
  // In a folder with an index, an entry it does not list.
  await row(page, "Loose.md").focus();
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await expect(page.locator("#toast")).toContainText("“Loose.md”未列入目录");
  expect(await calls(page)).toEqual([]);
});
