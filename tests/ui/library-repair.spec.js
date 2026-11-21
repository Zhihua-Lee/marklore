import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Repair after a change made elsewhere: another program renamed Plan.md to
// Roadmap.md. A broken link in a note and the folder's index entry are
// repaired only when the reader asks, choosing where they should lead.
async function setup(page) {
  await installFolio(page);
  await page.addInitScript(() => {
    const KB = "C:\\kb";
    const at = (name) => KB + "\\" + name;
    window.calls = [];
    const candidates = [
      {
        path: at("Roadmap.md"),
        name: "Roadmap.md",
        rel: "Roadmap.md",
        reason: "renamed",
      },
      {
        path: at("Archive\\Plan.md"),
        name: "Plan.md",
        rel: "Archive/Plan.md",
        reason: "same-name",
      },
    ];
    const note = (name, extra = {}) => ({
      name,
      path: at(name),
      parent: "kb",
      directory: false,
      ...extra,
    });
    window.mock = { handlers: {} };
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          {
            id: "other",
            name: "Other.md",
            path: at("Other.md"),
            text: "# Other\n\nSee [the plan](Plan.md#goals).\n",
            version: "1",
          },
        ],
        restored: [],
        roots: [{ id: "kb", name: "kb", path: KB }],
        settings: { sidebar: true },
      }),
      list: async (id) =>
        id === "kb"
          ? [
              note("_目录.md", { index: true, missing: 1 }),
              note("Other.md", { depth: 0, listed: true }),
              note("Roadmap.md"),
            ]
          : [],
      backlinks: async () => [],
      linkStatus: async (_id, hrefs) =>
        hrefs.map((href) => (/^Plan\.md/.test(href) ? "missing-file" : "ok")),
      repairOptions: async (file, href) => {
        window.calls.push(["options", file, href]);
        return {
          target: at("Plan.md"),
          name: "Plan.md",
          missing: true,
          candidates,
          creatable: true,
        };
      },
      repairLink: async (file, href, action, drafts) => {
        window.calls.push(["repair", file, href, action, drafts]);
        if (drafts.includes(file) && action.kind === "relocate")
          return {
            draft: {
              path: file,
              kind: "relocate",
              moves: [[at("Plan.md"), action.to]],
            },
          };
        return action.kind === "create"
          ? { created: at("Plan.md") }
          : { written: file };
      },
      indexIssues: async (id) => ({
        index: at("_目录.md"),
        missing: [
          {
            line: 0,
            title: "Plan",
            href: "Plan.md",
            name: "Plan.md",
            target: at("Plan.md"),
            candidates,
          },
        ],
      }),
      lastMove: async () => null,
    });
  });
  await page.goto("/");
  await expect(page.locator("#content h1")).toContainText("Other");
}
const broken = (page) => page.locator("#content a.link-broken");
async function contentMenu(page, item) {
  await broken(page).click({ button: "right" });
  await page.locator("#context").getByRole("menuitem", { name: item }).click();
}

test("a broken link is repaired only when asked: the reader picks where it leads", async ({
  page,
}) => {
  await setup(page);
  await expect(broken(page)).toHaveAttribute("data-broken", "missing-file");
  await contentMenu(page, "修复链接…");
  const dialog = page.getByRole("dialog", { name: "“Plan.md”不存在" });
  await expect(dialog).toContainText("这个链接指向 Plan.md，那里没有文件。");
  const options = dialog.getByRole("option");
  await expect(options).toHaveText([
    "Roadmap.md刚被改名或移动到这里",
    "Archive/Plan.md同名的文件",
  ]);
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  const relocate = dialog.getByRole("button", { name: "改为指向所选" });
  await expect(relocate).toBeFocused();
  // Down to the second, then back: the chosen one is what is used.
  await dialog.getByRole("listbox").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await relocate.click();
  await expect
    .poll(() => page.evaluate(() => window.calls.at(-1)))
    .toEqual([
      "repair",
      "C:\\kb\\Other.md",
      "Plan.md#goals",
      { kind: "relocate", to: "C:\\kb\\Roadmap.md" },
      [],
    ]);
  await expect(page.locator("#toast")).toContainText(
    "链接已改为指向“Roadmap.md”",
  );
  await expect(
    page.locator("#toast").getByRole("button", { name: "撤销" }),
  ).toBeVisible();
  // Create and remove are the other choices; Esc does nothing.
  await contentMenu(page, "修复链接…");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "新建这篇笔记" })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.calls.at(-1)[3]))
    .toEqual({ kind: "create" });
  await contentMenu(page, "修复链接…");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.calls.filter((c) => c[0] === "repair").length,
    ),
  ).toBe(2);
});

test("a note with unsaved changes is repaired in its draft, undoable there", async ({
  page,
}) => {
  await setup(page);
  await expect(broken(page)).toBeVisible();
  await page.keyboard.press("Control+3");
  await page.locator("#editor .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("More.");
  await page.keyboard.press("Control+1");
  await contentMenu(page, "修复链接…");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "改为指向所选" })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.calls.at(-1)[4]))
    .toEqual(["C:\\kb\\Other.md"]);
  await page.keyboard.press("Control+3");
  const editor = page.locator("#editor .cm-content");
  await expect(editor).toContainText("See [the plan](Roadmap.md#goals).More.");
  await editor.click();
  await page.keyboard.press("Control+z");
  await expect(editor).toContainText("See [the plan](Plan.md#goals).More.");
});

test("the index says how many entries are missing and repairs one from its menu", async ({
  page,
}) => {
  const tree = page.locator("#tree");
  await setup(page);
  const index = tree.locator(".file", { hasText: "_目录.md" });
  await expect(index).toHaveAttribute("data-missing", "1 项不存在");
  await index.click({ button: "right" });
  await page
    .locator("#context")
    .getByRole("menuitem", { name: "修复不存在的条目…" })
    .click();
  const dialog = page.getByRole("dialog", { name: "“Plan.md”不存在" });
  await expect(dialog).toContainText("目录中的这一项指向 Plan.md");
  await dialog.getByRole("button", { name: "从目录中移除" }).click();
  await expect
    .poll(() => page.evaluate(() => window.calls.at(-1)))
    .toEqual(["repair", "C:\\kb\\_目录.md", "Plan.md", { kind: "remove" }, []]);
  await expect(page.locator("#toast")).toContainText(
    "已移除指向“Plan.md”的链接",
  );
});
