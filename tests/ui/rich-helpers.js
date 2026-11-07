// Shared by the specs of the editor of Edit mode (src/rich).
import { expect } from "@playwright/test";
import fs from "node:fs";
import { installFolio } from "./fixtures.js";

// Edit mode types into the note as drawn (src/rich). The note's Markdown
// stays its own: a block not touched is written back byte for byte, and a
// touched block changes only where it was edited.
export const note = fs.readFileSync(
  new URL("../fixtures/rich-mixed.md", import.meta.url),
  "utf8",
);

export async function boot(page, text = note, settings = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, settings }) => {
      window.mock = { disk: text, version: "v1", handlers: {}, saved: [] };
      const file = (id, name, text) => ({
        id,
        path: "C:/synthetic/" + name,
        name,
        text,
        version: "v1",
      });
      window.folio = folioTest.mock({
        ready: async () => ({
          restored: [],
          incoming: [
            file("rich", "Rich.md", text),
            file("other", "Other.md", "# Other\n\nSecond note.\n"),
          ],
          roots: [],
          settings: {
            sidebar: false,
            outline: false,
            richEdit: true,
            ...settings,
          },
        }),
        read: async () => ({ unchanged: true }),
        save: async (id, text, version) => {
          window.mock.saved.push({ id, text });
          return { version: version + "s" };
        },
      });
    },
    { text, settings },
  );
  await page.goto("/");
  await page.getByRole("tab", { name: "Rich.md", exact: true }).click();
  await page.keyboard.press("Control+2");
  await expect(page.locator("#rich .ProseMirror")).toBeVisible();
  await expect(page.locator("#reader")).toBeHidden();
}
export const editor = (page) => page.locator("#rich .ProseMirror");
// The note's text as saving would write it.
export async function saved(page) {
  const before = await page.evaluate(() => window.mock.saved.length);
  await page.keyboard.press("Control+s");
  await expect
    .poll(() => page.evaluate(() => window.mock.saved.length))
    .toBeGreaterThan(before);
  return page.evaluate(() => window.mock.saved.at(-1).text);
}
// a differs from b by exactly `extra` inserted at one place.
export function insertedOnly(a, b, extra) {
  let p = 0;
  while (a[p] === b[p]) p++;
  return a.slice(0, p) + extra + a.slice(p) === b
    ? true
    : JSON.stringify({
        at: p,
        was: a.slice(p - 20, p + 40),
        now: b.slice(p - 20, p + 40),
      });
}
// Click just after `text` (on the right half of its last character).
// (Blocks drawn as they come on screen can change height: scroll, let the
// page settle, then measure.)
export async function caretAfter(page, text) {
  const locate = (scroll) =>
    page.evaluate(
      ([text, scroll]) => {
        const root = document.querySelector("#rich .ProseMirror");
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const i = node.data.indexOf(text);
          if (i < 0) continue;
          const range = document.createRange();
          const end = i + text.length;
          range.setStart(node, end - 1);
          range.setEnd(node, end);
          if (scroll)
            range.startContainer.parentElement.scrollIntoView({
              block: "center",
            });
          const rect = [...range.getClientRects()].at(-1);
          return { x: rect.right - 1, y: rect.top + rect.height / 2 };
        }
        throw Error("no text " + text);
      },
      [text, scroll],
    );
  await locate(true);
  await page.waitForTimeout(100);
  await locate(true);
  await page.waitForTimeout(50);
  const point = await locate(false);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(50);
}
export async function compose(page, text) {
  const cdp = await page.context().newCDPSession(page);
  for (let i = 1; i <= text.length; i++) {
    await cdp.send("Input.imeSetComposition", {
      text: text.slice(0, i),
      selectionStart: i,
      selectionEnd: i,
    });
    await page.waitForTimeout(30);
  }
  await cdp.send("Input.insertText", { text });
  await page.waitForTimeout(80);
}

// Select `text` with the mouse (a drag over it).
export async function selectText(page, text) {
  const box = await page.evaluate((text) => {
    const root = document.querySelector("#rich .ProseMirror");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.data.indexOf(text);
      if (i < 0) continue;
      node.parentElement.scrollIntoView({ block: "center" });
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const first = range.getClientRects()[0];
      range.setStart(node, i + text.length - 1);
      range.setEnd(node, i + text.length);
      const last = [...range.getClientRects()].at(-1);
      return {
        x1: first.left + 1,
        y1: first.top + first.height / 2,
        x2: last.right - 1,
        y2: last.top + last.height / 2,
      };
    }
    throw Error("no text " + text);
  }, text);
  await page.mouse.move(box.x1, box.y1);
  await page.mouse.down();
  await page.mouse.move(box.x2, box.y2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(50);
}
