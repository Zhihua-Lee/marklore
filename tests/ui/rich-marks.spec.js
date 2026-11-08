import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";
import { editor, caretAfter, selectText } from "./rich-helpers.js";

// In Edit mode: marks for the AI are underlined in the editor and follow the
// text as it is typed; selected text gets the small toolbar, with "Mark for
// AI" among its buttons.
const text = "# Plan\n\nSend it on **Friday**.\n\nAsk Ana about the budget.\n";
const mark = {
  id: "m1",
  file: "C:/synthetic/Notes/Plan.md",
  name: "Plan.md",
  quote: "the budget",
  prefix: "\n\nAsk Ana about ",
  suffix: ".\n",
  text: "Which?",
  created: "2026-11-07T09:00:00.000Z",
  batch: null,
};

async function boot(page) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, mark }) => {
      window.mock = {
        handlers: {},
        state: { marks: [mark], batches: [], sessions: [] },
        changes: [],
      };
      const state = () => structuredClone(window.mock.state);
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [
            {
              id: "file-plan",
              path: "C:/synthetic/Notes/Plan.md",
              name: "Plan.md",
              text,
              version: "v1",
            },
          ],
          restored: [],
          roots: [],
          settings: { richEdit: true, sidebar: false, outline: false },
        }),
        marks: async () => state(),
        changeMark: async (action, args) => {
          window.mock.changes.push({ action, args });
          if (action === "add")
            window.mock.state.marks.push({
              ...args,
              id: "m-new",
              file: "C:/synthetic/Notes/Plan.md",
              name: "Plan.md",
              batch: null,
            });
          return state();
        },
      });
    },
    { text, mark },
  );
  await page.goto("/");
  await page.keyboard.press("Control+2");
  await expect(editor(page)).toBeVisible();
}
const highlighted = (page) =>
  page.evaluate(() =>
    [...(CSS.highlights.get("folio-mark") || [])].map((r) => r.toString()),
  );

test("marks are underlined in the editor and follow typing", async ({
  page,
}) => {
  await boot(page);
  await expect.poll(() => highlighted(page)).toEqual(["the budget"]);
  await caretAfter(page, "Ask");
  await page.keyboard.type(" Maria and");
  await expect.poll(() => highlighted(page)).toEqual(["the budget"]);
});

test("the selection toolbar formats and marks for the AI", async ({ page }) => {
  await boot(page);
  await selectText(page, "Send");
  const bar = page.locator(".rich-bubble");
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "加粗" }).click();
  await expect(editor(page).locator("strong").first()).toHaveText("Send");
  // A mark on formatted text quotes the note's own text.
  await selectText(page, "Friday");
  await bar.getByRole("button", { name: "标记给 AI…" }).click();
  const card = page.locator(".mark-card");
  await expect(card.locator(".mark-quote")).toHaveText("Friday");
  await card.locator("textarea").fill("Or Monday?");
  await card.locator("textarea").press("Control+Enter");
  await expect
    .poll(() => page.evaluate(() => window.mock.changes.at(-1)?.args.quote))
    .toBe("Friday");
  await expect
    .poll(() => highlighted(page))
    .toEqual(expect.arrayContaining(["Friday", "the budget"]));
  // Clicking elsewhere hides the toolbar.
  await caretAfter(page, "Plan");
  await expect(bar).toBeHidden();
});
