import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";
import { caretAfter } from "./rich-helpers.js";

// The tab's unsaved mark "●" follows every edit, including the first edit
// after a save or after the note was reloaded from disk.
async function boot(page, settings = {}) {
  await installFolio(page);
  await page.addInitScript((settings) => {
    const files = ["A", "B"].map((n) => ({
      id: "file-" + n,
      path: `C:/synthetic/${n}.md`,
      name: `${n}.md`,
      text: `---\ntitle: ${n}\nmodified: 2020-01-02T03:04:05+08:00\n---\n\nText ${n}.\n`,
      version: "v1",
    }));
    window.mock = { files, handlers: {}, saved: [] };
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: files.map((f) => ({ ...f })),
        restored: [],
        roots: [],
        settings: { sidebar: false, outline: false, ...settings },
      }),
      read: async (id, version) => {
        const file = files.find((f) => f.id === id);
        return version === file.version ? { unchanged: true } : { ...file };
      },
      save: async (id, text, version) => {
        const file = files.find((f) => f.id === id);
        if (file.version !== version) return { conflict: true };
        window.mock.saved.push({ id, text });
        Object.assign(file, { text, version: version + "s" });
        return { version: file.version };
      },
    });
  }, settings);
  await page.goto("/");
  await expect(page.getByRole("tab")).toHaveCount(2);
}

const tab = (page) => page.getByRole("tab", { selected: true });

async function expectMark(page, name, unsaved) {
  await expect(tab(page)).toHaveText((unsaved ? "● " : "") + name);
  await expect
    .poll(() => page.evaluate(() => document.title))
    .toBe((unsaved ? "● " : "") + name + " — Marklore");
}

async function save(page) {
  const before = await page.evaluate(() => window.mock.saved.length);
  await page.keyboard.press("Control+s");
  await expect
    .poll(() => page.evaluate(() => window.mock.saved.length))
    .toBeGreaterThan(before);
}

// Typing goes where the mode takes it: the drawn note (Edit) or the source.
async function type(page, rich, after, text) {
  if (rich) {
    // Clicks less than half a second apart make a double click, and typing
    // that soon joins the earlier typing's undo step.
    await page.waitForTimeout(600);
    await caretAfter(page, after);
  } else {
    await page.locator("#editor .cm-content").click();
    await page.keyboard.press("Control+End");
  }
  await page.keyboard.type(text);
}

const modes = [
  { title: "Edit mode", settings: { richEdit: true }, key: "Control+2" },
  {
    title: "Edit mode with the source pane",
    settings: { richEdit: true, editSplit: true },
    key: "Control+2",
  },
  { title: "source mode", settings: { richEdit: true }, key: "Control+3" },
  {
    title: "split view",
    settings: { richEdit: false, editSplit: true },
    key: "Control+2",
  },
];

for (const { title, settings, key } of modes)
  test(`${title}: the unsaved mark comes back with the first edit after a save`, async ({
    page,
  }) => {
    await boot(page, settings);
    const rich = settings.richEdit && key === "Control+2";
    for (const name of ["B.md", "A.md"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await page.keyboard.press(key);
      const letter = name[0];
      await expectMark(page, name, false);
      await type(page, rich, `Text ${letter}.`, "1");
      await expectMark(page, name, true);
      await save(page);
      await expectMark(page, name, false);
      // The next edit marks the tab again, undoing it clears the mark, and
      // redoing the edit marks it once more.
      await type(page, rich, `Text ${letter}.1`, "2");
      await expectMark(page, name, true);
      await page.keyboard.press("Control+z");
      await expectMark(page, name, false);
      await type(page, rich, `Text ${letter}.1`, "3");
      await expectMark(page, name, true);
    }
    // Both tabs keep their own mark, and closing an unsaved one still asks.
    await expect(
      page.getByRole("tab", { name: "● B.md", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭 A.md", exact: true }).click();
    await expect(page.locator("#confirm")).toBeVisible();
    await page
      .locator("#confirm")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.mock.session?.tabs.map((d) => typeof d.draft === "string"),
        ),
      )
      .toEqual([true, true]);
    // Saved, it closes without asking.
    await save(page);
    await expectMark(page, "A.md", false);
    await page.getByRole("button", { name: "关闭 A.md", exact: true }).click();
    await expect(page.locator("#confirm")).toBeHidden();
    await expect(page.getByRole("tab")).toHaveCount(1);
  });

test("the mark returns after a save that set the modified time", async ({
  page,
}) => {
  await boot(page, { richEdit: true, stampModified: true });
  await page.getByRole("tab", { name: "A.md", exact: true }).click();
  await page.keyboard.press("Control+2");
  await type(page, true, "Text A.", "1");
  await expectMark(page, "A.md", true);
  await save(page);
  expect(
    await page.evaluate(() => window.mock.saved.at(-1).text),
  ).not.toContain("2020-01-02");
  await expectMark(page, "A.md", false);
  await type(page, true, "Text A.1", "2");
  await expectMark(page, "A.md", true);
});

test("the mark returns after the note was reloaded from disk", async ({
  page,
}) => {
  await boot(page, { richEdit: true });
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("tab", { name: "A.md", exact: true }).click();
  await page.keyboard.press("Control+3");
  await type(page, false, "", "1");
  await expectMark(page, "A.md", true);
  // Changed on disk while edited: the disk version is loaded.
  await page.evaluate(() => {
    Object.assign(window.mock.files[0], {
      text: "# Disk\n\nFrom disk.\n",
      version: "v2",
    });
    window.mock.handlers.disk();
  });
  await page
    .locator("#conflict")
    .getByRole("button", { name: "加载磁盘版本" })
    .click();
  await expect(page.locator("#editor .cm-content")).toContainText("From disk.");
  await expectMark(page, "A.md", false);
  await type(page, false, "", "2");
  await expectMark(page, "A.md", true);
});
