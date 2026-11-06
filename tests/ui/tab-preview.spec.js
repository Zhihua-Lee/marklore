import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Resting the pointer on a tab shows a card under it: the full name, the
// file's place and, for another tab, the note where it was left. The card is
// passive: switching, closing or dragging tabs works as before.
const parts = Array.from(
  { length: 60 },
  (_, i) =>
    `## Part ${i + 1}\n\nText of part ${i + 1}, long enough to fill a line or two of the note.`,
);
const files = [
  {
    id: "long",
    path: "C:/notes/A rather long note name that a tab cannot show in full.md",
    name: "A rather long note name that a tab cannot show in full.md",
    text: "# Long\n\n" + parts.join("\n\n") + "\n",
    version: "v1",
  },
  {
    id: "short",
    path: "C:/notes/Short.md",
    name: "Short.md",
    text: "# Short\n\nOnly a line.\n",
    version: "v1",
  },
];

async function boot(page) {
  await installFolio(page);
  await page.addInitScript((files) => {
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: files,
        roots: [],
        restored: [],
        settings: { sidebar: false, outline: false },
      }),
    });
  }, files);
  await page.goto("/");
  await expect(page.locator("#tabs .tab")).toHaveCount(2);
}
const tab = (page, name) => page.getByRole("tab", { name, exact: true });
const card = (page) => page.locator("#tab-preview");

test("a tab shows its full name and the note where it was left", async ({
  page,
}) => {
  await boot(page);
  const long = tab(page, files[0].name);
  // Read the long note down to part 40, then go to the other tab.
  await long.click();
  await expect(page.locator("#content h1")).toContainText("Long");
  await page
    .locator("#content h2#part-40")
    .evaluate((h) => h.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(300);
  await tab(page, "Short.md").click();
  await expect(page.locator("#content h1")).toContainText("Short");
  await expect(card(page)).toBeHidden();

  await long.hover();
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator(".tab-preview-name")).toHaveText(
    files[0].name,
  );
  await expect(card(page).locator(".tab-preview-path")).toHaveText(
    files[0].path,
  );
  const preview = card(page).locator(".tab-preview-page");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Part 40");
  // It starts where the note was left, not at its top.
  await expect(preview.locator("h2").first()).toContainText(/Part (39|40)/);
  await expect(preview.locator("h1")).toHaveCount(0);
  // The card hangs under its tab and takes no pointer.
  const [t, c] = [await long.boundingBox(), await card(page).boundingBox()];
  expect(c.y).toBeGreaterThan(t.y + t.height - 1);
  expect(
    await card(page).evaluate((el) => getComputedStyle(el).pointerEvents),
  ).toBe("none");
  // Hovering changed nothing: the current tab and its page stay.
  await expect(tab(page, "Short.md")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#content h1")).toContainText("Short");

  // Along the tabs the card follows at once; the current tab shows no page.
  await tab(page, "Short.md").hover();
  await expect(card(page).locator(".tab-preview-name")).toHaveText("Short.md", {
    timeout: 300,
  });
  await expect(card(page).locator(".tab-preview-page")).toBeHidden();

  // A press switches tabs as before and puts the card away.
  await long.hover();
  await expect(card(page).locator(".tab-preview-name")).toHaveText(
    files[0].name,
  );
  await long.click();
  await expect(card(page)).toBeHidden();
  await expect(long).toHaveAttribute("aria-selected", "true");
  // Leaving the tab bar puts it away too.
  await tab(page, "Short.md").hover();
  await expect(card(page)).toBeVisible();
  await page.locator("#content").hover();
  await expect(card(page)).toBeHidden();
});

test("passing over the tabs opens no card", async ({ page }) => {
  await boot(page);
  const box = await tab(page, "Short.md").boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.move(box.x + 5, box.y + box.height + 200, { steps: 2 });
  await page.waitForTimeout(600);
  await expect(card(page)).toBeHidden();
});
