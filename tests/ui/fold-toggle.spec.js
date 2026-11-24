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
  { docs = [], folders = {}, rootFolder = null, settings = {} } = {},
) {
  await installFolio(page);
  await page.addInitScript(
    ({ docs, folders, rootFolder, settings }) => {
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
        ...(d.generated ? { generated: d.generated } : {}),
      }));
      const byId = new Map(allDocs.map((d) => [d.id, d]));

      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: allDocs.filter((d) => !d.generated),
          restored: [],
          roots: [rootFolder || { id: "kb", name: "kb", path: "C:/kb" }],
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
    { docs, folders, rootFolder, settings },
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
  longParagraphs("Section one", 8),
  "",
  "### Nested Alpha",
  "",
  "Details inside Nested Alpha.",
  "",
  "## Section Two",
  "",
  longParagraphs("Section two", 10),
  "",
  "### Nested Beta",
  "",
  "Details inside Nested Beta.",
  "",
  "## Section Three",
  "",
  longParagraphs("Section three", 6),
  "",
].join("\n");

test("normal note Read mode steps level-by-level with two buttons and Shift+click, keeps heading in view, and disables in Edit/Source/flat/empty", async ({
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
        text: "# First Part\n\nBody A.\n\n## Sub A\n\nBody A2.\n\n### Deep A\n\nLeaf.\n\n# Second Part\n\nBody B.\n",
      },
      { id: "n1", name: "Study.md", path: "C:/kb/Study.md", text: sampleNote },
    ],
  });

  const expand = page.locator("#outline-expand");
  const collapse = page.locator("#outline-collapse");
  await expect(expand).toBeVisible();
  await expect(collapse).toBeVisible();
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeEnabled();
  await expect(expand).toHaveAttribute("aria-label", "展开一层");
  await expect(collapse).toHaveAttribute("aria-label", "折叠一层");
  await expect(collapse).toHaveAttribute(
    "title",
    "折叠一层（Alt+Shift+[，Shift+点击全部折叠）",
  );
  await expect(page.locator("#content .ix-controls")).toHaveCount(0);

  // Step 1 (collapse one level): folds ONLY level-2 sections (###), keeping top-level ## open.
  await collapse.click();
  await expect(page.locator("#content > .note-section.collapsed")).toHaveCount(
    0,
  );
  await expect(
    page.locator("#content .note-section[data-level='3'].collapsed"),
  ).toHaveCount(2);
  await expect(expand).toBeEnabled();
  await expect(collapse).toBeEnabled();

  // Scroll into Section Two's body so its heading is scrolled above the viewport top.
  await page.evaluate(() => {
    const reader = document.getElementById("reader");
    const s2 = document.querySelectorAll("#content > .note-section")[1];
    reader.scrollTop = s2.offsetTop + 120;
  });

  // Step 2 (collapse one level): folds top-level ## sections, preserves .note-title, brings Section Two heading into view.
  await collapse.click();
  await expect(page.locator("#content > .note-title")).toBeVisible();
  await expect(page.locator("#content > .note-title")).not.toHaveClass(
    /collapsed/,
  );
  await expect(page.locator("#content > .note-section.collapsed")).toHaveCount(
    3,
  );
  await expect(page.locator("#content .note-section.collapsed")).toHaveCount(5);
  await expect(expand).toBeEnabled();
  await expect(collapse).toBeDisabled();

  const section2Visible = await page.evaluate(() => {
    const r = document.getElementById("reader").getBoundingClientRect();
    const h2 = document.querySelectorAll("#content > .note-section")[1]
      .firstElementChild;
    const hr = h2.getBoundingClientRect();
    return { top: hr.top - r.top, bottom: hr.bottom - r.top, height: r.height };
  });
  expect(section2Visible.top).toBeGreaterThanOrEqual(0);
  expect(section2Visible.bottom).toBeLessThanOrEqual(section2Visible.height);

  // Step 3 (+1): opens level-2 sections (## Section One/Two/Three), keeping level-3 (###) collapsed.
  await expand.click();
  await expect(page.locator("#content > .note-section.collapsed")).toHaveCount(
    0,
  );
  await expect(
    page.locator("#content .note-section[data-level='3'].collapsed"),
  ).toHaveCount(2);
  await expect(
    page.locator("#content .note-section[data-level='3'] > h3").first(),
  ).toBeVisible();
  await expect(expand).toBeEnabled();
  await expect(collapse).toBeEnabled();

  // Step 4 (+1): opens level-3 sections -> deepest level open -> expand disabled, collapse enabled.
  await expand.click();
  await expect(page.locator("#content .note-section.collapsed")).toHaveCount(0);
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeEnabled();

  // Shift+click collapse: folds all levels to top level in one step.
  await collapse.click({ modifiers: ["Shift"] });
  await expect(page.locator("#content > .note-section.collapsed")).toHaveCount(
    3,
  );
  await expect(page.locator("#content .note-section.collapsed")).toHaveCount(5);
  await expect(expand).toBeEnabled();
  await expect(collapse).toBeDisabled();

  // Multi-H1 note 3-level step each way (Shift+fold -> +1 -> +1 -> +1 -> -1 -> -1 -> -1).
  await page.locator(".tab-label", { hasText: "MultiH1" }).click();
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeEnabled();
  await collapse.click({ modifiers: ["Shift"] });
  await expect(
    page.locator("#content > .note-section[data-level='1'].collapsed"),
  ).toHaveCount(2);
  await expect(collapse).toBeDisabled();
  await expand.click();
  await expect(
    page.locator("#content > .note-section[data-level='1'].collapsed"),
  ).toHaveCount(0);
  await expect(
    page.locator("#content .note-section[data-level='2'].collapsed"),
  ).toHaveCount(1);
  await expect(
    page.locator("#content .note-section[data-level='3'].collapsed"),
  ).toHaveCount(1);
  await expand.click();
  await expect(
    page.locator("#content .note-section[data-level='2'].collapsed"),
  ).toHaveCount(0);
  await expect(
    page.locator("#content .note-section[data-level='3'].collapsed"),
  ).toHaveCount(1);
  await expand.click();
  await expect(page.locator("#content .note-section.collapsed")).toHaveCount(0);
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeEnabled();

  await collapse.click();
  await expect(
    page.locator("#content .note-section[data-level='3'].collapsed"),
  ).toHaveCount(1);
  await expect(
    page.locator("#content .note-section[data-level='2'].collapsed"),
  ).toHaveCount(0);
  await collapse.click();
  await expect(
    page.locator("#content .note-section[data-level='2'].collapsed"),
  ).toHaveCount(1);
  await expect(
    page.locator("#content > .note-section[data-level='1'].collapsed"),
  ).toHaveCount(0);
  await collapse.click();
  await expect(
    page.locator("#content > .note-section[data-level='1'].collapsed"),
  ).toHaveCount(2);
  await expect(collapse).toBeDisabled();

  // Normal note Edit & Source modes disable both buttons; Read mode re-enables.
  await page.locator('[data-mode="edit"]').click();
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeDisabled();
  await page.locator('[data-mode="source"]').click();
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeDisabled();
  await page.locator('[data-mode="read"]').click();
  await expect(expand).toBeEnabled();

  // Flat note & empty Home state disable both buttons.
  await page.locator(".tab-label", { hasText: "Flat" }).click();
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeDisabled();
  while ((await page.locator(".tab-close").count()) > 0)
    await page.locator(".tab-close").first().click();
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeDisabled();
});

test("index view cycles level-by-level with child pages and two subfolder levels (lazy per click), keeps focus and reading position, and disables cleanly", async ({
  page,
}) => {
  await mountFoldDesk(page, {
    docs: [
      {
        id: "flat-idx",
        name: "SUMMARY.md",
        path: "C:/kb/flat/SUMMARY.md",
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
          "- [Folder Sub1](Sub1/)",
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
          { name: "Sub1", path: "C:/kb/Sub1", directory: true, id: "sub1" },
          {
            name: "Standalone.md",
            path: "C:/kb/Standalone.md",
            directory: false,
          },
        ],
      },
      sub1: {
        folder: { id: "sub1", name: "Sub1", path: "C:/kb/Sub1" },
        index: { name: "_目录.md", path: "C:/kb/Sub1/_目录.md" },
        text: "- [Sub1 Note](Sub1Note.md)\n- [Folder Sub2](Sub2/)\n",
        items: [
          {
            name: "_目录.md",
            path: "C:/kb/Sub1/_目录.md",
            directory: false,
            index: true,
          },
          {
            name: "Sub1Note.md",
            path: "C:/kb/Sub1/Sub1Note.md",
            directory: false,
          },
          {
            name: "Sub2",
            path: "C:/kb/Sub1/Sub2",
            directory: true,
            id: "sub2",
          },
        ],
      },
      sub2: {
        folder: { id: "sub2", name: "Sub2", path: "C:/kb/Sub1/Sub2" },
        index: { name: "_目录.md", path: "C:/kb/Sub1/Sub2/_目录.md" },
        text: "- [Deep Leaf](DeepLeaf.md)\n",
        items: [
          {
            name: "_目录.md",
            path: "C:/kb/Sub1/Sub2/_目录.md",
            directory: false,
            index: true,
          },
          {
            name: "DeepLeaf.md",
            path: "C:/kb/Sub1/Sub2/DeepLeaf.md",
            directory: false,
          },
        ],
      },
    },
  });

  const expand = page.locator("#outline-expand");
  const collapse = page.locator("#outline-collapse");
  const ix = (title) =>
    page.locator("#content .ix-item").filter({
      has: page.locator(`> .ix-row > .ix-title:text-is("${title}")`),
    });

  // Initial open: Level 1 open, Child A (L2) open, Folder Sub1's Level-2 nested Sub2 starts closed -> sub2 NOT loaded yet.
  await expect(page.locator("#content .ix-controls")).toHaveCount(0);
  await expect(ix("Child A")).toBeVisible();
  await expect(ix("Folder Sub2")).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => window.mock.expandCalls)).toEqual(["sub1"]);
  await expect(expand).toBeEnabled();
  await expect(collapse).toBeEnabled();

  // Click +1 at initial open -> opens Sub2 (lazily loads sub2) -> deepest level now open -> expand disabled, collapse enabled.
  await expand.click();
  await expect(ix("Deep Leaf")).toBeVisible();
  expect(await page.evaluate(() => window.mock.expandCalls)).toEqual([
    "sub1",
    "sub2",
  ]);
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeEnabled();

  // Click -1 -> collapses ONLY Level 2 (Child A & Folder Sub2), keeping Level 1 open!
  await collapse.click();
  await expect(ix("Topic One")).toHaveAttribute("aria-expanded", "true");
  await expect(ix("Folder Sub1")).toHaveAttribute("aria-expanded", "true");
  await expect(ix("Child A")).toHaveAttribute("aria-expanded", "false");
  await expect(ix("Folder Sub2")).toHaveAttribute("aria-expanded", "false");
  await expect(ix("Grandchild A1")).toBeHidden();
  await expect(ix("Deep Leaf")).toBeHidden();
  await expect(expand).toBeEnabled();
  await expect(collapse).toBeEnabled();

  // Click -1 again -> collapses Level 1 -> nothing open -> collapse disabled, expand enabled.
  await collapse.click();
  await expect(ix("Topic One")).toHaveAttribute("aria-expanded", "false");
  await expect(ix("Folder Sub1")).toHaveAttribute("aria-expanded", "false");
  await expect(ix("Child A")).toBeHidden();
  await expect(expand).toBeEnabled();
  await expect(collapse).toBeDisabled();

  // Step 1 (+1): opens ONLY Level 1 -> reveals Level 2 (Child A, Folder Sub2), keeping Level 3 hidden!
  await expand.click();
  await expect(ix("Topic One")).toHaveAttribute("aria-expanded", "true");
  await expect(ix("Child A")).toHaveAttribute("aria-expanded", "false");
  await expect(ix("Grandchild A1")).toBeHidden();
  await expect(ix("Folder Sub2")).toHaveAttribute("aria-expanded", "false");
  await expect(ix("Deep Leaf")).toBeHidden();
  await expect(expand).toBeEnabled();
  await expect(collapse).toBeEnabled();

  // Step 2 (+1): opens ONLY Level 2 -> reveals Grandchild A1 & Deep Leaf -> expand disabled.
  await expand.click();
  await expect(ix("Grandchild A1")).toBeVisible();
  await expect(ix("Deep Leaf")).toBeVisible();
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeEnabled();

  // Edit mode: roving tabindex & active focus move cleanly out of collapsed branches (both -1 step and Shift+click all).
  await page.locator('[data-mode="edit"]').click();
  await expect(collapse).toBeEnabled();
  await ix("Grandchild A1").locator(":scope > .ix-row").click();
  await collapse.click();
  await expect(ix("Grandchild A1")).toBeHidden();
  await expect(ix("Child A")).toBeVisible();
  await expect(
    page.locator('#content .ix-item[tabindex="0"] > .ix-row > .ix-title'),
  ).toHaveText("Child A");

  await collapse.click({ modifiers: ["Shift"] });
  await expect(ix("Child A")).toBeHidden();
  await expect(
    page.locator('#content .ix-item[tabindex="0"] > .ix-row > .ix-title'),
  ).toHaveText("Topic One");
  await expect(collapse).toBeDisabled();

  await page.keyboard.press("Alt+Shift+BracketRight");
  await expect(ix("Child A")).toBeVisible();
  await page.keyboard.press("Alt+Shift+BracketRight");
  await expect(ix("Grandchild A1")).toBeVisible();
  await ix("Grandchild A1").focus();
  await page.keyboard.press("Alt+Shift+BracketLeft");
  await expect(ix("Grandchild A1")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.activeElement?.closest(".ix-item")?.dataset.foldKey || "",
    ),
  ).toContain("child a.md");
  await page.keyboard.press("Alt+Shift+BracketLeft");
  await expect(ix("Child A")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.activeElement?.closest(".ix-item")?.dataset.foldKey || "",
    ),
  ).toContain("topic one");

  // Source mode & flat index disable both buttons.
  await page.locator('[data-mode="source"]').click();
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeDisabled();
  await page.locator(".tab-label", { hasText: "SUMMARY.md" }).click();
  await expect(page.locator("#content .ix-item")).toHaveCount(2);
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeDisabled();
});

test("generated root contents with > 300 rows at depth 3 refuses partial expansion and disables expand button with count tooltip", async ({
  page,
}) => {
  const level2Dirs = Array.from({ length: 10 }, (_, i) => `D${i + 1}`);
  const folders = {
    kb: {
      folder: { id: "kb", name: "kb", path: "C:/kb" },
      items: [
        { name: "TopA", path: "C:/kb/TopA", directory: true, id: "topa" },
        { name: "TopB", path: "C:/kb/TopB", directory: true, id: "topb" },
      ],
    },
    topa: {
      folder: { id: "topa", name: "TopA", path: "C:/kb/TopA" },
      items: [
        {
          name: "SmallD0",
          path: "C:/kb/TopA/SmallD0",
          directory: true,
          id: "d0",
        },
        ...level2Dirs.slice(0, 5).map((d) => ({
          name: d,
          path: `C:/kb/TopA/${d}`,
          directory: true,
          id: d.toLowerCase(),
        })),
      ],
    },
    topb: {
      folder: { id: "topb", name: "TopB", path: "C:/kb/TopB" },
      items: level2Dirs.slice(5).map((d) => ({
        name: d,
        path: `C:/kb/TopB/${d}`,
        directory: true,
        id: d.toLowerCase(),
      })),
    },
    d0: {
      folder: { id: "d0", name: "SmallD0", path: "C:/kb/TopA/SmallD0" },
      items: [
        {
          name: "Tiny1.md",
          path: "C:/kb/TopA/SmallD0/Tiny1.md",
          directory: false,
        },
        {
          name: "Tiny2.md",
          path: "C:/kb/TopA/SmallD0/Tiny2.md",
          directory: false,
        },
      ],
    },
    ...Object.fromEntries(
      level2Dirs.map((d) => [
        d.toLowerCase(),
        {
          folder: { id: d.toLowerCase(), name: d, path: `C:/kb/${d}` },
          items: Array.from({ length: 35 }, (_, j) => ({
            name: `${d}-Note-${j + 1}.md`,
            path: `C:/kb/${d}/${d}-Note-${j + 1}.md`,
            directory: false,
          })),
        },
      ]),
    ),
  };

  await mountFoldDesk(page, {
    folders,
    rootFolder: { id: "kb", name: "kb", path: "C:/kb" },
    settings: { sidebar: true, outline: true },
  });

  // Open generated root directory view from library root row's "打开目录" button.
  const rootSummary = page.locator("#tree details.folder.root > summary");
  await rootSummary.hover();
  await rootSummary.locator("> .folder-index-open").click();

  const expand = page.locator("#outline-expand");
  const collapse = page.locator("#outline-collapse");
  await expect(page.locator("#content .ix-item")).toHaveCount(13); // 2 Top + 1 SmallD0 + 10 D*
  await expect(expand).toBeEnabled();
  await expect(collapse).toBeEnabled();

  // Click +1 at level 2 (next level adds 2 + 10*35 = 352 > 300 rows):
  // nothing partially expands (SmallD0 also stays closed!), no toast loop,
  // expand button becomes disabled with exact reason tooltip while collapse stays enabled.
  await expand.click();
  await expect(page.locator("#toast")).toBeHidden();
  await expect(page.locator("#content .ix-item")).toHaveCount(13);
  await expect(expand).toBeDisabled();
  await expect(expand).toHaveAttribute(
    "title",
    "展开一层（下一层有 352 项，请到子目录里展开）",
  );
  await expect(collapse).toBeEnabled();

  // Alt+Shift+] is a clean no-op when next level is too large.
  await page.keyboard.press("Alt+Shift+BracketRight");
  await expect(page.locator("#content .ix-item")).toHaveCount(13);
  await expect(expand).toBeDisabled();

  // Clicking collapse folds back to Level 1 cleanly.
  await collapse.click();
  await expect(
    page.locator('#content .ix-item[aria-level="1"][aria-expanded="false"]'),
  ).toHaveCount(2);
  await expect(expand).toBeEnabled();
  await expect(expand).toHaveAttribute("title", "展开一层（Alt+Shift+]）");
  await expect(collapse).toBeDisabled();

  // Clicking expand opens Level 1 -> Level 2, keeps Level-3 items closed & hidden (no partial open),
  // and immediately disables expand again with the reason tooltip.
  await expand.click();
  await expect(page.locator("#content .ix-item:visible")).toHaveCount(13);
  await expect(
    page.locator("#content .ix-item").filter({
      has: page.locator('> .ix-row > .ix-title:text-is("SmallD0")'),
    }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(expand).toBeDisabled();
  await expect(expand).toHaveAttribute(
    "title",
    "展开一层（下一层有 352 项，请到子目录里展开）",
  );
  await expect(collapse).toBeEnabled();
});

test("generated root contents under 300 rows re-expands cleanly after folding to level 1", async ({
  page,
}) => {
  const mkNotes = (prefix, folderId, folderPath, count) =>
    Array.from({ length: count }, (_, i) => ({
      name: `${prefix}-${i + 1}.md`,
      path: `${folderPath}/${prefix}-${i + 1}.md`,
      directory: false,
      title: `${prefix} ${i + 1}`,
    }));
  const folders = {
    kb: {
      folder: { id: "kb", name: "kb", path: "C:/kb" },
      items: [
        { name: "FolderA", path: "C:/kb/FolderA", directory: true, id: "dirA" },
        { name: "FolderB", path: "C:/kb/FolderB", directory: true, id: "dirB" },
        { name: "Mixed", path: "C:/kb/Mixed", directory: true, id: "mixed" },
      ],
    },
    dirA: {
      folder: { id: "dirA", name: "FolderA", path: "C:/kb/FolderA" },
      items: mkNotes("A", "dirA", "C:/kb/FolderA", 35),
    },
    dirB: {
      folder: { id: "dirB", name: "FolderB", path: "C:/kb/FolderB" },
      items: mkNotes("B", "dirB", "C:/kb/FolderB", 35),
    },
    mixed: {
      folder: { id: "mixed", name: "Mixed", path: "C:/kb/Mixed" },
      index: { name: "_目录.md", path: "C:/kb/Mixed/_目录.md" },
      text: "- [M1](M1.md)\n  - [M2](M2.md)\n    - [M3](M3.md)\n",
      items: [
        {
          name: "_目录.md",
          path: "C:/kb/Mixed/_目录.md",
          directory: false,
          index: true,
        },
        {
          name: "M1.md",
          path: "C:/kb/Mixed/M1.md",
          directory: false,
          title: "M1",
        },
        {
          name: "M2.md",
          path: "C:/kb/Mixed/M2.md",
          directory: false,
          title: "M2",
        },
        {
          name: "M3.md",
          path: "C:/kb/Mixed/M3.md",
          directory: false,
          title: "M3",
        },
      ],
    },
  };

  await mountFoldDesk(page, {
    folders,
    rootFolder: { id: "kb", name: "kb", path: "C:/kb" },
    settings: { sidebar: true, outline: true },
  });

  const rootSummary = page.locator("#tree details.folder.root > summary");
  await rootSummary.hover();
  await rootSummary.locator("> .folder-index-open").click();

  const expand = page.locator("#outline-expand");
  const collapse = page.locator("#outline-collapse");
  await expect(page.locator("#content .ix-item:visible")).toHaveCount(74); // 3 top + 35 + 35 + M1
  await expect(expand).toBeEnabled();
  await expect(collapse).toBeEnabled();

  // Fold to level 1, then click expand: all 3 folders (71 level-2 rows) must re-open.
  await collapse.click();
  await expect(page.locator("#content .ix-item:visible")).toHaveCount(3);
  await expect(
    page.locator('#content .ix-item[aria-level="1"][aria-expanded="false"]'),
  ).toHaveCount(3);
  await expect(collapse).toBeDisabled();
  await expect(expand).toBeEnabled();

  await expand.click();
  await expect(page.locator("#content .ix-item:visible")).toHaveCount(74);
  await expect(
    page.locator('#content .ix-item[aria-level="1"][aria-expanded="true"]'),
  ).toHaveCount(3);
  await expect(collapse).toBeEnabled();
});

test("Alt+Shift+[ and Alt+Shift+] step one level when outline sidebar is hidden, respect disabled/deepest state, and honor English locale", async ({
  page,
}) => {
  await mountFoldDesk(page, {
    docs: [
      { id: "n1", name: "Study.md", path: "C:/kb/Study.md", text: sampleNote },
    ],
    settings: { outline: false, language: "en" },
  });

  // Hidden #outline-panel: Alt+Shift+] is a no-op at deepest level; Alt+Shift+[ folds one level per press; Alt+Shift+] opens one level per press.
  await expect(page.locator("#outline-panel")).toBeHidden();
  await page.keyboard.press("Alt+Shift+BracketRight");
  await expect(page.locator("#content .note-section.collapsed")).toHaveCount(0);

  await page.keyboard.press("Alt+Shift+BracketLeft");
  await expect(page.locator("#content > .note-section.collapsed")).toHaveCount(
    0,
  );
  await expect(
    page.locator("#content .note-section[data-level='3'].collapsed"),
  ).toHaveCount(2);

  await page.keyboard.press("Alt+Shift+BracketLeft");
  await expect(page.locator("#content > .note-section.collapsed")).toHaveCount(
    3,
  );
  await expect(page.locator("#content .note-section.collapsed")).toHaveCount(5);

  await page.keyboard.press("Alt+Shift+BracketRight");
  await expect(page.locator("#content > .note-section.collapsed")).toHaveCount(
    0,
  );
  await expect(
    page.locator("#content .note-section[data-level='3'].collapsed"),
  ).toHaveCount(2);

  await page.keyboard.press("Alt+Shift+BracketRight");
  await expect(page.locator("#content .note-section.collapsed")).toHaveCount(0);

  // Open #outline-panel in English locale -> English ARIA labels & tooltips match state.
  await page.locator("#outline-toggle").click();
  const expand = page.locator("#outline-expand");
  const collapse = page.locator("#outline-collapse");
  await expect(expand).toBeVisible();
  await expect(collapse).toBeVisible();
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeEnabled();
  await expect(expand).toHaveAttribute("aria-label", "Expand one level");
  await expect(expand).toHaveAttribute(
    "title",
    "Expand one level (Alt+Shift+])",
  );
  await expect(collapse).toHaveAttribute("aria-label", "Collapse one level");
  await expect(collapse).toHaveAttribute(
    "title",
    "Collapse one level (Alt+Shift+[; Shift+click collapses all)",
  );
  await collapse.click();
  await expect(expand).toBeEnabled();
  await expect(collapse).toBeEnabled();
  await collapse.click();
  await expect(expand).toBeEnabled();
  await expect(collapse).toBeDisabled();

  // Disabled in Edit mode of normal note.
  await page.locator('[data-mode="edit"]').click();
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeDisabled();
  await page.keyboard.press("Alt+Shift+BracketRight");
  await expect(expand).toBeDisabled();
});

for (const theme of ["light", "dark"]) {
  test(`capture outline level-toggle screenshots (${theme})`, async ({
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
          text: "# Contents\n\n- [Chapter 1](C1.md)\n  - [Lesson 1](L1.md)\n    - [Topic 1](T1.md)\n- [Chapter 2](C2.md)\n",
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
            { name: "T1.md", path: "C:/kb/T1.md", directory: false },
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

    const expand = page.locator("#outline-expand");
    const collapse = page.locator("#outline-collapse");
    // Normal note: collapse enabled, expand disabled -> after Shift+collapse: expand enabled, collapse disabled.
    await expect(expand).toBeDisabled();
    await expect(collapse).toBeEnabled();
    await page.screenshot({
      path: `.local/fold-shots/note-collapse-${theme}.png`,
    });
    await collapse.click({ modifiers: ["Shift"] });
    await expect(expand).toBeEnabled();
    await expect(collapse).toBeDisabled();
    await page.screenshot({
      path: `.local/fold-shots/note-expand-${theme}.png`,
    });

    // Index view: all 3 levels start open (expand disabled, collapse enabled) -> after Shift+collapse: expand enabled, collapse disabled.
    await page.locator(".tab-label", { hasText: "_目录.md" }).click();
    await expect(expand).toBeDisabled();
    await expect(collapse).toBeEnabled();
    await page.screenshot({
      path: `.local/fold-shots/index-collapse-${theme}.png`,
    });
    await collapse.click({ modifiers: ["Shift"] });
    await expect(expand).toBeEnabled();
    await expect(collapse).toBeDisabled();
    await page.screenshot({
      path: `.local/fold-shots/index-expand-${theme}.png`,
    });

    if (theme === "light") {
      await page.locator(".tab-label", { hasText: "Flat.md" }).click();
      await expect(expand).toBeDisabled();
      await expect(collapse).toBeDisabled();
      await page.screenshot({
        path: ".local/fold-shots/outline-disabled-light.png",
      });
    }
  });
}
