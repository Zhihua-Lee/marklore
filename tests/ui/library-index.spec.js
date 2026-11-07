import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// A folder with an index file (_目录.md): the tree follows its order and
// nesting, and dragging rewrites it.
async function setup(page) {
  await installFolio(page);
  await page.addInitScript(() => {
    const file = (name, extra = {}) => ({
      name,
      path: "C:/kb/" + name,
      parent: "root",
      directory: false,
      ...extra,
    });
    window.calls = [];
    // What main lists: the index, its entries in order (depth), the rest.
    const order = [
      ["Intro.md", 0],
      ["Detail.md", 1],
      ["Last.md", 0],
    ];
    const listing = () => [
      file("_目录.md", { index: true }),
      ...order.map(([name, depth]) => file(name, { depth, listed: true })),
      file("Aaa.md"),
    ];
    window.mock = { handlers: {} };
    window.folio = folioTest.mock({
      on: (name, callback) => (window.mock.handlers[name] = callback),
      ready: async () => ({
        incoming: [],
        restored: [],
        roots: [{ id: "root", name: "kb", path: "C:/kb" }],
        settings: { sidebar: true },
      }),
      list: async (id) => (id === "root" ? listing() : []),
      reorderIndex: async (id, move) => {
        window.calls.push([id, move]);
        const at = order.findIndex(([name]) => name === move.name);
        const moved = at >= 0 ? order.splice(at, 1)[0] : [move.name, 0];
        const to = order.findIndex(([name]) => name === move.target);
        if (move.place === "into") order.splice(to + 1, 0, [moved[0], 1]);
        else
          order.splice(move.place === "before" ? to : to + 1, 0, [
            moved[0],
            order[to][1],
          ]);
        return "C:/kb/_目录.md";
      },
      openChild: async (_id, name) => ({
        id: name,
        name,
        path: "C:/kb/" + name,
        text: "- [Intro](Intro.md)\n",
        version: "1",
      }),
    });
  });
  await page.goto("/");
}
const names = (page) =>
  page
    .locator('#tree details.folder[data-path="C:/kb"] .file')
    .allTextContents();

test("the tree follows the folder's index: order, sub-pages, folding", async ({
  page,
}) => {
  await setup(page);
  const tree = page.locator("#tree");
  await expect(
    tree.getByRole("button", { name: "Intro.md", exact: true }),
  ).toBeVisible();
  expect(await names(page)).toEqual([
    "_目录.md",
    "Intro.md",
    "Detail.md",
    "Last.md",
    "Aaa.md",
  ]);
  // Detail is a sub-page of Intro: indented under it, and folds away.
  const sub = tree.locator(".page .pages .file", { hasText: "Detail.md" });
  await expect(sub).toBeVisible();
  const twisty = tree.getByRole("button", { name: /Intro\.md 的子页/ });
  await expect(twisty).toHaveAttribute("aria-expanded", "true");
  await twisty.click();
  await expect(sub).toBeHidden();
  await expect(twisty).toHaveAttribute("aria-expanded", "false");
  // The fold survives a rebuild (a change on disk).
  await page.evaluate(() => window.mock.handlers.library());
  await expect(
    tree.getByRole("button", { name: "Intro.md", exact: true }),
  ).toBeVisible();
  await expect(
    tree.getByRole("button", { name: /Intro\.md 的子页/ }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("dragging an entry rewrites the index; Alt+arrows do the same", async ({
  page,
}) => {
  await setup(page);
  const tree = page.locator("#tree");
  const last = tree.getByRole("button", { name: "Last.md", exact: true });
  const intro = tree.getByRole("button", { name: "Intro.md", exact: true });
  await expect(last).toBeVisible();
  // Drop on the upper edge of Intro: before it.
  const box = await intro.boundingBox();
  await last.dragTo(intro, { targetPosition: { x: 20, y: 2 } });
  await expect
    .poll(() => page.evaluate(() => window.calls))
    .toEqual([
      ["root", { name: "Last.md", target: "Intro.md", place: "before" }],
    ]);
  await expect
    .poll(() => names(page))
    .toEqual(["_目录.md", "Last.md", "Intro.md", "Detail.md", "Aaa.md"]);
  // A note not listed, dropped in the middle of Intro: its sub-page.
  await tree
    .getByRole("button", { name: "Aaa.md", exact: true })
    .dragTo(tree.getByRole("button", { name: "Intro.md", exact: true }), {
      targetPosition: { x: 20, y: box.height / 2 },
    });
  await expect
    .poll(() => page.evaluate(() => window.calls.at(-1)))
    .toEqual(["root", { name: "Aaa.md", target: "Intro.md", place: "into" }]);
  await expect(
    tree.locator(".pages .file", { hasText: "Aaa.md" }),
  ).toBeVisible();
  // Keyboard: Alt+↓ on Last moves it after Intro (past Intro's sub-pages).
  await tree.getByRole("button", { name: "Last.md", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect
    .poll(() => page.evaluate(() => window.calls.at(-1)))
    .toEqual(["root", { name: "Last.md", target: "Intro.md", place: "after" }]);
  await expect(
    tree.getByRole("button", { name: "Last.md", exact: true }),
  ).toBeFocused();
  // The index itself does not move.
  await expect(
    tree.getByRole("button", { name: "_目录.md", exact: true }),
  ).not.toHaveAttribute("draggable", "true");
});

test("an index open with unsaved changes is not rewritten", async ({
  page,
}) => {
  await setup(page);
  const tree = page.locator("#tree");
  await tree.getByRole("button", { name: "_目录.md", exact: true }).click();
  await expect(page.getByRole("tab", { name: /_目录\.md/ })).toBeVisible();
  await page.keyboard.press("Control+3");
  await page.locator("#editor .cm-content").click();
  await page.keyboard.type("x");
  await tree
    .getByRole("button", { name: "Last.md", exact: true })
    .dragTo(tree.getByRole("button", { name: "Intro.md", exact: true }), {
      targetPosition: { x: 20, y: 2 },
    });
  await expect(page.getByText(/_目录\.md 有未保存的修改/)).toBeVisible();
  expect(await page.evaluate(() => window.calls)).toEqual([]);
});
