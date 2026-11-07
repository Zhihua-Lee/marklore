import { test, expect } from "@playwright/test";
import { boot, editor, saved, caretAfter } from "./rich-helpers.js";

// Inline HTML pairs (colored text, <mark>, <u>, <sub>...) show as the
// reading view shows them and take typing; their tags stay as written.

const note =
  'Score: <span style="color:#b42318;font-weight:600">minus half</span> here.\n\n' +
  "Some <mark>marked</mark> and <u>under</u> and H<sub>2</sub>O.\n\n" +
  '<a id="problem-3"></a>\n\n' +
  'See <a id="here"></a>this.\n';

test("colored and marked text is drawn, not shown as tags", async ({
  page,
}) => {
  await boot(page, note);
  const red = editor(page).locator("span.rich-html", { hasText: "minus half" });
  await expect(red).toHaveCSS("color", "rgb(180, 35, 24)");
  await expect(red).toHaveCSS("font-weight", "600");
  await expect(editor(page).locator("mark")).toHaveText("marked");
  await expect(editor(page).locator("u")).toHaveText("under");
  await expect(editor(page).locator("sub")).toHaveText("2");
  await expect(editor(page).locator(".raw-inline[data-kind=html]")).toHaveCount(
    0,
  );
  // An anchor is one small mark, its name on hover.
  await expect(
    editor(page).locator(".raw-inline[data-kind=anchor]").last(),
  ).toHaveAttribute("title", /here/);
  await expect(
    editor(page).locator(".raw-inline[data-kind=anchor]"),
  ).toHaveCount(2);
  expect(await saved(page)).toBe(note);
});

test("typing inside colored text keeps its tags as written", async ({
  page,
}) => {
  await boot(page, note);
  await caretAfter(page, "minus");
  await page.keyboard.type(" one");
  await caretAfter(page, "marked");
  await page.keyboard.type("!");
  expect(await saved(page)).toBe(
    note
      .replace("minus half", "minus one half")
      .replace("<mark>marked</mark>", "<mark>marked!</mark>"),
  );
});
