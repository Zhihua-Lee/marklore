import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Another program (an AI agent, a sync tool) adds a note: the tree follows,
// and folders the reader opened stay open.
test("the library follows notes added on disk and keeps open folders", async ({
  page,
}) => {
  await installFolio(page);
  await page.addInitScript(() => {
    const folder = (id, name) => ({ id, name, path: "C:/kb/" + name });
    window.mock = {
      handlers: {},
      entries: {
        root: [
          { ...folder("topic", "Topic"), directory: true },
          { name: "Index.md", path: "C:/kb/Index.md", directory: false },
        ],
        topic: [
          { name: "First.md", path: "C:/kb/Topic/First.md", directory: false },
        ],
      },
    };
    window.folio = folioTest.mock({
      on: (name, callback) => (window.mock.handlers[name] = callback),
      ready: async () => ({
        incoming: [],
        restored: [],
        roots: [{ id: "root", name: "kb", path: "C:/kb" }],
        settings: { sidebar: true },
      }),
      list: async (id) => window.mock.entries[id] || [],
    });
  });
  await page.goto("/");
  const tree = page.locator("#tree");
  await tree.getByText("Topic", { exact: true }).click();
  await expect(tree.getByRole("button", { name: "First.md" })).toBeVisible();

  await page.evaluate(() => {
    window.mock.entries.topic.push({
      name: "Agent note.md",
      path: "C:/kb/Topic/Agent note.md",
      directory: false,
    });
    window.mock.handlers.library();
  });
  await expect(
    tree.getByRole("button", { name: "Agent note.md" }),
  ).toBeVisible();
  await expect(
    tree.locator('details.folder[data-path="C:/kb/Topic"]'),
  ).toHaveAttribute("open", "");

  // A refresh with nothing new (a note was saved) leaves the tree alone.
  await tree.evaluate((el) => {
    window.swaps = 0;
    new MutationObserver((list) => (window.swaps += list.length)).observe(el, {
      childList: true,
      subtree: true,
    });
  });
  await page.evaluate(() => window.mock.handlers.library());
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.swaps)).toBe(0);
  // And a change puts the new tree in place in one step, folders filled.
  await page.evaluate(() => {
    window.mock.entries.root.push({
      name: "Later.md",
      path: "C:/kb/Later.md",
      directory: false,
    });
    window.sawEmpty = false;
    new MutationObserver(() => {
      const open = document.querySelector(
        '#tree details.folder[data-path="C:/kb/Topic"]',
      );
      if (!open?.querySelector(".file")) window.sawEmpty = true;
    }).observe(document.querySelector("#tree"), {
      childList: true,
      subtree: true,
    });
    window.mock.handlers.library();
  });
  await expect(tree.getByRole("button", { name: "Later.md" })).toBeVisible();
  expect(await page.evaluate(() => window.sawEmpty)).toBe(false);

  // With a filter in use, the search runs again; the filter is not cleared.
  await page.locator("#file-filter").fill("Agent");
  await page.evaluate(() => window.mock.handlers.library());
  await expect(page.locator("#file-filter")).toHaveValue("Agent");
});
