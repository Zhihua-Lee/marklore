import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";
import { boot, editor, saved } from "./rich-helpers.js";
import { picture, shot } from "./image-layout-helpers.js";

// An image nobody sized (src/image-layout.css, src/image-density.js): at
// its own size, its recorded density taken into account, never wider than
// the column nor taller than most of the window, never enlarged. A width
// given in the note wins.

const tall = picture(300, 2400, [150, 160, 170]);
const wide = picture(2400, 300, [170, 160, 150]);
const tiny = picture(16, 16, [120, 140, 130]);
const retina = picture(800, 400, [143, 170, 156], 144);
const tinyRetina = picture(32, 32, [140, 120, 130], 144);
const note = [
  "# Sizes",
  `![Tall](${tall})`,
  `![Wide](${wide})`,
  `![Tiny](${tiny})`,
  `![Retina](${retina})`,
  `![Tiny retina](${tinyRetina})`,
  `<img src="${tall}" alt="Sized" width="20%">`,
  "End.",
].join("\n\n");

async function reading(page) {
  await installFolio(page);
  await page.addInitScript((text) => {
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          {
            id: "n",
            name: "Sizes.md",
            path: "C:/synthetic/Sizes.md",
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
  }, note + "\n");
  await page.goto("/");
  await expect(page.locator('#content img[alt="Sized"]')).toBeVisible();
}
const sizes = (page, root) =>
  page.locator(root).evaluate(async (host) => {
    const images = [
      ...host.querySelectorAll("img:not(.ProseMirror-separator)"),
    ];
    await Promise.all(images.map((img) => img.decode().catch(() => {})));
    await new Promise(requestAnimationFrame);
    return Object.fromEntries(
      images.map((img) => {
        const r = img.getBoundingClientRect();
        return [
          img.alt,
          {
            width: Math.round(r.width),
            height: Math.round(r.height),
            column: Math.round(img.parentElement.clientWidth),
          },
        ];
      }),
    );
  });
function checked(s, viewport) {
  const cap = Math.min(viewport * 0.7, 600);
  // Tall: no taller than the cap, its proportions kept.
  expect(s.Tall.height).toBeLessThanOrEqual(Math.ceil(cap));
  expect(s.Tall.width / s.Tall.height).toBeCloseTo(300 / 2400, 2);
  // Wide: no wider than the column.
  expect(s.Wide.width).toBeLessThanOrEqual(s.Wide.column);
  expect(s.Wide.width / s.Wide.height).toBeCloseTo(8, 0);
  // Tiny: not enlarged.
  expect(s.Tiny.width).toBe(16);
  // 144 dpi: half its pixels; but an icon is not made smaller than 48px.
  expect(s.Retina.width).toBe(400);
  expect(s["Tiny retina"].width).toBe(32);
  // A width in the note wins over the cap.
  expect(s.Sized.width / s.Sized.column).toBeCloseTo(0.2, 1);
  expect(s.Sized.height).toBeGreaterThan(cap);
}

test("an image nobody sized keeps to the default range and its density", async ({
  page,
}) => {
  await reading(page);
  checked(await sizes(page, "#content"), 900);
  await shot(page, "defaults", '#content img[alt="Retina"]');
});

test("the editor sizes them alike, and the original size returns to it", async ({
  page,
}) => {
  await boot(page, note + "\n");
  checked(await sizes(page, "#rich"), 900);
  // Resized, then given back its original size: the range applies again.
  await editor(page).locator('img[alt="Tall"]').click();
  const handle = page.locator('.rich-image-handle[data-side="right"]');
  const at = await handle.boundingBox();
  await page.mouse.move(at.x + 4, at.y + 4);
  await page.mouse.down();
  await page.mouse.move(at.x + 200, at.y + 4, { steps: 5 });
  await page.mouse.up();
  expect(await saved(page)).toMatch(/<img src="data:[^"]+" alt="Tall" width/);
  await page
    .locator(".rich-image-box")
    .getByRole("button", { name: "原始大小" })
    .click();
  expect(await saved(page)).toBe(note + "\n");
  const s = await sizes(page, "#rich");
  expect(s.Tall.height).toBeLessThanOrEqual(600);
});

test("an export keeps the size a density gave", async ({ page }) => {
  await reading(page);
  await page.evaluate(async (text) => {
    const { exportNote } = await import("/src/export.js");
    await exportNote("html", { doc: { text, name: "Sizes.md", fileId: null } });
  }, note);
  const { html } = await page.evaluate(() => window.captured);
  expect(html).not.toContain("srcset");
  expect(html).toMatch(/alt="Retina" style="width: 400px;"/);
  expect(html).toMatch(/alt="Tiny retina">/);
});
