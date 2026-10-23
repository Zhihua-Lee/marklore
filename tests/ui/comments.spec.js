import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Comment threads (src/comments.js) against a mocked main process that
// keeps the threads in window.mock.threads, as desktop/ai-bridge.mjs does.
const text = "# Plan\n\nSend it on Friday.\n\nAsk Ana about the budget.\n";

async function boot(page, threads = []) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, threads }) => {
      const file = {
        id: "file-plan",
        path: "C:/synthetic/Notes/Plan.md",
        name: "Plan.md",
        text,
        version: "v1",
      };
      window.mock = { handlers: {}, threads, changes: [] };
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [file],
          restored: [],
          roots: [],
          settings: {},
        }),
        comments: async () => structuredClone(window.mock.threads),
        changeComment: async (id, action, args) => {
          window.mock.changes.push({ id, action, args });
          const list = window.mock.threads,
            at = new Date("2026-10-23T12:00:00Z").toISOString();
          if (action === "add")
            list.push({
              id: "t" + list.length,
              quote: args.quote,
              prefix: args.prefix,
              suffix: args.suffix,
              by: "owner",
              resolved: false,
              messages: [{ by: "owner", text: args.text, at }],
            });
          const thread = list.find((x) => x.id === args.id);
          if (action === "reply") {
            thread.messages.push({ by: "owner", text: args.text, at });
            thread.resolved = false;
          }
          if (action === "resolve") thread.resolved = args.resolved !== false;
          if (action === "remove") list.splice(list.indexOf(thread), 1);
          return structuredClone(list);
        },
      });
    },
    { text, threads },
  );
  await page.goto("/");
  await expect(page.locator("#content h1")).toContainText("Plan");
}

const ai = {
  id: "t-ai",
  quote: "the budget",
  prefix: "\n\nAsk Ana about ",
  suffix: ".\n",
  by: "claude-code",
  resolved: false,
  messages: [
    {
      by: "claude-code",
      text: "Which budget: this year's?",
      at: "2026-10-23T10:00:00Z",
    },
  ],
};

const highlighted = (page) =>
  page.evaluate(() =>
    [...(CSS.highlights.get("folio-comment") || [])].map((r) => r.toString()),
  );

// Selects a phrase of the rendered note.
async function select(page, phrase) {
  await page.evaluate((phrase) => {
    const walker = document.createTreeWalker(
      document.querySelector("#content"),
      NodeFilter.SHOW_TEXT,
    );
    let node;
    while ((node = walker.nextNode())) {
      const at = node.data.indexOf(phrase);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + phrase.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return;
    }
    throw Error("No " + phrase);
  }, phrase);
}

test("an AI's comment is underlined; a click opens it and the reader answers", async ({
  page,
}) => {
  await boot(page, [structuredClone(ai)]);
  await expect.poll(() => highlighted(page)).toEqual(["the budget"]);
  const button = page.locator("#comments-button");
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("data-count", "1");
  await page
    .locator("#content")
    .getByText("Ask Ana about the budget")
    .click({
      position: { x: 160, y: 8 },
    });
  const card = page.locator(".comment-card");
  await expect(card.locator(".comment-quote")).toHaveText("the budget");
  await expect(card.locator(".comment-messages li")).toHaveCount(1);
  await expect(card.locator(".comment-messages strong")).toHaveText(
    "Claude Code",
  );
  await card.getByRole("textbox").fill("Yes, 2026.");
  await card.getByRole("textbox").press("Control+Enter");
  await expect(card.locator(".comment-messages li")).toHaveCount(2);
  await expect(card.locator(".comment-messages li").nth(1)).toContainText("你");
  expect(
    await page.evaluate(() =>
      window.mock.changes.map((c) => [c.action, c.args.id, c.args.text]),
    ),
  ).toEqual([["reply", "t-ai", "Yes, 2026."]]);
  // Resolved: no longer underlined, no count.
  await card.getByRole("button", { name: "解决" }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => highlighted(page)).toEqual([]);
  await expect(button).toHaveClass(/settled/);
  // Listed still, as resolved.
  await button.click();
  await expect(
    page.getByRole("menuitem", {
      name: /the budget\s*已解决 · 你：Yes, 2026\./,
    }),
  ).toBeVisible();
});

test("the reader comments on selected text from the context menu or Ctrl+Alt+M", async ({
  page,
}) => {
  await boot(page);
  await select(page, "on Friday");
  await page
    .locator("#content")
    .getByText("Send it on Friday.")
    .click({ button: "right", position: { x: 70, y: 8 } });
  await page.getByRole("menuitem", { name: "添加批注… Ctrl+Alt+M" }).click();
  const card = page.locator(".comment-card");
  await expect(card.locator(".comment-quote")).toHaveText("on Friday");
  await card.getByRole("textbox").fill("Can this be earlier?");
  await card.getByRole("button", { name: "添加批注" }).click();
  await expect(card).toHaveCount(0);
  const [added] = await page.evaluate(() => window.mock.changes);
  expect(added.action).toBe("add");
  expect(added.args).toEqual({
    quote: "on Friday",
    prefix: "# Plan\n\nSend it ",
    suffix: ".\n\nAsk Ana about the budget.\n",
    text: "Can this be earlier?",
  });
  await expect.poll(() => highlighted(page)).toEqual(["on Friday"]);
  // The keyboard way.
  await select(page, "Ask Ana");
  await page.keyboard.press("Control+Alt+m");
  await expect(card.locator(".comment-quote")).toHaveText("Ask Ana");
  await expect(card.getByRole("textbox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
});

test("a new note cannot take comments until it is saved", async ({ page }) => {
  await boot(page);
  await page.locator("#new").click();
  await page.keyboard.type("Draft text");
  await expect(page.locator("#comments-button")).toBeHidden();
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await select(page, "Draft");
  await page.keyboard.press("Control+Alt+m");
  await expect(page.locator("#toast")).toHaveText("请先保存笔记，再添加批注");
});
