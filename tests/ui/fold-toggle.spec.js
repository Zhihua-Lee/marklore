import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

const longParagraphs = (prefix, count = 12) =>
  Array.from(
    { length: count },
    (_, i) =>
      `${prefix} paragraph ${i + 1}: filler words for realistic reading height and scroll position checks.`,
  ).join("\n\n");

async function mountFoldDesk(
  page,
  { docs = [], folders = {}, settings = {} } = {},
) {
  await installFolio(page);
  await page.addInitScript(
    ({ docs, folders, settings }) => {
      if (settings.language)
        localStorage.setItem("folio-language", settings.language);
      window.mock = {
        folders: { ...folders },
        expandCalls: [],
        session: null,
      };
      const allDocs = docs.map((d, i) => ({
        id: d.id || "doc-" + (i + 1),
        name: d.name,
        path: d.path,
        text: d.text,
        version: "v1",
      }));
      const byId = new Map(allDocs.map((d) => [d.id, d]));

      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: allDocs,
          restored: [],
          roots: [{ id: "kb", name: "kb", path: "C:/kb" }],
          settings: {
            language: "zh-CN",
            sidebar: false,
            outline: true,
            outlineSide: "right",
            richEdit: true,
            editSplit: false,
            ...settings,
          },
        }),
        session: async (s) => {
          window.mock.session = s;
        },
        currentFolder: async (fileId) => {
          const d = byId.get(fileId);
          return d
            ? { id: d.folderId || "kb", name: "kb", path: "C:/kb" }
            : null;
        },
        list: async (folderId) => {
          const data = window.mock.folders[folderId];
          if (!data) return [];
          return data.items || [];
        },
        folderIndexText: async (folderId) => {
          window.mock.expandCalls.push(folderId);
          return window.mock.folders[folderId] || null;
        },
        read: async (id) => {
          const d = byId.get(id);
          return d ? { ...d, unchanged: true } : { unchanged: true };
        },
        previewChild: async () => null,
      });
    },
    { docs, folders, settings },
  );
  await page.goto("/");
}

const sampleNote = [
  "# Study Note",
  "",
  "Lead paragraph directly under document title.",
  "",
  "## Section One",
  "",
  longParagraphs("Section one", 10),
  "",
  "### Nested Alpha",
  "",
  "Details inside Nested Alpha.",
  "",
  "## Section Two",
  "",
  longParagraphs("Section two", 12),
  "",
  "### Nested Beta",
  "",
  "Details inside Nested Beta.",
  "",
  "## Section Three",
  "",
  longParagraphs("Section three", 8),
  "",
].join("\n");

test("normal note Read mode folds top-level sections, unfolds all levels, keeps heading in view, and disables in Edit/Source/flat/empty states", async ({
  page,
}) => {
  await mountFoldDesk(page, {
    docs: [
      {
        id: "flat",
        name: "Flat.md",
        path: "C:/kb/Flat.md",
        text: "# Just Title\n\nNo subheadings here.\n",
      },
      {
        id: "multi",
        name: "MultiH1.md",
        path: "C:/kb/MultiH1.md",
        text: "# First Part\n\nBody A.\n\n## Sub A\n\nNested A.\n\n# Second Part\n\nBody B.\n",
      },
      { id: "n1", name: "Study.md", path: "C:/kb/Study.md", text: sampleNote },
    ],
  });

  const toggle = page.locator("#outline-fold");
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-label", "全部折叠");
  await expect(toggle).toHaveAttribute("data-state", "foldAll");
  await expect(page.locator("#content .ix-controls")).toHaveCount(0);

  // Scroll deep into Section Two's body so its heading is scrolled off the top.
  await page.evaluate(() => {
    const reader = document.getElementById("reader");
    const s2 = document.querySelectorAll("#content > .note-section")[1];
    reader.scrollTop = s2.offsetTop + 120;
  });

  // First click folds all top-level #content > .note-section (never .note-title) and brings folded heading into view.
  await toggle.click();
  await expect(page.locator("#content > .note-title")).toBeVisible();
  await expect(page.locator("#content > .note-title")).not.toHaveClass(
    /collapsed/,
  );
  await expect(page.locator("#content > .note-section.collapsed")).toHaveCount(
    3,
  );
  await expect(toggle).toHaveAttribute("aria-label", "全部展开");
  await expect(toggle).toHaveAttribute("data-state", "unfoldAll");

  const section2Visible = await page.evaluate(() => {
    const r = document.getElementById("reader").getBoundingClientRect();
    const h2 = document.querySelectorAll("#content > .note-section")[1]
      .firstElementChild;
    const hr = h2.getBoundingClientRect();
    return { top: hr.top - r.top, bottom: hr.bottom - r.top, height: r.height };
  });
  expect(section2Visible.top).toBeGreaterThanOrEqual(0);
  expect(section2Visible.bottom).toBeLessThanOrEqual(section2Visible.height);

  // Even nested subsection inside folded top section must not leave toggle stuck in fold state.
  // Clicking toggle again unfolds ALL levels.
  await toggle.click();
  await expect(page.locator("#content .note-section.collapsed")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-label", "全部折叠");

  // Fold nested subsection individually, then fold top level, then click toggle -> unfolds ALL levels including nested.
  await page
    .locator("#content .note-section[data-level='3']")
    .first()
    .locator("> h3 > .fold")
    .click();
  await expect(
    page.locator("#content .note-section[data-level='3'].collapsed"),
  ).toHaveCount(1);
  // Top level still expanded -> next click folds top level.
  await expect(toggle).toHaveAttribute("aria-label", "全部折叠");
  await toggle.click();
  await expect(page.locator("#content > .note-section.collapsed")).toHaveCount(
    3,
  );
  await expect(toggle).toHaveAttribute("aria-label", "全部展开");
  // Next click unfolds EVERYTHING across all levels.
  await toggle.click();
  await expect(page.locator("#content .note-section.collapsed")).toHaveCount(0);

  // Manual single-section folding updates the button state when all top sections are manually closed.
  for (const btn of await page
    .locator("#content > .note-section > h2 > .fold")
    .all())
    await btn.click();
  await expect(toggle).toHaveAttribute("aria-label", "全部展开");
  await toggle.click();
  await expect(page.locator("#content .note-section.collapsed")).toHaveCount(0);

  // Normal note Edit mode & Source mode disable the button; returning to Read re-enables it.
  await page.locator('[data-mode="edit"]').click();
  await expect(toggle).toBeDisabled();
  await page.locator('[data-mode="source"]').click();
  await expect(toggle).toBeDisabled();
  await page.locator('[data-mode="read"]').click();
  await expect(toggle).toBeEnabled();

  // Multiple H1 headings: #content > .note-section[data-level='1'] are foldable sections.
  await page.locator(".tab-label", { hasText: "MultiH1" }).click();
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(
    page.locator("#content > .note-section[data-level='1'].collapsed"),
  ).toHaveCount(2);
  await toggle.click();
  await expect(page.locator("#content .note-section.collapsed")).toHaveCount(0);

  // Flat note without sections -> button disabled.
  await page.locator(".tab-label", { hasText: "Flat" }).click();
  await expect(toggle).toBeDisabled();

  // Closing all tabs (Home empty state) -> button disabled.
  while ((await page.locator(".tab-close").count()) > 0)
    await page.locator(".tab-close").first().click();
  await expect(toggle).toBeDisabled();
});

test("index view Read and Edit modes toggle first-level / expand-all, disable on flat index & source mode, preserve reading position, and hide .ix-controls", async ({
  page,
}) => {
  await mountFoldDesk(page, {
    docs: [
      {
        id: "flat-idx",
        name: "SUMMARY.md",
        path: "C:/kb/sub/SUMMARY.md",
        text: "# Flat Summary\n\n- [Only A](OnlyA.md)\n- [Only B](OnlyB.md)\n",
      },
      {
        id: "idx",
        name: "_目录.md",
        path: "C:/kb/_目录.md",
        text: [
          "# Knowledge Index",
          "",
          "- [Topic One](Topic%20One.md)",
          "  - [Child A](Child%20A.md)",
          "    - [Grandchild A1](Grandchild%20A1.md)",
          "  - [Child B](Child%20B.md)",
          "- [Folder Sub](Sub/)",
          "- [Standalone](Standalone.md)",
          "",
        ].join("\n"),
      },
    ],
    folders: {
      kb: {
        folder: { id: "kb", name: "kb", path: "C:/kb" },
        index: { name: "_目录.md", path: "C:/kb/_目录.md" },
        items: [
          {
            name: "_目录.md",
            path: "C:/kb/_目录.md",
            directory: false,
            index: true,
          },
          {
            name: "Topic One.md",
            path: "C:/kb/Topic One.md",
            directory: false,
          },
          { name: "Child A.md", path: "C:/kb/Child A.md", directory: false },
          {
            name: "Grandchild A1.md",
            path: "C:/kb/Grandchild A1.md",
            directory: false,
          },
          { name: "Child B.md", path: "C:/kb/Child B.md", directory: false },
          { name: "Sub", path: "C:/kb/Sub", directory: true, id: "sub" },
          {
            name: "Standalone.md",
            path: "C:/kb/Standalone.md",
            directory: false,
          },
        ],
      },
      sub: {
        folder: { id: "sub", name: "Sub", path: "C:/kb/Sub" },
        index: { name: "_目录.md", path: "C:/kb/Sub/_目录.md" },
        text: "- [Sub Note](SubNote.md)\n  - [Deep Sub](DeepSub.md)\n",
        items: [
          {
            name: "_目录.md",
            path: "C:/kb/Sub/_目录.md",
            directory: false,
            index: true,
          },
          {
            name: "SubNote.md",
            path: "C:/kb/Sub/SubNote.md",
            directory: false,
          },
          {
            name: "DeepSub.md",
            path: "C:/kb/Sub/DeepSub.md",
            directory: false,
          },
        ],
      },
    },
  });

  const toggle = page.locator("#outline-fold");
  const ix = (title) =>
    page.locator("#content .ix-item").filter({
      has: page.locator(`> .ix-row > .ix-title:text-is("${title}")`),
    });

  await expect(page.locator("#content .ix-controls")).toHaveCount(0);
  await expect(ix("Child A")).toBeVisible();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-label", "全部折叠");

  // Read mode: collapse to level 1 -> expand all lazily across Sub.
  await toggle.click();
  await expect(ix("Topic One")).toHaveAttribute("aria-expanded", "false");
  await expect(ix("Folder Sub")).toHaveAttribute("aria-expanded", "false");
  await expect(ix("Child A")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-label", "全部展开");

  await toggle.click();
  await expect(ix("Topic One")).toHaveAttribute("aria-expanded", "true");
  await expect(ix("Deep Sub")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-label", "全部折叠");

  // Edit mode on index view keeps toggle active; roving tabindex moves onto collapsed parent
  // when toggled via button, and live focus moves onto collapsed parent via Alt+Shift+[.
  await page.locator('[data-mode="edit"]').click();
  await expect(toggle).toBeEnabled();
  await ix("Grandchild A1").focus();
  await toggle.click();
  await expect(ix("Child A")).toBeHidden();
  await expect(
    page.locator('#content .ix-item[tabindex="0"] > .ix-row > .ix-title'),
  ).toHaveText("Topic One");
  await toggle.click();
  await expect(ix("Grandchild A1")).toBeVisible();
  await ix("Grandchild A1").focus();
  await page.keyboard.press("Alt+Shift+BracketLeft");
  await expect(ix("Child A")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.activeElement?.closest(".ix-item")?.dataset.foldKey || "",
    ),
  ).toContain("topic one");

  // Source mode of index view disables button.
  await page.locator('[data-mode="source"]').click();
  await expect(toggle).toBeDisabled();

  // Flat index (SUMMARY.md without children/subfolders) disables button.
  await page.locator(".tab-label", { hasText: "SUMMARY.md" }).click();
  await expect(page.locator("#content .ix-item")).toHaveCount(2);
  await expect(toggle).toBeDisabled();
});

test("Alt+Shift+[ and Alt+Shift+] work when outline sidebar is hidden, respect disabled state, and honor English locale", async ({
  page,
}) => {
  await mountFoldDesk(page, {
    docs: [
      { id: "n1", name: "Study.md", path: "C:/kb/Study.md", text: sampleNote },
    ],
    settings: { outline: false, language: "en" },
  });

  // Hidden #outline-panel: Alt+Shift+[ folds top sections, Alt+Shift+] unfolds all levels.
  await expect(page.locator("#outline-panel")).toBeHidden();
  await page.keyboard.press("Alt+Shift+BracketLeft");
  await expect(page.locator("#content > .note-section.collapsed")).toHaveCount(
    3,
  );
  await page.keyboard.press("Alt+Shift+BracketRight");
  await expect(page.locator("#content .note-section.collapsed")).toHaveCount(0);

  // Open #outline-panel in English locale -> English ARIA label & title match state.
  await page.locator("#outline-toggle").click();
  const toggle = page.locator("#outline-fold");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-label", "Collapse all");
  await expect(toggle).toHaveAttribute("title", "Collapse all (Alt+Shift+[)");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-label", "Expand all");
  await expect(toggle).toHaveAttribute("title", "Expand all (Alt+Shift+])");

  // Ignored cleanly when focus is inside Edit mode of a normal note.
  await page.locator('[data-mode="edit"]').click();
  await expect(toggle).toBeDisabled();
  await page.keyboard.press("Alt+Shift+BracketRight");
  await expect(toggle).toBeDisabled();
});

test("large index expand-all stops safely at MAX_EXPAND_FOLDERS cap and notifies with toast", async ({
  page,
}) => {
  const folderEntries = Array.from({ length: 70 }, (_, i) => `Sub${i + 1}`);
  const indexText = [
    "# Big Vault",
    "",
    "- [Group A](GroupA.md)",
    ...folderEntries.slice(0, 35).map((n) => `  - [${n}](${n}/)`),
    "- [Group B](GroupB.md)",
    ...folderEntries.slice(35).map((n) => `  - [${n}](${n}/)`),
    "",
  ].join("\n");

  const folders = {
    kb: {
      folder: { id: "kb", name: "kb", path: "C:/kb" },
      index: { name: "_目录.md", path: "C:/kb/_目录.md" },
      items: [
        {
          name: "_目录.md",
          path: "C:/kb/_目录.md",
          directory: false,
          index: true,
        },
        { name: "GroupA.md", path: "C:/kb/GroupA.md", directory: false },
        { name: "GroupB.md", path: "C:/kb/GroupB.md", directory: false },
        ...folderEntries.map((n) => ({
          name: n,
          path: "C:/kb/" + n,
          directory: true,
          id: n.toLowerCase(),
        })),
      ],
    },
    ...Object.fromEntries(
      folderEntries.map((n) => [
        n.toLowerCase(),
        {
          folder: { id: n.toLowerCase(), name: n, path: "C:/kb/" + n },
          index: { name: "_目录.md", path: `C:/kb/${n}/_目录.md` },
          text: `- [${n} Page](Note.md)\n`,
          items: [
            { name: "Note.md", path: `C:/kb/${n}/Note.md`, directory: false },
          ],
        },
      ]),
    ),
  };

  await mountFoldDesk(page, {
    docs: [
      { id: "big", name: "_目录.md", path: "C:/kb/_目录.md", text: indexText },
    ],
    folders,
  });

  // Default 2 levels initially opened -> Sub1..Sub70 top-level are open, wait:
  // collapseLevel1 first, then Expand All to hit lazy subfolder limit cleanly.
  const toggle = page.locator("#outline-fold");
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-label", "全部展开");

  await page.evaluate(() => {
    window.mock.expandCalls = [];
  });
  await toggle.click();
  await expect(page.locator("#toast")).toContainText("仅展开前一部分");
  const countLoaded = await page.evaluate(
    () => new Set(window.mock.expandCalls).size,
  );
  expect(countLoaded).toBeLessThanOrEqual(64);
});

for (const theme of ["light", "dark"]) {
  test(`capture outline fold toggle screenshots (${theme})`, async ({
    page,
  }) => {
    await mountFoldDesk(page, {
      docs: [
        {
          id: "flat",
          name: "Flat.md",
          path: "C:/kb/Flat.md",
          text: "# Standalone Note\n\nPlain body only.\n",
        },
        {
          id: "idx",
          name: "_目录.md",
          path: "C:/kb/_目录.md",
          text: "# Contents\n\n- [Chapter 1](C1.md)\n  - [Lesson 1](L1.md)\n- [Chapter 2](C2.md)\n",
        },
        {
          id: "n1",
          name: "Study.md",
          path: "C:/kb/Study.md",
          text: sampleNote,
        },
      ],
      folders: {
        kb: {
          folder: { id: "kb", name: "kb", path: "C:/kb" },
          items: [
            { name: "C1.md", path: "C:/kb/C1.md", directory: false },
            { name: "L1.md", path: "C:/kb/L1.md", directory: false },
            { name: "C2.md", path: "C:/kb/C2.md", directory: false },
            { name: "Study.md", path: "C:/kb/Study.md", directory: false },
            { name: "Flat.md", path: "C:/kb/Flat.md", directory: false },
            {
              name: "_目录.md",
              path: "C:/kb/_目录.md",
              directory: false,
              index: true,
            },
          ],
        },
      },
      settings: { theme, sidebar: true, outline: true },
    });

    await page.screenshot({
      path: `.local/fold-shots/note-expanded-${theme}.png`,
    });
    await page.locator("#outline-fold").click();
    await expect(
      page.locator("#content > .note-section.collapsed"),
    ).toHaveCount(3);
    await page.screenshot({
      path: `.local/fold-shots/note-folded-${theme}.png`,
    });

    await page.locator(".tab-label", { hasText: "_目录.md" }).click();
    await expect(page.locator("#content .ix-item")).toHaveCount(3);
    await page.screenshot({
      path: `.local/fold-shots/index-toggle-${theme}.png`,
    });

    if (theme === "light") {
      await page.locator(".tab-label", { hasText: "Flat.md" }).click();
      await expect(page.locator("#outline-fold")).toBeDisabled();
      await page.screenshot({
        path: ".local/fold-shots/outline-disabled-light.png",
      });
    }
  });
}
