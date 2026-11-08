import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// The library's tree: the open note's folder is shown where the library
// holds it (not twice), and the tree's own menu creates, renames and moves
// notes and folders to the Recycle Bin; library folders move or leave.
async function setup(page, { notePath = "C:/kb/Topic/Deep/Note.md" } = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ notePath }) => {
      const folder = (id, path) => ({
        id,
        path,
        name: path.split("/").at(-1),
        directory: true,
      });
      const note = (folderId, path) => ({
        name: path.split("/").at(-1),
        path,
        parent: folderId,
        directory: false,
      });
      // Folders by id: what main would list in each.
      window.disk = {
        kb: [folder("topic", "C:/kb/Topic"), note("kb", "C:/kb/Index.md")],
        topic: [folder("deep", "C:/kb/Topic/Deep")],
        deep: [note("deep", "C:/kb/Topic/Deep/Note.md")],
        other: [note("other", "C:/other/Loose.md")],
        refs: [note("refs", "C:/refs/Paper.md")],
      };
      const paths = {
        kb: "C:/kb",
        topic: "C:/kb/Topic",
        deep: "C:/kb/Topic/Deep",
        other: "C:/other",
        refs: "C:/refs",
      };
      window.calls = [];
      window.confirmations = [];
      window.confirm = (question) => {
        window.confirmations.push(question);
        return true;
      };
      const noteFolder = notePath.slice(0, notePath.lastIndexOf("/"));
      const id = Object.keys(paths).find((key) => paths[key] === noteFolder);
      window.mock = { handlers: {} };
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [
            {
              id: "note",
              name: notePath.split("/").at(-1),
              path: notePath,
              text: "# Note\n\nText.\n",
              version: "v1",
            },
          ],
          restored: [],
          roots: [
            { id: "kb", name: "kb", path: "C:/kb" },
            { id: "refs", name: "refs", path: "C:/refs" },
          ],
          settings: { sidebar: true, searchExclude: [] },
        }),
        currentFolder: async () => ({
          id,
          path: noteFolder,
          name: noteFolder.split("/").at(-1),
        }),
        list: async (folderId) => window.disk[folderId] || [],
        createEntry: async (folderId, name, kind) => {
          window.calls.push(["create", folderId, name, kind]);
          const path = paths[folderId] + "/" + name;
          if (kind === "folder") {
            paths[name] = path;
            window.disk[folderId].unshift(folder(name, path));
            return folder(name, path);
          }
          window.disk[folderId].push(note(folderId, path));
          return { id: "new", name, path, text: "", version: "n1" };
        },
        renameEntry: async (folderId, name, newName) => {
          window.calls.push(["rename", folderId, name, newName]);
          const entry = window.disk[folderId].find((e) => e.name === name);
          entry.name = newName;
          entry.path = paths[folderId] + "/" + newName;
          return {
            path: entry.path,
            files:
              entry.path.endsWith(".md") && name === "Note.md"
                ? [{ id: "note", path: entry.path, name: newName }]
                : [],
            links: 2,
          };
        },
        trashEntry: async (folderId, name) => {
          window.calls.push(["trash", folderId, name]);
          const list = window.disk[folderId];
          const at = list.findIndex((e) => e.name === name);
          const [entry] = list.splice(at, 1);
          return { path: entry.path };
        },
        revealEntry: async (...args) => window.calls.push(["reveal", ...args]),
        openChild: async (_id, name) => ({
          id: name,
          name,
          path: "C:/kb/" + name,
          text: "# " + name + "\n",
          version: "1",
        }),
      });
    },
    { notePath },
  );
  await page.goto("/");
  await expect(page.locator("#content h1")).toContainText("Note");
}
const tree = (page) => page.locator("#tree");
const rootNames = (page) =>
  tree(page)
    .locator(":scope > details.folder > summary")
    .evaluateAll((list) => list.map((s) => s.textContent));
async function menu(page, locator, item) {
  await locator.click({ button: "right" });
  await page.locator("#context").getByRole("menuitem", { name: item }).click();
}

test("the open note's folder is shown inside the library, opened down to it", async ({
  page,
}) => {
  await setup(page);
  const current = tree(page).locator('.file[aria-current="page"]');
  await expect(current).toHaveText("Note.md");
  // Not repeated on top: only the library folders.
  expect(await rootNames(page)).toEqual(["kb", "refs"]);
  for (const path of ["C:/kb", "C:/kb/Topic", "C:/kb/Topic/Deep"])
    await expect(
      tree(page).locator(`details.folder[data-path="${path}"]`),
    ).toHaveAttribute("open", "");
});

test("a note outside the library brings its folder on top, which can join", async ({
  page,
}) => {
  await setup(page, { notePath: "C:/other/Loose.md" });
  await expect(tree(page).locator('.file[aria-current="page"]')).toHaveText(
    "Loose.md",
  );
  expect(await rootNames(page)).toEqual(["other", "kb", "refs"]);
  const outside = tree(page).locator("details.folder.outside > summary");
  await expect(outside).toHaveAttribute("data-note", "不在笔记库中");
  await menu(page, outside, "加入笔记库");
  await expect(tree(page).locator("details.folder.outside")).toHaveCount(0);
  expect(await rootNames(page)).toEqual(["kb", "refs", "other"]);
  await expect
    .poll(() =>
      page.evaluate(() => window.mock.session?.roots?.includes("other")),
    )
    .toBe(true);
});

test("new notes and folders, rename and the Recycle Bin from the tree", async ({
  page,
}) => {
  await setup(page);
  const topic = tree(page).locator(
    'details.folder[data-path="C:/kb/Topic"] > summary',
  );

  // A new note: named in place, created with .md, opened for writing.
  await menu(page, topic, "新建笔记");
  const name = tree(page).getByRole("textbox", { name: "新笔记名称" });
  await expect(name).toBeFocused();
  await name.fill("Ideas");
  await name.press("Enter");
  await expect(page.getByRole("tab", { name: "Ideas.md" })).toBeVisible();
  await expect(
    page.locator("#rich .ProseMirror, .cm-editor").first(),
  ).toBeVisible();
  expect(await page.evaluate(() => window.calls[0])).toEqual([
    "create",
    "topic",
    "Ideas.md",
    "note",
  ]);

  // A new folder; Esc leaves a name box without doing anything.
  await menu(page, topic, "新建文件夹");
  await tree(page)
    .getByRole("textbox", { name: "新文件夹名称" })
    .press("Escape");
  await menu(page, topic, "新建文件夹");
  const folderName = tree(page).getByRole("textbox", { name: "新文件夹名称" });
  await folderName.fill("Drafts");
  await folderName.press("Enter");
  await expect(
    tree(page).locator('details.folder[data-path="C:/kb/Topic/Drafts"]'),
  ).toHaveAttribute("open", "");
  expect(
    await page.evaluate(() => window.calls.filter((c) => c[0] === "create")),
  ).toHaveLength(2);

  // The open note renamed: its tab follows; links elsewhere are reported.
  const note = tree(page).getByRole("button", { name: "Note.md", exact: true });
  await menu(page, note, "重命名…");
  const rename = tree(page).getByRole("textbox", { name: "新名称" });
  // The name is selected without its extension.
  expect(
    await rename.evaluate((input) => [
      input.selectionStart,
      input.selectionEnd,
    ]),
  ).toEqual([0, 4]);
  await rename.pressSequentially("Plan");
  await rename.press("Enter");
  await expect(page.getByRole("tab", { name: "Plan.md" })).toBeVisible();
  await expect(page.locator("#toast")).toContainText("2 篇笔记中的链接");
  await expect(
    tree(page).getByRole("button", { name: "Plan.md", exact: true }),
  ).toBeVisible();

  // F2 renames a folder in place.
  await tree(page)
    .locator('details.folder[data-path="C:/kb/Topic/Deep"] > summary')
    .focus();
  await page.keyboard.press("F2");
  const folderRename = tree(page).getByRole("textbox", { name: "新名称" });
  await folderRename.fill("Deeper");
  await folderRename.press("Enter");
  expect(await page.evaluate(() => window.calls.at(-1))).toEqual([
    "rename",
    "topic",
    "Deep",
    "Deeper",
  ]);

  // To the Recycle Bin, after asking; the note's tab closes.
  await menu(
    page,
    tree(page).getByRole("button", { name: "Ideas.md", exact: true }),
    "移到回收站",
  );
  expect(await page.evaluate(() => window.confirmations)).toEqual([
    "把“Ideas.md”移到回收站？",
  ]);
  await expect(page.getByRole("tab", { name: "Ideas.md" })).toHaveCount(0);
  await expect(
    tree(page).getByRole("button", { name: "Ideas.md", exact: true }),
  ).toHaveCount(0);
});

test("library folders move up or down and leave the library; their files stay", async ({
  page,
}) => {
  await setup(page);
  const kb = tree(page).locator(
    'details.folder.root[data-path="C:/kb"] > summary',
  );
  await kb.click({ button: "right" });
  const context = page.locator("#context");
  await expect(context.getByRole("menuitem", { name: "上移" })).toBeDisabled();
  await expect(context.getByRole("menuitem", { name: /重命名/ })).toHaveCount(
    0,
  );
  await context.getByRole("menuitem", { name: "下移" }).click();
  expect(await rootNames(page)).toEqual(["refs", "kb"]);
  await menu(
    page,
    tree(page).locator('details.folder.root[data-path="C:/refs"] > summary'),
    /移出笔记库/,
  );
  expect(await rootNames(page)).toEqual(["kb"]);
  expect(await page.evaluate(() => window.calls)).toEqual([]);
  await expect
    .poll(() => page.evaluate(() => window.mock.session?.roots))
    .toEqual(["kb"]);
});
