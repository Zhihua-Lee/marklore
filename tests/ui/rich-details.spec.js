import { test, expect } from "@playwright/test";
import { boot, editor, saved, caretAfter } from "./rich-helpers.js";

// <details> folds: drawn folded (as when read), the summary and the body
// edited in place, the tags written back as they were.

const note =
  "Before.\n\n" +
  '<details>\n<summary>Deduction <span style="color:#b42318">−0.5</span></summary>\n\n' +
  "Inside the fold.\n\n- item one\n\n</details>\n\n" +
  "<details open><summary>Open one</summary>\n\nShown.\n\n</details>\n\n" +
  "After.\n";

test("a fold is drawn folded, opens on its marker, and keeps its tags", async ({
  page,
}) => {
  await boot(page, note);
  const first = editor(page).locator(".rich-details").first();
  await expect(first.locator(".rich-summary")).toHaveText("Deduction −0.5");
  await expect(first.locator(".rich-summary span.rich-html")).toHaveCSS(
    "color",
    "rgb(180, 35, 24)",
  );
  await expect(first.getByText("Inside the fold.")).toBeHidden();
  // Written <details open>: shown open.
  await expect(editor(page).getByText("Shown.")).toBeVisible();
  // The marker opens it; nothing in the note changes.
  const box = await first.locator(".rich-summary").boundingBox();
  await page.mouse.click(box.x - 10, box.y + box.height / 2);
  await expect(first.getByText("Inside the fold.")).toBeVisible();
  expect(await saved(page)).toBe(note);
});

test("typing in a fold's summary and body", async ({ page }) => {
  await boot(page, note);
  await caretAfter(page, "Deduction");
  await page.keyboard.type(" (2.1)");
  // Down from the summary goes into the body, which opens.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.type(" More.");
  await expect(editor(page).getByText("Inside the fold. More.")).toBeVisible();
  expect(await saved(page)).toBe(
    note
      .replace("Deduction <span", "Deduction (2.1) <span")
      .replace("Inside the fold.", "Inside the fold. More."),
  );
});
