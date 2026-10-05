import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// The library search box: one list of notes found by name or text, the words
// marked; a hit opens the note at that line with the word marked there.
async function setup(
  page,
  { sidebar = true, roots = true, outside = false } = {},
) {
  await installFolio(page);
  await page.addInitScript(
    ({ sidebar, roots, outside }) => {
      const lines = ["# Fourier", "", "## Intro", "", "first FFT line", ""];
      while (lines.length < 59)
        lines.push(`Filler paragraph ${lines.length}.`, "");
      lines.push("second FFT here", "");
      const text = lines.join("\n");
      const other = {
        id: "o",
        name: "Other.md",
        path: "D:/other/Other.md",
        text: "# Other\n",
        version: "1",
      };
      window.calls = { searchText: [], search: [], openFromLibrary: [] };
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: outside ? [other] : [],
          restored: [],
          roots: roots ? [{ id: "root", name: "kb", path: "C:/kb" }] : [],
          settings: { sidebar },
        }),
        list: async () => [],
        currentFolder: async () => ({
          id: "other",
          name: "other",
          path: "D:/other",
        }),
        search: async (ids, query) => {
          window.calls.search.push([ids, query]);
          return {
            items: [
              {
                name: "FFT outside.md",
                path: "D:/other/FFT outside.md",
                parent: "other",
              },
            ],
            truncated: false,
          };
        },
        searchText: async (query) => {
          window.calls.searchText.push(query);
          return {
            terms: ["fft"],
            total: 2,
            results: [
              {
                path: "C:/kb/FFT notes.md",
                name: "FFT notes.md",
                nameHit: true,
                count: 0,
                hits: [],
              },
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
          return path.endsWith("Fourier.md")
            ? { id: "f", name: "Fourier.md", path, text, version: "1" }
            : {
                id: "n",
                name: "FFT notes.md",
                path,
                text: "# FFT notes\n",
                version: "1",
              };
        },
      });
    },
    { sidebar, roots, outside },
  );
  await page.goto("/");
}

test("one list of notes by name and text; a hit opens at its line, marked", async ({
  page,
}) => {
  await setup(page);
  const filter = page.locator("#file-filter");
  await filter.fill("fft");
  const tree = page.locator("#tree");
  const notes = tree.locator(".text-note");
  await expect(notes).toHaveCount(2);
  // Names are marked too; the note found by name comes first.
  await expect(notes.first().locator(".text-note-title mark")).toHaveText(
    "FFT",
  );
  const hits = tree.locator(".text-hit");
  await expect(hits).toHaveCount(2);
  await expect(hits.first().locator("mark")).toHaveText("FFT");
  await expect(hits.first().locator(".text-hit-section")).toHaveText("Intro");
  await expect(notes.nth(1).locator(".text-note-count")).toHaveText("2");
  await expect(tree.locator(".search-info")).toHaveText("共 2 篇笔记");
  // A formula in a line is typeset, the hit still marked.
  await expect(hits.first().locator(".katex")).toHaveCount(1);
  // The library index answers; no folder outside it, so no disk walk.
  expect(await page.evaluate(() => window.calls.search)).toEqual([]);
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
  // The results stay for the next one, with the open note marked.
  await expect(filter).toHaveValue("fft");
  await expect(notes).toHaveCount(2);
  await expect(notes.nth(1).locator(".text-note-name")).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Enter steps on through the note, as with Ctrl+F.
  await bar.locator("input").press("Enter");
  await expect(bar.locator(".find-count")).toHaveText("1/2");

  // Keyboard: ↓ from the box into the results, Enter in the box opens the first.
  await filter.focus();
  await filter.press("ArrowDown");
  await expect(notes.first().locator(".text-note-name")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(notes.nth(1).locator(".text-note-name")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(filter).toBeFocused();
  await filter.press("Enter");
  await expect(page.locator(".tab.active")).toContainText("FFT notes.md");
});

test("names in a folder outside the library are searched on disk and appended", async ({
  page,
}) => {
  await setup(page, { outside: true });
  await expect(page.locator(".tab.active")).toContainText("Other.md");
  await page.locator("#file-filter").fill("fft");
  const notes = page.locator("#tree .text-note");
  await expect(notes).toHaveCount(3);
  await expect(notes.nth(2).locator(".text-note-title")).toHaveText(
    "FFT outside.md",
  );
  await expect(notes.nth(2).locator("mark")).toHaveText("FFT");
  await expect(page.locator("#tree .search-info")).toHaveText("共 3 篇笔记");
  expect(await page.evaluate(() => window.calls.search)).toEqual([
    [["other"], "fft"],
  ]);
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
  await expect(page.locator("#tree .search-info").first()).toHaveText(
    "用“打开文件夹”加入笔记库后，可以搜索笔记内容",
  );
  expect(await page.evaluate(() => window.calls.searchText)).toEqual([]);
});
