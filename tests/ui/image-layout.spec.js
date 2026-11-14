import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";
import { boot, editor, saved } from "./rich-helpers.js";
import { sage, sand, slate, shot } from "./image-layout-helpers.js";

// Image size, alignment and rows (src/image-layout.js): each stored form
// reads, edits and exports as laid out, and an image nobody resized stays
// `![alt](src)`.

const forms = [
  "# Layout",
  `![Plain](${sage})`,
  `<img src="${sand}" alt="Resized" width="30%">`,
  `<p align="left"><img src="${slate}" alt="Left" width="20%"></p>`,
  `<p align="right"><img src="${slate}" alt="Right" width="20%"></p>`,
  `<img src="${sage}" alt="Row A" width="49%"> <img src="${sand}" alt="Row B" width="49%">`,
  [
    '<div class="columns">',
    '<div class="column" data-width="60%">',
    "",
    "Text **beside** an image, with $x^2$.",
    "",
    "</div>",
    '<div class="column" data-width="40%">',
    "",
    `![Column](${slate})`,
    "",
    "</div>",
    "</div>",
  ].join("\n"),
  "End.",
];
const note = forms.join("\n\n") + "\n";

async function reading(page, text = note) {
  await installFolio(page);
  await page.addInitScript((text) => {
    window.captured = null;
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          {
            id: "n",
            name: "Layout.md",
            path: "C:/synthetic/Layout.md",
            version: "v1",
            text,
          },
        ],
        restored: [],
        roots: [],
        settings: { sidebar: false, outline: false },
      }),
      exportNote: async (payload) => {
        window.captured = payload;
        return { canceled: true };
      },
    });
  }, text);
  await page.goto("/");
  await expect(page.locator("#content .katex").first()).toBeVisible();
}
// Where each image is, by its description.
const boxes = (page, root) =>
  page.locator(root).evaluate((host) =>
    Object.fromEntries(
      [...host.querySelectorAll("img")].map((img) => {
        const r = img.getBoundingClientRect();
        const p = img.closest("p, .column").getBoundingClientRect();
        return [
          img.alt,
          {
            left: Math.round(r.left - p.left),
            right: Math.round(p.right - r.right),
            top: Math.round(r.top),
            width: Math.round(r.width),
            column: Math.round(p.width),
          },
        ];
      }),
    ),
  );
function laidOut(b) {
  // Centred at its own size; a share of the column; to one side.
  expect(Math.abs(b.Plain.left - b.Plain.right)).toBeLessThan(2);
  expect(b.Resized.width / b.Resized.column).toBeCloseTo(0.3, 1);
  expect(Math.abs(b.Resized.left - b.Resized.right)).toBeLessThan(2);
  expect(Math.abs(b.Left.left)).toBe(0);
  expect(Math.abs(b.Right.right)).toBe(0);
  // Side by side.
  expect(b["Row A"].top).toBe(b["Row B"].top);
  expect(b["Row A"].width / b["Row A"].column).toBeCloseTo(0.49, 1);
}

test("each stored form renders as laid out in the reading view", async ({
  page,
}) => {
  await reading(page);
  const b = await boxes(page, "#content");
  laidOut(b);
  // Text in one column, the image in the other.
  const column = await page.locator("#content .columns").evaluate((el) => {
    const [a, b] = [...el.children].map((c) => c.getBoundingClientRect());
    return { side: a.right <= b.left, share: a.width / (a.width + b.width) };
  });
  expect(column.side).toBe(true);
  expect(column.share).toBeCloseTo(0.6, 1);
  await shot(page, "reading", "#content .image-row");
});

test("rows and columns stack when the window is narrow", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await reading(page);
  const b = await boxes(page, "#content");
  expect(b["Row B"].top).toBeGreaterThan(b["Row A"].top);
  const stacked = await page.locator("#content .columns").evaluate((el) => {
    const [a, b] = [...el.children].map((c) => c.getBoundingClientRect());
    return b.top >= a.bottom - 1;
  });
  expect(stacked).toBe(true);
  await shot(page, "narrow", "#content .columns");
});

test("the editor shows each form as the reading view does", async ({
  page,
}) => {
  await boot(page, note);
  await expect(editor(page).locator(".columns .katex")).toBeVisible();
  laidOut(await boxes(page, "#rich"));
  await shot(page, "editor", "#rich .image-row");
  // Typing elsewhere: every image keeps its form, the plain one its Markdown.
  await editor(page).getByText("End.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" More.");
  expect(await saved(page)).toBe(note.replace("End.", "End. More."));
});

test("an export keeps sizes, alignment, rows and columns", async ({ page }) => {
  await reading(page);
  await page.evaluate(async (text) => {
    const { exportNote } = await import("/src/export.js");
    await exportNote("html", {
      doc: { text, name: "Layout.md", fileId: null },
    });
  }, note);
  const { html, css } = await page.evaluate(() => window.captured);
  expect(html).toContain('class="image-line image-align-right"');
  expect(html).toMatch(
    /<p class="image-row"><img src="data:[^"]+" alt="Row A" width="49%">/,
  );
  expect(html).toContain('<div class="column" style="--share: 60">');
  expect(html).toContain('width="30%"');
  expect(css).toContain(".image-row");
  expect(css).toContain("@container columns");
});

test("copying across a row gives its stored form", async ({ page }) => {
  await reading(page);
  const text = await page.evaluate(async () => {
    const content = document.querySelector("#content");
    const blocks = [...content.querySelectorAll("p")];
    const row = content.querySelector(".image-row");
    const before = blocks[blocks.indexOf(row) - 1];
    const range = document.createRange();
    range.setStartBefore(before);
    range.setEndAfter(row.nextElementSibling);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const data = new DataTransfer();
    content.dispatchEvent(
      new ClipboardEvent("copy", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    return data.getData("text/plain");
  });
  expect(text).toContain(forms[5]);
  expect(text).toContain('<div class="columns">');
});
