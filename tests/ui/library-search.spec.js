import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// The library search box finds notes by file name and by their text; a text
// hit opens the note at that line with the word marked by the find bar.
async function setup(page, { sidebar = true, roots = true } = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ sidebar, roots }) => {
      const lines = ["# Fourier", "", "## Intro", "", "first FFT line", ""];
      while (lines.length < 59)
        lines.push(`Filler paragraph ${lines.length}.`, "");
      lines.push("second FFT here", "");
      const text = lines.join("\n");
      window.calls = { searchText: [], openFromLibrary: [] };
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [],
          restored: [],
          roots: roots ? [{ id: "root", name: "kb", path: "C:/kb" }] : [],
          settings: { sidebar },
        }),
        list: async () => [
          { name: "Fourier.md", path: "C:/kb/Fourier.md", directory: false },
        ],
        search: async () => ({
          items: [
            {
              name: "FFT notes.md",
              path: "C:/kb/FFT notes.md",
              parent: "root",
            },
          ],
          truncated: false,
        }),
        searchText: async (query) => {
          window.calls.searchText.push(query);
          return {
            terms: ["fft"],
            total: 1,
            results: [
              {
                path: "C:/kb/Fourier.md",
                name: "Fourier.md",
                nameHit: false,
                count: 2,
                hits: [
                  {
                    line: 5,
                    column: 7,
                    section: "Intro",
                    heading: false,
                    snippet: [
                      ["first ", false],
                      ["FFT", true],
                      [" line $x^2$", false],
                    ],
                  },
                  {
                    line: 61,
                    column: 8,
                    section: "Intro",
                    heading: false,
                    snippet: [
                      ["second ", false],
                      ["FFT", true],
                      [" here", false],
                    ],
                  },
                ],
              },
            ],
          };
        },
        openFromLibrary: async (path) => {
          window.calls.openFromLibrary.push(path);
          return { id: "f", name: "Fourier.md", path, text, version: "1" };
        },
      });
    },
    { sidebar, roots },
  );
  await page.goto("/");
}

test("search lists file names and text hits; a hit opens at its line, marked", async ({
  page,
}) => {
  await setup(page);
  await page.locator("#file-filter").fill("fft");
  const tree = page.locator("#tree");
  await expect(tree.locator(".search-group")).toHaveText(["文件名", "内容"]);
  await expect(
    tree.getByRole("button", { name: "FFT notes.md" }),
  ).toBeVisible();
  const hits = tree.locator(".text-hit");
  await expect(hits).toHaveCount(2);
  await expect(hits.first().locator("mark")).toHaveText("FFT");
  await expect(hits.first().locator(".text-hit-section")).toHaveText("Intro");
  await expect(tree.locator(".text-note-count")).toHaveText("2");
  await expect(tree.locator(".search-info").last()).toHaveText("共 1 篇笔记");
  // A line with a formula is typeset, the hit still marked.
  await expect(hits.first().locator(".katex")).toHaveCount(1);
  await expect(hits.first().locator("mark")).toHaveText("FFT");
  // A hit inside a formula marks the whole formula; other text is escaped.
  const markdown = await page.evaluate(async () => {
    const { snippetMarkdown } = await import("/src/library.js");
    return snippetMarkdown([
      ["a*b ", false],
      ["$x", false],
      ["^2", true],
      ["$", false],
    ]);
  });
  expect(markdown).toBe("a\\*b <mark>$x^2$</mark>");
  expect(await page.evaluate(() => window.calls.searchText)).toEqual(["fft"]);

  await hits.nth(1).click();
  await expect(page.locator(".tab.active")).toContainText("Fourier.md");
  expect(await page.evaluate(() => window.calls.openFromLibrary)).toEqual([
    "C:/kb/Fourier.md",
  ]);
  const bar = page.locator("#find-bar");
  await expect(bar).toBeVisible();
  await expect(bar.locator("input")).toHaveValue("fft");
  // The occurrence at the clicked line is the current one, and in view.
  await expect(bar.locator(".find-count")).toHaveText("2/2");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const range = [...CSS.highlights.get("folio-find-current")][0];
        const box = range.getBoundingClientRect(),
          reader = document.querySelector("#reader").getBoundingClientRect();
        return (
          range.startContainer.parentElement.textContent.includes("second") &&
          box.top >= reader.top &&
          box.bottom <= reader.bottom
        );
      }),
    )
    .toBe(true);
  // Enter steps on through the note, as with Ctrl+F.
  await bar.locator("input").press("Enter");
  await expect(bar.locator(".find-count")).toHaveText("1/2");
});

test("Ctrl+Shift+F opens the library and focuses search; without folders it explains", async ({
  page,
}) => {
  await setup(page, { sidebar: false, roots: false });
  await expect(page.locator("#sidebar")).toBeHidden();
  await page.keyboard.press("Control+Shift+F");
  await expect(page.locator("#sidebar")).toBeVisible();
  await expect(page.locator("#file-filter")).toBeFocused();
  // No library folder: the box still works, and says how to search text.
  await page.locator("#file-filter").fill("fft");
  await expect(page.locator("#tree .search-info").last()).toHaveText(
    "用“打开文件夹”加入笔记库后，可以搜索笔记内容",
  );
  expect(await page.evaluate(() => window.calls.searchText)).toEqual([]);
});
