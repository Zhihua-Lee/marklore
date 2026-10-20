import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Direct editing: typing in the rendered note edits the source at the place
// the text came from, and nowhere else.
const note = [
  "# Title",
  "First **bold** text and $x^2$ here.",
  "Second paragraph.",
  "- one\n- two",
  "```js\nx = 1\n```",
  "",
].join("\n\n");

async function boot(page, { directEdit = true, editSplit = true } = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, directEdit, editSplit }) => {
      const file = {
        id: "one",
        path: "C:/notes/One.md",
        name: "One.md",
        text,
        version: "v1",
      };
      window.folio = folioTest.mock({
        session: async (state) => {
          window.lastDraft = state.tabs?.[0]?.draft ?? window.lastDraft;
        },
        ready: async () => ({
          incoming: [file],
          roots: [],
          restored: [],
          settings: { sidebar: false, outline: false, directEdit, editSplit },
        }),
      });
    },
    { text: note, directEdit, editSplit },
  );
  await page.goto("/");
  await page.locator("#content h1").waitFor();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator("#panes")).toHaveAttribute("data-mode", "edit");
}
// The source as the source editor holds it.
const source = (page) =>
  page.evaluate(() => {
    const lines = [...document.querySelectorAll("#editor .cm-line")];
    return lines.map((line) => line.textContent).join("\n");
  });
const paragraph = (page, text) =>
  page.locator("#content p").filter({ hasText: text }).first();
async function caretAtEnd(page, text) {
  await paragraph(page, text).click();
  await page.keyboard.press("End");
}

test("off by default: the preview does not take typing", async ({ page }) => {
  await boot(page, { directEdit: false });
  await expect(page.locator("#content")).not.toHaveAttribute(
    "contenteditable",
    "true",
  );
});

test("typing in a paragraph changes exactly that text, live", async ({
  page,
}) => {
  await boot(page);
  await expect(page.locator("#content")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  // Moving around changes nothing.
  await paragraph(page, "Second").click();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Home");
  expect(await source(page)).toBe(note);
  await caretAtEnd(page, "Second");
  await page.keyboard.type(" Added 中文");
  await expect(paragraph(page, "Second")).toHaveText(
    "Second paragraph. Added 中文",
  );
  expect(await source(page)).toBe(
    note.replace("Second paragraph.", "Second paragraph. Added 中文"),
  );
  // Inside bold text, the text stays bold.
  await page.locator("#content strong").first().click();
  await page.evaluate(() => {
    const text = document.querySelector(
      "#content strong [data-text-from]",
    ).firstChild;
    getSelection().collapse(text, text.length);
  });
  await page.keyboard.type("er");
  await expect(page.locator("#content strong").first()).toHaveText("bolder");
  expect(await source(page)).toContain("First **bolder** text");
  // Undo goes back step by step through the source editor's history.
  await page.keyboard.press("Control+z");
  await expect(page.locator("#content strong").first()).toHaveText("bold");
});

test("Enter starts a paragraph or list item; Backspace undoes the marker, then joins", async ({
  page,
}) => {
  await boot(page);
  await caretAtEnd(page, "Second");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Third");
  await expect(paragraph(page, "Third")).toBeVisible();
  expect(await source(page)).toContain("Second paragraph.\n\nThird\n\n- one");

  await page.locator("#content li").filter({ hasText: "one" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("half");
  expect(await source(page)).toContain("- one\n- half\n- two");

  // At a heading's start, Backspace makes it a paragraph.
  await page.locator("#content h1").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await expect(page.locator("#content h1")).toHaveCount(0);
  expect((await source(page)).startsWith("Title\n\nFirst")).toBe(true);
  // At a paragraph's start, Backspace joins it to the one before.
  await paragraph(page, "Third").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  expect(await source(page)).toContain("Second paragraph.Third");
});

test("deleting a selection across bold keeps the markup around what is left", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const bold = document.querySelector("#content strong [data-text-from]"),
      after = bold.closest("strong").nextSibling;
    const tail = after.nodeType === 3 ? after : after.firstChild;
    const range = document.createRange();
    range.setStart(bold.firstChild, 2); // "bo|ld"
    range.setEnd(tail, 3); // " te|xt"
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.keyboard.press("Delete");
  expect(await source(page)).toContain("First **bo**xt and $x^2$ here.");
});

test("an input method composes in place; the result lands in the source once", async ({
  page,
}) => {
  await boot(page);
  await caretAtEnd(page, "Second");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "zhong",
    selectionStart: 5,
    selectionEnd: 5,
  });
  await cdp.send("Input.imeSetComposition", {
    text: "zhongwen",
    selectionStart: 8,
    selectionEnd: 8,
  });
  await cdp.send("Input.insertText", { text: "中文" });
  await expect(paragraph(page, "Second")).toHaveText("Second paragraph.中文");
  expect(await source(page)).toContain("Second paragraph.中文\n\n- one");
  await page.keyboard.type("!");
  expect(await source(page)).toContain("Second paragraph.中文!\n\n- one");
});

test("Backspace after a formula, or Delete before one, takes the whole formula", async ({
  page,
}) => {
  await boot(page);
  const formula = page.locator("#content .formula").first();
  // Caret right after the formula: Backspace.
  await formula.evaluate((el) => {
    const next = el.nextSibling;
    const node = next.nodeType === 3 ? next : next.firstChild;
    document.querySelector("#content").focus();
    getSelection().collapse(node, 0);
  });
  await page.keyboard.press("Backspace");
  expect(await source(page)).toContain("First **bold** text and  here.");
  await page.keyboard.press("Control+z");
  await expect(page.locator("#content .formula")).toHaveCount(1);
  // Caret right before it: Delete.
  await page
    .locator("#content .formula")
    .first()
    .evaluate((el) => {
      const previous = el.previousSibling;
      const node = previous.nodeType === 3 ? previous : previous.lastChild;
      const text = node.nodeType === 3 ? node : node.firstChild;
      document.querySelector("#content").focus();
      getSelection().collapse(text, text.length);
    });
  await page.keyboard.press("Delete");
  expect(await source(page)).toContain("First **bold** text and  here.");
});

test("an input method at the edge of bold text lands next to it, never inside its markers", async ({
  page,
}) => {
  await boot(page);
  await page.locator("#content strong").first().click();
  // The caret at the boundary just after the bold element.
  await page.evaluate(() => {
    const strong = document.querySelector("#content strong");
    const at = [...strong.parentNode.childNodes].indexOf(strong) + 1;
    getSelection().collapse(strong.parentNode, at);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "ci",
    selectionStart: 2,
    selectionEnd: 2,
  });
  await cdp.send("Input.insertText", { text: "词" });
  await page.waitForTimeout(900);
  const line = (await source(page))
    .split("\n")
    .find((l) => l.startsWith("First"));
  expect([
    "First **bold词** text and $x^2$ here.",
    "First **bold**词 text and $x^2$ here.",
  ]).toContainEqual(line);
  // What shows is what the source says.
  await expect(paragraph(page, "First")).toContainText("词");
});

test("without the source pane, Edit mode is the rendered note alone, still editable", async ({
  page,
}) => {
  await boot(page, { editSplit: false });
  await expect(page.locator("#editor-pane")).toBeHidden();
  await expect(page.locator("#split")).toBeHidden();
  const reader = await page.locator("#reader").boundingBox(),
    panes = await page.locator("#panes").boundingBox();
  expect(reader.width).toBeGreaterThan(panes.width - 2);
  await caretAtEnd(page, "Second");
  await page.keyboard.type(" more");
  await expect
    .poll(() => page.evaluate(() => window.lastDraft))
    .toContain("Second paragraph. more\n\n- one");
});
