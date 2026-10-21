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

async function boot(
  page,
  { directEdit = true, editSplit = true, text = note } = {},
) {
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
    { text, directEdit, editSplit },
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
  await expect(page.locator('#content [contenteditable="true"]')).toHaveCount(
    0,
  );
});

test("typing in a paragraph changes exactly that text, live", async ({
  page,
}) => {
  await boot(page);
  // Each block is an editing host of its own; the note is not one.
  await expect(page.locator("#content")).not.toHaveAttribute(
    "contenteditable",
    "true",
  );
  for (const block of ["#content h1", "#content p", "#content ul"])
    await expect(page.locator(block).first()).toHaveAttribute(
      "contenteditable",
      "true",
    );
  await expect(page.locator("#content pre").first()).not.toHaveAttribute(
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

test("Enter in a quote types into a new line of that quote, not elsewhere", async ({
  page,
}) => {
  // A display formula before the quote: the new line once showed up above it,
  // after the last paragraph, until the next render.
  await boot(page, {
    text: "# Title\n\nEnergy:\n\n$$\nx^2\n$$\n\n> Tip: check it.\n\n## Next\n",
  });
  await caretAtEnd(page, "Tip");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Note");
  expect(await source(page)).toContain("> Tip: check it.\n>\n> Note\n");
  // At once, before the render after the pause: the typed text is already
  // inside the quote.
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll("#content p")]
        .filter((p) => p.textContent.includes("Note"))
        .map((p) => p.parentElement.tagName),
    ),
  ).toEqual(["BLOCKQUOTE"]);
});

test("a closing $ typesets the formula at once, and typing goes on after it", async ({
  page,
}) => {
  await boot(page);
  await caretAtEnd(page, "Second");
  await page.keyboard.type(" Area $a^2$");
  // Well before the render that follows a pause (600 ms).
  await expect(
    paragraph(page, "Second").locator(".formula .katex"),
  ).toHaveCount(1, { timeout: 400 });
  await page.keyboard.type(".");
  expect(await source(page)).toContain("Second paragraph. Area $a^2$.\n");
  await expect(paragraph(page, "Second")).toContainText(/\.$/);
});

test("closing bold renders after a short pause, before typing stops", async ({
  page,
}) => {
  await boot(page);
  await caretAtEnd(page, "Second");
  await page.keyboard.type(" **Note.**");
  await expect(paragraph(page, "Second").locator("strong")).toHaveText(
    "Note.",
    { timeout: 500 },
  );
  await page.keyboard.type(" Done");
  expect(await source(page)).toContain("Second paragraph. **Note.** Done\n");
});

test("Enter renders only its block; blocks below still map to the source", async ({
  page,
}) => {
  await boot(page);
  const list = page.locator("#content ul").first();
  const before = await list.getAttribute("data-from");
  // Split "Second paragraph." after "Second".
  await page.evaluate(() => {
    const run = [
      ...document.querySelectorAll("#content p [data-text-from]"),
    ].find((el) => el.textContent.startsWith("Second")).firstChild;
    document.querySelector("#content").focus();
    getSelection().collapse(run, "Second".length);
  });
  await page.keyboard.press("Enter");
  await expect(paragraph(page, "paragraph.")).toHaveText("paragraph.");
  await expect(paragraph(page, "Second")).toHaveText("Second");
  // No full render yet: the list keeps the position it was rendered with...
  expect(await list.getAttribute("data-from")).toBe(before);
  // ...and typing in it still lands at its place in the source.
  await page.locator("#content li").filter({ hasText: "one" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("X");
  expect(await source(page)).toContain("Second\n\nparagraph.\n\n- oneX\n- two");
  // Once typing stops, the full render brings every position up to date.
  await expect
    .poll(() => list.getAttribute("data-from"))
    .toBe(String(Number(before) + 1));
});

test("table cells take typing on one line; a | is written escaped", async ({
  page,
}) => {
  const table = "# T\n\n| A | B |\n| --- | --- |\n| one | two |\n\nAfter.\n";
  await boot(page, { text: table });
  const cell = page.locator("#content td").filter({ hasText: "one" });
  await cell.click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  expect(await source(page)).toBe(table.replace("| one |", "| one! |"));
  await expect(cell).toHaveText("one!");
  await page.keyboard.type("|");
  expect(await source(page)).toContain("| one!\\| | two |");
  // Typing goes on after the escaped "|", in the same cell.
  await page.keyboard.type("?");
  expect(await source(page)).toContain("| one!\\|? | two |");
  await expect(cell).toHaveText("one!|?");
  // Enter and joins change nothing in a cell.
  const now = await source(page);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  expect(await source(page)).toBe(now);
  await expect(page.locator("#content table")).toHaveCount(1);
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

test("after a pause the preview re-renders and the caret stays where typing goes on", async ({
  page,
}) => {
  await boot(page);
  await paragraph(page, "Second").click({ position: { x: 20, y: 8 } });
  const cdp = await page.context().newCDPSession(page);
  for (const chunk of ["AB", "CD"]) {
    await page.keyboard.type(chunk);
    // Typing has stopped long enough for the preview to render again.
    await page.waitForTimeout(1000);
  }
  for (const word of ["中", "文"]) {
    await cdp.send("Input.imeSetComposition", {
      text: "x",
      selectionStart: 1,
      selectionEnd: 1,
    });
    await cdp.send("Input.insertText", { text: word });
    await page.waitForTimeout(1000);
  }
  const text = await paragraph(page, "paragraph").textContent();
  expect(text).toMatch(/^Se?c?o?n?d?.*ABCD中文/);
  expect(await source(page)).toContain("ABCD中文");
  // The caret is on text, not left between blocks.
  expect(
    await page.evaluate(
      () =>
        !!getSelection().anchorNode?.parentElement?.closest("[data-text-from]"),
    ),
  ).toBe(true);
});

// Each block is its own editing host (typing in a long note costs a block's
// work, not the note's); the caret and selections still cross blocks.
test("arrow keys, Shift and a drag cross blocks", async ({ page }) => {
  await boot(page);
  const hostOf = (end) =>
    page.evaluate((end) => {
      const node = getSelection()[end + "Node"];
      return (node.nodeType === 1 ? node : node.parentElement)
        .closest("[data-direct-host]")
        ?.textContent.replace(/\s+/g, "")
        .slice(0, 6);
    }, end);
  // Right at a block's end goes to the next block's start; Left comes back.
  await caretAtEnd(page, "First");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("X");
  expect(await source(page)).toContain("XSecond paragraph.");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("Y");
  expect(await source(page)).toContain("here.Y\n\nXSecond");
  // Down from a block's last line goes to the next block, Up back.
  await paragraph(page, "Second").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  expect(await hostOf("anchor")).toBe("onetwo");
  await page.keyboard.press("ArrowUp");
  expect(await hostOf("anchor")).toBe("XSecon");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  expect(await hostOf("anchor")).toMatch(/^.?Title/);
  // Ctrl+End: the end of the last block that takes typing.
  await page.keyboard.press("Control+End");
  expect(await hostOf("anchor")).toBe("onetwo");
  // Shift+Down selects into the next block; Backspace removes the selection.
  await paragraph(page, "Second").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowDown");
  expect(await hostOf("anchor")).toBe("XSecon");
  expect(await hostOf("focus")).toBe("onetwo");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  expect(await source(page)).not.toContain("Second paragraph.");
  expect(await source(page)).toContain("two");
  // A drag from one block into another selects across them.
  const first = await paragraph(page, "First").boundingBox();
  const target = await page.locator("#content li").first().boundingBox();
  await page.mouse.move(first.x + 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 30, target.y + target.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  expect(await hostOf("anchor")).toMatch(/^First/);
  expect(await hostOf("focus")).not.toMatch(/^First/);
  // Ctrl+A selects the whole note, not one block.
  await paragraph(page, "First").click();
  await page.keyboard.press("Control+a");
  expect(await hostOf("anchor")).toMatch(/^.?Title/);
  expect(
    await page.evaluate(() => getSelection().getRangeAt(0).toString()),
  ).toContain("two");
});

test("cutting a selection over blocks copies all of it and removes it from the source", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    window.__copied = null;
    // Last in line: what the clipboard gets.
    window.addEventListener("copy", (event) => {
      window.__copied = event.clipboardData.getData("text/plain");
    });
  });
  await paragraph(page, "First").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Control+x");
  await expect(paragraph(page, "Second")).toHaveCount(0);
  expect(await source(page)).toContain(
    "First **bold** text and $x^2$ here.\n\n- one",
  );
  // The clipboard has the whole selection, not the first block's part.
  await expect
    .poll(() => page.evaluate(() => window.__copied))
    .toContain("Second paragraph.");
});
