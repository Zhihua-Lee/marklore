import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

const note = [
  "# Tools",
  "",
  "Alpha paragraph with **needle** inside and more text.",
  "",
  "## Folded",
  "",
  "Hidden needle lives in a section that starts collapsed.",
  "",
  "## Tasks",
  "",
  "- [ ] first task",
  "- [x] done task",
  "  - [ ] nested task",
  "> - [ ] quoted task",
  "1. [ ] numbered task",
  "",
  "Last NEEDLE here.",
  "",
].join("\n");

async function boot(page, { text = note, recent = [] } = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, recent }) => {
      const file = {
        id: "tools",
        name: "Tools.md",
        path: "C:/synthetic/Tools.md",
        version: "v1",
        text,
      };
      const saved = JSON.parse(localStorage.getItem("tools-session") || "null");
      window.mock = { recent, opened: [], cleared: 0 };
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: saved ? [] : [file],
          restored: [],
          roots: [],
          settings: { sidebar: false, outline: true },
        }),
        recentFiles: async () => window.mock.recent,
        openRecent: async (p) => {
          window.mock.opened.push(p);
          return {
            id: "r-" + p,
            name: p.split("/").pop(),
            path: p,
            version: "v1",
            text: "# Reopened\n",
          };
        },
        clearRecent: async () => {
          window.mock.cleared++;
          window.mock.recent = [];
        },
      });
    },
    { text, recent },
  );
  await page.goto("/");
}
const source = (page) =>
  page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .find((n) => n.includes("@codemirror_view.js"));
    const { EditorView } = await import(url);
    return EditorView.findFromDOM(
      document.querySelector(".cm-editor"),
    ).state.doc.toString();
  });

test("find in the rendered note counts, cycles, unfolds and closes", async ({
  page,
}) => {
  await boot(page);
  await expect(page.locator("#content h1")).toHaveText(/Tools/);
  // Fold the section that holds one of the matches.
  await page
    .locator("#content h2", { hasText: "Folded" })
    .locator(".fold")
    .click();
  await expect(
    page.locator(".note-section.collapsed", { hasText: "Folded" }),
  ).toHaveCount(1);
  await page.locator("#reader").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+f");
  const bar = page.locator("#find-bar");
  await expect(bar).toBeVisible();
  await page.keyboard.type("needle");
  // Case-insensitive, across the bold span, three matches; the first is current.
  await expect(bar.locator(".find-count")).toHaveText("1/3");
  await page.keyboard.press("Enter");
  await expect(bar.locator(".find-count")).toHaveText("2/3");
  // Landing on the folded match opens its section.
  await expect(
    page.locator(".note-section.collapsed", { hasText: "Folded" }),
  ).toHaveCount(0);
  await page.keyboard.press("Shift+Enter");
  await expect(bar.locator(".find-count")).toHaveText("1/3");
  await page.keyboard.press("Shift+Enter");
  await expect(bar.locator(".find-count")).toHaveText("3/3");
  expect(
    await page.evaluate(() => CSS.highlights.get("folio-find")?.size),
  ).toBe(3);
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();
  expect(await page.evaluate(() => CSS.highlights.has("folio-find"))).toBe(
    false,
  );
  // No match is reported plainly.
  await page.keyboard.press("Control+f");
  await page.keyboard.type("zzz-absent");
  await expect(bar.locator(".find-count")).toHaveText("无结果");
});

test("Ctrl+F in the editor keeps CodeMirror's own search", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator("#editor .cm-content").click();
  await page.keyboard.press("Control+f");
  await expect(page.locator(".cm-search")).toBeVisible();
  await expect(page.locator("#find-bar")).toBeHidden();
});

test("task checkboxes toggle their own source line and mark the note unsaved", async ({
  page,
}) => {
  await boot(page);
  const boxes = page.locator("#content input.task-list-item-checkbox");
  await expect(boxes).toHaveCount(5);
  await expect(boxes.first()).toBeEnabled();
  await boxes.nth(0).click();
  await expect.poll(() => source(page)).toContain("- [x] first task");
  await boxes.nth(1).click();
  await expect.poll(() => source(page)).toContain("- [ ] done task");
  await boxes.nth(2).click();
  await expect.poll(() => source(page)).toContain("  - [x] nested task");
  await boxes.nth(3).click();
  await expect.poll(() => source(page)).toContain("> - [x] quoted task");
  await boxes.nth(4).click();
  await expect.poll(() => source(page)).toContain("1. [x] numbered task");
  // Nothing else in the note changed.
  expect((await source(page)).replace(/\[[ x]\]/g, "[?]")).toBe(
    note.replace(/\[[ x]\]/g, "[?]"),
  );
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "● Tools.md",
  );
  // The rendered state follows the source after re-render.
  await expect(boxes.nth(0)).toBeChecked();
  await expect(boxes.nth(1)).not.toBeChecked();
});

test("start page lists recent notes, reopens them and can clear the list", async ({
  page,
}) => {
  await boot(page, {
    recent: [
      { path: "C:/notes/Alpha.md", name: "Alpha.md", folder: "C:/notes" },
      { path: "C:/work/Beta.md", name: "Beta.md", folder: "C:/work" },
    ],
  });
  // Close the only tab to reach the start page.
  await page.getByRole("button", { name: "关闭 Tools.md" }).click();
  const recent = page.locator(".start-recent");
  await expect(recent).toBeVisible();
  await expect(recent.locator(".recent-name")).toHaveText([
    "Alpha.md",
    "Beta.md",
  ]);
  await recent.getByRole("button", { name: /Beta\.md/ }).click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("Beta.md");
  expect(await page.evaluate(() => window.mock.opened)).toEqual([
    "C:/work/Beta.md",
  ]);
  await page.getByRole("button", { name: "关闭 Beta.md" }).click();
  await page.getByRole("button", { name: "清除记录" }).click();
  await expect(recent).toBeHidden();
  expect(await page.evaluate(() => window.mock.cleared)).toBe(1);
});
