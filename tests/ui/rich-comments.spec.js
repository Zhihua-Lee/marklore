import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";
import { editor, caretAfter, selectText } from "./rich-helpers.js";

// In Edit mode: comment threads are underlined in the editor and follow
// the text as it is typed; selected text gets the small toolbar, with
// "Add comment" among its buttons.
const text = "# Plan\n\nSend it on **Friday**.\n\nAsk Ana about the budget.\n";
const thread = {
  id: "t-ai",
  quote: "the budget",
  prefix: "\n\nAsk Ana about ",
  suffix: ".\n",
  by: "claude-code",
  resolved: false,
  messages: [{ by: "claude-code", text: "Which?", at: "2026-10-23T10:00:00Z" }],
};

async function boot(page) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, thread }) => {
      window.mock = { handlers: {}, threads: [thread], changes: [] };
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
        comments: async () => structuredClone(window.mock.threads),
        changeComment: async (id, action, args) => {
          window.mock.changes.push({ id, action, args });
          if (action === "add")
            window.mock.threads.push({
              id: "t-new",
              quote: args.quote,
              prefix: args.prefix,
              suffix: args.suffix,
              by: "owner",
              resolved: false,
              messages: [{ by: "owner", text: args.text, at: "x" }],
            });
          return structuredClone(window.mock.threads);
        },
      });
    },
    { text, thread },
  );
  await page.goto("/");
  await page.keyboard.press("Control+2");
  await expect(editor(page)).toBeVisible();
}
const highlighted = (page) =>
  page.evaluate(() =>
    [...(CSS.highlights.get("folio-comment") || [])].map((r) => r.toString()),
  );

test("threads are underlined in the editor and follow typing", async ({
  page,
}) => {
  await boot(page);
  await expect.poll(() => highlighted(page)).toEqual(["the budget"]);
  await caretAfter(page, "Ask");
  await page.keyboard.type(" Maria and");
  await expect.poll(() => highlighted(page)).toEqual(["the budget"]);
});

test("the selection toolbar formats and starts a comment", async ({ page }) => {
  await boot(page);
  await selectText(page, "Send");
  const bar = page.locator(".rich-bubble");
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "加粗" }).click();
  await expect(editor(page).locator("strong").first()).toHaveText("Send");
  // A comment on formatted text quotes the note's own text.
  await selectText(page, "Friday");
  await bar.getByRole("button", { name: "添加批注" }).click();
  const card = page.locator(".comment-card");
  await expect(card.locator(".comment-quote")).toHaveText("Friday");
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
