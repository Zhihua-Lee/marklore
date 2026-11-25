import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

const longParts = Array.from(
  { length: 16 },
  (_, i) =>
    `## Section ${i + 1}\n\nParagraph content ${i + 1} with mathematical expression $x_${i} + y_${i} = 1$ and steady dense prose across lines.`,
).join("\n\n");

test("link preview gives >= 75% content share, omits redundant local status, and tracks fluid size + preview zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await installFolio(page);
  await page.addInitScript((otherText) => {
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          {
            id: "main",
            name: "Main.md",
            path: "C:/notes/Main.md",
            version: "1",
            text: "# Main\n\nSee [Other](Other.md).\n",
          },
        ],
        roots: [],
        restored: [],
        settings: { sidebar: false, outline: false },
      }),
      preview: async () => ({
        id: "other",
        name: "Other.md",
        path: "C:/notes/subfolder/Other.md",
      }),
      read: async (id, version) =>
        version
          ? { unchanged: true }
          : {
              id: "other",
              name: "Other.md",
              path: "C:/notes/subfolder/Other.md",
              text: otherText,
              version: "1",
            },
    });
  }, "# Other Note\n\n" + longParts);

  await page.goto("/");
  await page.getByRole("link", { name: "Other", exact: true }).hover();
  const card = page.locator("#link-preview");
  await expect(card).toBeVisible();
  await expect(card.locator(".preview-scroll")).toContainText("Section 1");
  await expect(card.locator(".preview-status")).toBeHidden();

  const share = await page.evaluate(() => {
    const c = document.querySelector("#link-preview").getBoundingClientRect();
    const s = document.querySelector(".preview-scroll").getBoundingClientRect();
    return {
      areaShare: (s.width * s.height) / (c.width * c.height),
      proseSize1366: parseFloat(
        getComputedStyle(document.querySelector("#link-preview .prose"))
          .fontSize,
      ),
    };
  });
  expect(share.areaShare).toBeGreaterThanOrEqual(0.75);
  expect(share.proseSize1366).toBeCloseTo(16, 1);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("link", { name: "Other", exact: true }).hover();
  await expect(card).toBeVisible();
  const at1920 = await page.evaluate(() =>
    parseFloat(
      getComputedStyle(document.querySelector("#link-preview .prose")).fontSize,
    ),
  );
  expect(at1920).toBeCloseTo(16 * 1.09, 2);

  await card.locator('.preview-zoom button[data-zoom="10"]').click();
  const zoomed = await page.evaluate(() =>
    parseFloat(
      getComputedStyle(document.querySelector("#link-preview .prose")).fontSize,
    ),
  );
  expect(zoomed).toBeCloseTo(16 * 1.09 * 1.1, 1);
});

test("tab preview gives >= 75% page area, truncated single-line path, and no blank top", async ({
  page,
}) => {
  await installFolio(page);
  await page.addInitScript((otherText) => {
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          {
            id: "other",
            name: "VeryLongTabNameForHoverCardVerification.md",
            path: "C:/notes/deeply/nested/workspace/folder/structure/VeryLongTabNameForHoverCardVerification.md",
            version: "1",
            text: otherText,
          },
          {
            id: "active",
            name: "Active.md",
            path: "C:/notes/Active.md",
            version: "1",
            text: "# Active\n\nHere.\n",
          },
        ],
        roots: [],
        restored: [],
        settings: { sidebar: false, outline: false },
      }),
    });
  }, "# Long\n\n" + longParts);

  await page.goto("/");
  await page
    .getByRole("tab", {
      name: "VeryLongTabNameForHoverCardVerification.md",
      exact: true,
    })
    .hover();
  const card = page.locator("#tab-preview");
  await expect(card).toBeVisible();

  const metrics = await page.evaluate(() => {
    const c = document.querySelector("#tab-preview").getBoundingClientRect();
    const p = document
      .querySelector(".tab-preview-page")
      .getBoundingClientRect();
    const pathEl = document.querySelector(".tab-preview-path");
    const pathRect = pathEl.getBoundingClientRect();
    const first = document.querySelector("#tab-preview .prose > :first-child");
    return {
      areaShare: (p.width * p.height) / (c.width * c.height),
      pathHeight: pathRect.height,
      pathWhiteSpace: getComputedStyle(pathEl).whiteSpace,
      firstMarginTop: parseFloat(getComputedStyle(first).marginTop),
    };
  });
  expect(metrics.areaShare).toBeGreaterThanOrEqual(0.75);
  expect(metrics.pathHeight).toBeLessThanOrEqual(20);
  expect(metrics.pathWhiteSpace).toBe("nowrap");
  expect(metrics.firstMarginTop).toBe(0);
});

test("dense tree/outline/code heights and single-line .name-mark on long note names", async ({
  page,
}) => {
  await installFolio(page);
  await page.addInitScript(() => {
    const longTitle =
      "超长笔记标题用来测试侧边栏窄栏情况下重命名圆点标记会不会掉到第二行显示";
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          {
            id: "n1",
            name: "short_file_name.md",
            path: "C:/kb/short_file_name.md",
            version: "1",
            text: `# ${longTitle}\n\n## Sec 1\n\nText.\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n\n## Sec 2\n\nText.\n`,
          },
        ],
        restored: [],
        roots: [{ id: "r1", name: "KB", path: "C:/kb" }],
        settings: { sidebar: true, outline: true },
      }),
      list: async () => [
        {
          id: "f1",
          name: "Folder One",
          path: "C:/kb/Folder One",
          parent: "r1",
          directory: true,
        },
        {
          name: "short_file_name.md",
          path: "C:/kb/short_file_name.md",
          parent: "r1",
          directory: false,
          title: longTitle,
          heading: longTitle,
        },
      ],
    });
  });

  await page.goto("/");
  await expect(page.locator("#tree .file .name-mark")).toBeVisible();

  const density = await page.evaluate(() => {
    const folder = document
      .querySelector("#tree details.folder > summary")
      .getBoundingClientRect();
    const file = document.querySelector("#tree .file").getBoundingClientRect();
    const title = document
      .querySelector("#tree .file .file-title")
      .getBoundingClientRect();
    const mark = document
      .querySelector("#tree .file .name-mark")
      .getBoundingClientRect();
    const outlineBtn = document
      .querySelector("#outline button")
      .getBoundingClientRect();
    const codeHead = document
      .querySelector("#content .code-toolbar")
      .getBoundingClientRect();
    return {
      folderHeight: folder.height,
      fileHeight: file.height,
      markCenterDelta: Math.abs(
        mark.top + mark.height / 2 - (title.top + title.height / 2),
      ),
      markSameLineAsFile: mark.top >= file.top && mark.bottom <= file.bottom,
      outlineHeight: outlineBtn.height,
      codeHeaderHeight: codeHead.height,
    };
  });

  expect(density.folderHeight).toBeLessThanOrEqual(27);
  expect(density.fileHeight).toBeLessThanOrEqual(27);
  expect(density.markSameLineAsFile).toBe(true);
  expect(density.markCenterDelta).toBeLessThanOrEqual(3);
  expect(density.outlineHeight).toBeLessThanOrEqual(29);
  expect(density.codeHeaderHeight).toBeGreaterThanOrEqual(33);
  expect(density.codeHeaderHeight).toBeLessThanOrEqual(37);

  await page.locator("#weight").click();
  await page.locator("#reading-style").selectOption("compact");
  await page.locator("#appearance-close").click();
  const compactCodeHeight = await page
    .locator("#content .code-toolbar")
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(compactCodeHeight).toBeGreaterThanOrEqual(25);
  expect(compactCodeHeight).toBeLessThanOrEqual(28);
});
