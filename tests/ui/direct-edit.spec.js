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
  await page
    .locator(text ? "#content [data-from]" : "#tabs .tab")
    .first()
    .waitFor();
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
  // A code block's code is one too; its toolbar is not.
  for (const block of [
    "#content h1",
    "#content p",
    "#content ul",
    "#content pre",
  ])
    await expect(page.locator(block).first()).toHaveAttribute(
      "contenteditable",
      "true",
    );
  await expect(page.locator("#content .code-toolbar").first()).toHaveAttribute(
    "contenteditable",
    "false",
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

test("Backspace after a formula takes its closing $, Delete before one its opening $", async ({
  page,
}) => {
  await boot(page);
  const formula = page.locator("#content .formula").first();
  // Caret right after the formula: Backspace.
  await formula.evaluate((el) => {
    const next = el.nextSibling;
    const node = next.nodeType === 3 ? next : next.firstChild;
    el.closest("[data-direct-host]").focus();
    getSelection().collapse(node, 0);
  });
  await page.keyboard.press("Backspace");
  expect(await source(page)).toContain("First **bold** text and $x^2 here.");
  // The source shows as text, the caret after it; typing goes on there.
  await expect(paragraph(page, "First")).toContainText("and $x^2 here.");
  await page.keyboard.type("$");
  expect(await source(page)).toContain("text and $x^2$ here.");
  await expect(page.locator("#content .formula")).toHaveCount(1);
  // Caret right before it: Delete.
  await page
    .locator("#content .formula")
    .first()
    .evaluate((el) => {
      const previous = el.previousSibling;
      const node = previous.nodeType === 3 ? previous : previous.lastChild;
      const text = node.nodeType === 3 ? node : node.firstChild;
      el.closest("[data-direct-host]").focus();
      getSelection().collapse(text, text.length);
    });
  await page.keyboard.press("Delete");
  expect(await source(page)).toContain("First **bold** text and x^2$ here.");
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
  expect(await hostOf("anchor")).toBe("x=1");
  // Its last line, before the closing fence.
  await page.keyboard.type("Z");
  expect(await source(page)).toContain("x = 1Z\n```");
  await page.keyboard.press("Backspace");
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

test("the render after a pause keeps the note where it is on screen", async ({
  page,
}) => {
  const long = Array.from(
    { length: 60 },
    (_, i) =>
      `Paragraph ${i} has enough words to wrap over two lines in the reader, with $x_${i}$ inside it.`,
  ).join("\n\n");
  await boot(page, { editSplit: false, text: `# Long\n\n${long}\n` });
  // Stop mid-line: the reading anchor's character is above the probe point.
  await page.evaluate(
    () => (document.querySelector("#reader").scrollTop = 913),
  );
  await page.waitForTimeout(300);
  const before = await page.evaluate(
    () => document.querySelector("#reader").scrollTop,
  );
  const box = await paragraph(page, "Paragraph 30").boundingBox();
  await page.mouse.click(box.x + 20, box.y + 8);
  await page.keyboard.type(" typed");
  // The pause render replaces the paragraph; nothing above it changed.
  await page.waitForTimeout(1500);
  expect(
    Math.abs(
      (await page.evaluate(() => document.querySelector("#reader").scrollTop)) -
        before,
    ),
  ).toBeLessThanOrEqual(1);
});

// On Windows the input method hears of changes to the text around its
// composition, and Sogou Pinyin ends the composition then: background work
// (lazy formulas, diagrams, tables, link marks) waits until it is done.
test("nothing else in the note changes while an input method composes", async ({
  page,
}) => {
  // Long enough that formulas further down are still waiting to be typeset.
  const long = Array.from(
    { length: 600 },
    (_, i) =>
      `Line ${i} with $\\sum_{k=0}^{${i}} \\frac{y_k}{${i + 1}}$ and [a link](#nowhere${i}).`,
  ).join("\n\n");
  await boot(page, { editSplit: false, text: `# Long\n\n${long}\n` });
  const box = await paragraph(page, /^Line 2 with/).boundingBox();
  await page.mouse.click(box.x + 20, box.y + 6);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "zh",
    selectionStart: 2,
    selectionEnd: 2,
  });
  await page.evaluate(() => {
    window.__changes = 0;
    new MutationObserver((records) => {
      window.__changes += records.filter(
        (r) => r.type !== "characterData",
      ).length;
    }).observe(document.querySelector("#content"), {
      subtree: true,
      childList: true,
      attributes: true,
    });
  });
  // Scrolling brings formulas that are not typeset yet into view.
  const pending = await page.evaluate(
    () => document.querySelectorAll("#content [data-folio-math]").length,
  );
  expect(pending).toBeGreaterThan(0);
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() =>
      document.querySelector("#reader").scrollBy(0, 3000),
    );
    await cdp.send("Input.imeSetComposition", {
      text: "zhongwen".slice(0, 3 + (i % 6)),
      selectionStart: 3,
      selectionEnd: 3,
    });
    await page.waitForTimeout(150);
  }
  expect(await page.evaluate(() => window.__changes)).toBe(0);
  await cdp.send("Input.insertText", { text: "中文" });
  await expect.poll(() => source(page)).toContain("中文");
  // Afterwards the formulas are typeset as usual.
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelectorAll("#content [data-folio-math]").length,
      ),
    )
    .toBeLessThan(pending);
});

// The render after a pause in typing must not replace the block typed into,
// nor move the focus: on Windows either tells the input method its text field
// changed, and Sogou Pinyin then ends the composition the next word starts.
test("the render after a pause keeps the block typed into, and the focus", async ({
  page,
}) => {
  await boot(page);
  const cdp = await page.context().newCDPSession(page);
  const watch = () =>
    page.evaluate(() => {
      const anchor = getSelection().anchorNode;
      window.__typed = {
        host: anchor.parentElement.closest("[data-direct-host]"),
        node: anchor,
        below: [...document.querySelectorAll("#content li")],
        events: [],
      };
      for (const type of ["focusout", "focusin"])
        document.addEventListener(
          type,
          () => window.__typed.events.push(type),
          {
            capture: true,
          },
        );
    });
  const kept = () =>
    page.evaluate(() => {
      const { host, node, below, events } = window.__typed;
      const anchor = getSelection().anchorNode;
      return {
        host:
          host.isConnected &&
          anchor.parentElement.closest("[data-direct-host]") === host,
        node: anchor === node,
        below: below.every((li) => li.isConnected),
        events,
      };
    });
  // A paragraph with bold and a formula, with typed text before both.
  await paragraph(page, "First").click({ position: { x: 8, y: 8 } });
  await watch();
  for (const [pinyin, word] of [
    ["zhong", "中"],
    ["wen", "文"],
  ]) {
    await cdp.send("Input.imeSetComposition", {
      text: pinyin,
      selectionStart: pinyin.length,
      selectionEnd: pinyin.length,
    });
    await cdp.send("Input.insertText", { text: word });
    // Long enough for the preview to render again.
    await page.waitForTimeout(1000);
  }
  expect(await source(page)).toMatch(
    /F中文irst \*\*bold\*\* text and \$x\^2\$ here\./,
  );
  expect(await kept()).toEqual({
    host: true,
    node: true,
    below: true,
    events: [],
  });
  // Typing goes on at the caret, and the source maps the block afresh.
  await page.keyboard.type("!");
  expect(await source(page)).toContain("F中文!irst **bold**");

  // A new paragraph: it renders differently from the empty one typed into,
  // and takes the new content in place, keeping the focus.
  await caretAtEnd(page, "Second");
  await page.keyboard.press("Enter");
  await watch();
  await cdp.send("Input.imeSetComposition", {
    text: "xin",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await cdp.send("Input.insertText", { text: "新" });
  await page.waitForTimeout(1000);
  expect(await source(page)).toContain("Second paragraph.\n\n新\n\n- one");
  await expect(
    page.locator("#content p").filter({ hasText: "新" }),
  ).toHaveCount(1);
  const after = await kept();
  expect(after.host).toBe(true);
  expect(after.events).toEqual([]);
  await page.keyboard.type("!");
  expect(await source(page)).toContain("\n\n新!\n\n- one");
});

test("a heading keeps its section, its text and the focus while typed into; Enter after it starts a paragraph in the section", async ({
  page,
}) => {
  const text = "# Title\n\nIntro.\n\n## Sub heading\n\nBody.\n";
  await boot(page, { text });
  const cdp = await page.context().newCDPSession(page);
  await page.locator("#content h2 [data-text-from]").click();
  await page.keyboard.press("End");
  await page.evaluate(() => {
    const anchor = getSelection().anchorNode;
    window.__typed = {
      section: anchor.parentElement.closest(".note-section"),
      body: document.querySelector("#content h2 ~ .section-body p"),
      node: anchor,
      events: [],
    };
    for (const type of ["focusout", "focusin"])
      document.addEventListener(type, () => window.__typed.events.push(type), {
        capture: true,
      });
  });
  // Typing changes the heading's id (its anchor), and so its section's.
  for (const [pinyin, word] of [
    ["zhong", "中"],
    ["wen", "文"],
  ]) {
    await cdp.send("Input.imeSetComposition", {
      text: pinyin,
      selectionStart: pinyin.length,
      selectionEnd: pinyin.length,
    });
    await cdp.send("Input.insertText", { text: word });
    await page.waitForTimeout(1000);
  }
  expect(await source(page)).toContain("## Sub heading中文\n\nBody.");
  await expect(page.locator("#content h2")).toHaveAttribute(
    "id",
    "sub-heading中文",
  );
  expect(
    await page.evaluate(() => {
      const { section, body, node, events } = window.__typed;
      return {
        section: section.isConnected,
        body: body.isConnected,
        node: getSelection().anchorNode === node,
        events,
      };
    }),
  ).toEqual({ section: true, body: true, node: true, events: [] });
  // Enter at its end: a paragraph first in its section, typed into.
  await page.keyboard.press("Enter");
  await page.keyboard.type("new");
  expect(await source(page)).toContain("## Sub heading中文\n\nnew\n\nBody.");
  await expect(
    page.locator("#content h2 ~ .section-body > p").first(),
  ).toHaveText("new");
});

test("a fenced code block takes typing: Enter keeps the indentation, Tab indents, the fences stay", async ({
  page,
}) => {
  const fence = "```js\nif (a) {\n  x = 1;\n}\n```";
  const text = `# Code\n\nPara.\n\n${fence}\n\n- item\n\n  \`\`\`js\n  inlist()\n  \`\`\`\n`;
  await boot(page, { text });
  // In a list the code is indented in the source: it keeps to the pencil.
  await expect(page.locator("#content .code-direct")).toHaveCount(1);
  await expect(page.locator("#content li pre")).not.toHaveAttribute(
    "contenteditable",
    "true",
  );
  const caretAfter = (needle) =>
    page.evaluate((needle) => {
      const code = document.querySelector("#content .code-direct code");
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) && !node.data.includes(needle));
      code.closest("pre").focus();
      getSelection().collapse(node, node.data.indexOf(needle) + needle.length);
    }, needle);
  await caretAfter(";");
  await page.keyboard.press("Enter");
  await page.keyboard.type("y = 2;");
  expect(await source(page)).toContain("  x = 1;\n  y = 2;\n}\n```");
  await page.keyboard.press("Tab");
  await page.keyboard.type("z");
  expect(await source(page)).toContain("  y = 2;  z\n}");
  await page.keyboard.press("Shift+Tab");
  expect(await source(page)).toContain("\ny = 2;  z\n}");
  // After a pause the block renders again; typing goes on in place.
  await page.waitForTimeout(900);
  await page.keyboard.type("!");
  expect(await source(page)).toContain("\ny = 2;  z!\n}");
  // Backspace at the code's start, Delete at its end: nothing joins.
  const before = await source(page);
  await caretAfter("if");
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Control+End");
  expect(await source(page)).toBe(before);
  // A selection reaching out of the block is refused.
  await paragraph(page, "Para").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.type("Q");
  expect(await source(page)).toBe(before);
  // Copying the code still gives the source's text.
  expect(
    await page
      .locator("#content .code-direct code")
      .evaluate((el) => el.textContent.endsWith("}\n")),
  ).toBe(true);
});

// Where the caret is: the text of the block holding it, and whether a new
// empty paragraph was made.
const caretBlock = (page) =>
  page.evaluate(() => {
    const node = getSelection().anchorNode;
    const el = node.nodeType === 1 ? node : node.parentElement;
    return {
      block: el.closest("[data-direct-host]")?.textContent.trim(),
      made: document.querySelectorAll("#content .direct-empty-block").length,
    };
  });
const caretIn = (page, needle, { before = false } = {}) =>
  page.evaluate(
    ({ needle, before }) => {
      const walker = document.createTreeWalker(
        document.querySelector("#content"),
        NodeFilter.SHOW_TEXT,
      );
      let node;
      while ((node = walker.nextNode()) && !node.data.includes(needle));
      node.parentElement.closest("[data-direct-host]").focus();
      const at = node.data.indexOf(needle);
      getSelection().collapse(node, before ? at : at + needle.length);
    },
    { needle, before },
  );

test("a formula holding the caret shows its source; the caret never leaves the paragraph", async ({
  page,
}) => {
  const text = "# Title\n\nFirst para.\n\n若满足$a=1$即可。\n\nSee here.\n";
  await boot(page, { text });
  // A "$" typed before a formula pairs with its opening "$": the caret is
  // inside the new formula, which shows as source.
  await caretIn(page, "若");
  await page.keyboard.type("$b");
  expect(await source(page)).toContain("若$b满足$a=1$即可。");
  await page.waitForTimeout(900);
  expect(await caretBlock(page)).toEqual({
    block: "若$b满足$a=1$即可。",
    made: 0,
  });
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(page.locator("#content .formula")).toHaveCount(1);
  // "$$", then into it, then the formula: typed as text, typeset once the
  // caret leaves it.
  await caretIn(page, "See");
  await page.keyboard.type(" $$");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("f(x)");
  await page.waitForTimeout(900);
  expect(await caretBlock(page)).toEqual({
    block: "See $f(x)$ here.",
    made: 0,
  });
  await expect(page.locator("#content .formula-source")).toHaveText("$f(x)$");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#content .formula")).toHaveCount(2);
  await page.keyboard.type("!");
  expect(await source(page)).toContain("See $f(x)$! here.");
});

test("a click or an arrow key opens a formula's source; a display formula edits as lines", async ({
  page,
}) => {
  const text =
    "# Title\n\nThe value $x^2$ here.\n\n$$\na+b\n$$\n\nHello $y$\n\n$z$\n\nLast.\n";
  await boot(page, { text });
  // A click: the caret before the closing "$".
  await page.locator("#content .formula .mord").first().click();
  await expect(page.locator("#content .formula-source")).toHaveText("$x^2$");
  await page.keyboard.type("+1");
  expect(await source(page)).toContain("The value $x^2+1$ here.");
  // Leaving it typesets it again.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#content .formula-source")).toHaveCount(0);
  // ArrowLeft from after a formula: into it, before its closing "$".
  await caretIn(page, "Hello");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("1");
  expect(await source(page)).toContain("Hello $y1$");
  // From the next block, ArrowLeft lands after a paragraph's only formula.
  await caretIn(page, "Last", { before: true });
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("!");
  expect(await source(page)).toContain("\n\n$z$!\n\nLast.");
  // A display formula: Enter adds a line inside it, no new paragraph.
  await page.locator("#content .math-block .mord").first().click();
  await expect(page.locator("#content .math-source")).toHaveText("$$\na+b\n$$");
  await page.keyboard.press("Enter");
  await page.keyboard.type("c");
  expect(await source(page)).toContain("$$\na+b\nc\n$$");
  await caretIn(page, "Last");
  await expect(page.locator("#content .math-source")).toHaveCount(0);
  await expect(page.locator("#content .math-block")).toHaveCount(1);
});

test("$$ at a line's start does not take the notes below it", async ({
  page,
}) => {
  const text =
    "# Title\n\nline one\n$$line two\n\n## H\n\nMore.\n\n$$\nx\n$$\n\nLast.\n";
  await boot(page, { text });
  await expect(page.locator("#content .math-block")).toHaveCount(1);
  await expect(page.locator("#content h2")).toHaveCount(1);
  await expect(paragraph(page, "line one")).toContainText("$$line two");
});

test("arrow keys cross a heading's edges and step out of emphasis at a block's end", async ({
  page,
}) => {
  const text = "# Title\n\nIntro.\n\n## Head\n\nEnds in **bold**\n";
  await boot(page, { text });
  await caretIn(page, "Head", { before: true });
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("L");
  await caretIn(page, "Head");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("R");
  expect(await source(page)).toContain("Intro.L\n\n## Head\n\nREnds");
  // The caret at the bold text's end stays in it; ArrowRight steps out.
  await caretIn(page, "bold");
  await page.keyboard.type("er");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type(" plain");
  expect(await source(page)).toContain("REnds in **bolder** plain\n");
});

test("emptying a code span takes its markers; an escape keeps its place", async ({
  page,
}) => {
  const text = "# Title\n\nCode `a` here.\n\nA \\* star.\n";
  await boot(page, { text });
  await page.evaluate(() => {
    const code = document.querySelector("#content p code").firstChild;
    code.parentElement.closest("[data-direct-host]").focus();
    getSelection().collapse(code, 1);
  });
  await page.keyboard.press("Backspace");
  expect(await source(page)).toContain("Code  here.");
  await page.evaluate(() => {
    const escape = document.querySelector("#content .md-escape");
    escape.closest("[data-direct-host]").focus();
    getSelection().collapse(escape.firstChild, 0);
  });
  await page.keyboard.type("Q");
  expect(await source(page)).toContain("A Q\\* star.");
});

test("Enter on an empty item leaves the list; a new task item takes typing in the list; an empty paragraph keeps the focus", async ({
  page,
}) => {
  const text = "# Title\n\n- one\n\n- [ ] task\n\nFirst para.\n\nLast.\n";
  await boot(page, { text });
  await caretIn(page, "one");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Hello");
  await page.waitForTimeout(900);
  expect(await source(page)).toMatch(/- one\n\nHello\n/);
  await expect(
    page.locator("#content p").filter({ hasText: "Hello" }),
  ).toHaveCount(1);
  await expect(paragraph(page, "Hello")).toHaveText("Hello");
  // After a task, Enter starts a task item; typing goes into it.
  await caretIn(page, "task");
  await page.keyboard.press("Enter");
  await expect(page.locator("#content li.task-list-item")).toHaveCount(2);
  await page.keyboard.type("next");
  expect(await source(page)).toContain("- [ ] task\n- [ ] next");
  // An empty paragraph made by Enter keeps the focus over the pause render.
  await caretIn(page, "First para.");
  await page.keyboard.press("Enter");
  await page.evaluate(() => {
    window.__focus = [];
    for (const type of ["focusout", "focusin"])
      document.addEventListener(type, () => window.__focus.push(type), {
        capture: true,
      });
  });
  await page.waitForTimeout(1000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "xin",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await cdp.send("Input.insertText", { text: "新" });
  expect(await page.evaluate(() => window.__focus)).toEqual([]);
  expect(await source(page)).toContain("First para.\n\n新\n\nLast.");
});

test("an empty note and a newly created note take direct typing, headings and display math without duplicate rendering", async ({
  page,
}) => {
  await boot(page, { text: "", editSplit: false });
  // Clicking the blank reader area of an empty note places the caret at 0.
  await page.locator("#reader").click({ position: { x: 120, y: 200 } });
  await page.keyboard.type("# ");
  // `# ` transforms into h1 immediately on Space, before the pause render.
  await expect(page.locator("#content h1")).toHaveCount(1);
  await expect(page.locator("#content p")).toHaveCount(0);
  await page.keyboard.type("Heading");
  await page.waitForTimeout(800);
  await expect(page.locator("#content h1")).toHaveCount(1);
  await expect(page.locator("#content p")).toHaveCount(0);
  expect(await source(page)).toBe("# Heading");

  // Upgrade h1 -> h2 by typing `#` at the start of the heading, and insert a paragraph above with Enter.
  await page.keyboard.press("Home");
  await page.keyboard.type("#");
  await expect(page.locator("#content h2")).toHaveCount(1);
  expect(await source(page)).toBe("## Heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Intro");
  await page.waitForTimeout(800);
  expect(await source(page)).toBe("Intro\n\n## Heading");
  await expect(
    page.locator("#content p").filter({ hasText: "Intro" }),
  ).toHaveCount(1);
  await expect(page.locator("#content h2")).toHaveCount(1);

  // Typing multi-line display math with Enter, and inline $$x^2$$ without premature $x^2$ split.
  await page.locator("#content h2 [data-text-from]").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("$$");
  await page.keyboard.press("Enter");
  await page.keyboard.type("a+b=c");
  await page.keyboard.press("Enter");
  await page.keyboard.type("$$");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Next $$x^2$$ end.");
  await page.waitForTimeout(800);
  expect(await source(page)).toBe(
    "Intro\n\n## Heading\n\n$$\na+b=c\n$$\n\nNext $$x^2$$ end.",
  );
  await expect(page.locator("#content .math-block")).toHaveCount(1);
  await expect(page.locator("#content .formula")).toHaveCount(1);

  // New note button (#new) focuses direct editing right away when editSplit is off.
  await page.locator("#new").click();
  // The focus comes with the next frame.
  await page.waitForFunction(() =>
    document.querySelector("#content").contains(document.activeElement),
  );
  await page.keyboard.type("# A");
  await expect(page.locator("#content h1")).toHaveCount(1);
  // Deleting the last character of a heading keeps the caret inside the empty h1 across pause renders.
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(800);
  await expect(page.locator("#content h1")).toHaveCount(1);
  await expect(page.locator("#content p")).toHaveCount(0);
  // Backspace in an empty heading removes `# ` and turns it back into a paragraph.
  await page.keyboard.press("Backspace");
  await page.keyboard.type("Fresh note");
  await page.waitForTimeout(800);
  await expect(page.locator("#content h1")).toHaveCount(0);
  await expect(
    page.locator("#content p").filter({ hasText: "Fresh note" }),
  ).toHaveCount(1);
});

test("Enter splits a paragraph at a later line's start; display math at the note's start; a heading's level with wide spacing", async ({
  page,
}) => {
  await boot(page, { text: "Top.\n\nfoo\nbar\n\n#  Title" });
  await page.locator("#content p").filter({ hasText: "bar" }).click();
  await page.keyboard.press("End");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await page.keyboard.type("X");
  await page.waitForTimeout(800);
  expect(await source(page)).toBe("Top.\n\nfoo\n\n\nXbar\n\n#  Title");
  await page.locator("#content h1 [data-text-from]").click();
  await page.keyboard.press("Home");
  await page.keyboard.type("#");
  await expect(page.locator("#content h2")).toHaveCount(1);
  expect(await source(page)).toBe("Top.\n\nfoo\n\n\nXbar\n\n##  Title");
  await page.locator("#content p").filter({ hasText: "Top." }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await page.keyboard.type("$$");
  await page.keyboard.press("Enter");
  await page.keyboard.type("a+b");
  await page.keyboard.press("Enter");
  await page.keyboard.type("$$");
  await page.waitForTimeout(800);
  expect(await source(page)).toMatch(/^\$\$\na\+b\n\$\$\n\nTop\./);
  await expect(
    page.locator("#content .math-block, #content .math-source"),
  ).toHaveCount(1);
});
