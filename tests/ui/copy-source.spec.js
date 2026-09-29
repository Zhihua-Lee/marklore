import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

const note =
  "# Title\n\n" +
  "Plain **bold text** and $x^2$ with [link](https://example.com/a_(b)) end.\n\n" +
  "- [ ] task one\n- item `code` two\n\n" +
  "| Alpha | Beta |\n|---|---|\n| uno | dos |\n\n" +
  "```js\nconst a = 1;\n```\n";

test.beforeEach(async ({ page }) => {
  await installFolio(page);
  await page.addInitScript((text) => {
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [
          {
            id: "n",
            name: "Copy.md",
            path: "C:/synthetic/Copy.md",
            version: "v1",
            text,
          },
        ],
        restored: [],
        roots: [],
        settings: {},
      }),
    });
  }, note);
  await page.goto("/");
  await expect(page.locator("#content .katex").first()).toBeVisible();
});

// Select from the k-th character of `start` to the end of `end` (text found in
// rendered, non-MathML text), or around whole elements; then copy.
function copy(page, spec) {
  return page.evaluate(
    ({ spec, rendered }) => {
      const content = document.querySelector("#content");
      const find = (text) => {
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node.parentElement.closest(".katex-mathml")) continue;
          const at = node.data.indexOf(text);
          if (at >= 0) return { node, at };
        }
        throw Error("No text " + text);
      };
      const range = document.createRange();
      if (spec.element) range.selectNode(content.querySelector(spec.element));
      else if (spec.contents)
        range.selectNodeContents(content.querySelector(spec.contents));
      else {
        const a = find(spec.from),
          b = find(spec.to);
        range.setStart(a.node, a.at);
        range.setEnd(b.node, b.at + spec.to.length);
      }
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const data = new DataTransfer();
      content.dispatchEvent(
        new ClipboardEvent("copy", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
      return {
        text: data.getData("text/plain"),
        html: data.getData("text/html"),
      };
    },
    { spec },
  );
}

test("copying rendered text puts the matching Markdown on the clipboard", async ({
  page,
}) => {
  const plain = async (spec) => (await copy(page, spec)).text;
  // A whole paragraph keeps its emphasis, formula and link destination.
  expect(await plain({ contents: "#content p" })).toBe(
    "Plain **bold text** and $x^2$ with [link](https://example.com/a_(b)) end.",
  );
  // Inside emphasis: just the text. Across its end: the cut marker is dropped.
  expect(await plain({ from: "old te", to: "old te" })).toBe("old te");
  expect(await plain({ from: "text", to: " and" })).toBe("text and");
  // Whole constructs keep their markers; a formula is always whole.
  expect(await plain({ from: "bold text", to: " and" })).toBe(
    "**bold text** and",
  );
  expect(await plain({ element: "#content .formula" })).toBe("$x^2$");
  expect(await plain({ from: "link", to: "link" })).toBe(
    "[link](https://example.com/a_(b))",
  );
  // Across blocks, from a block's first character: line prefixes included.
  expect(await plain({ from: "Title", to: "Plain" })).toBe("# Title\n\nPlain");
  expect(await plain({ from: "task one", to: "two" })).toBe(
    "- [ ] task one\n- item `code` two",
  );
  // A word at the start of a block is just the word.
  expect(await plain({ from: "task", to: "task" })).toBe("task");
  expect(await plain({ from: "Alpha", to: "dos" })).toBe(
    "| Alpha | Beta |\n|---|---|\n| uno | dos",
  );
});

test("code blocks copy as shown and Ctrl+Shift+C keeps a rendered copy", async ({
  page,
}) => {
  // Inside a single code block the browser's own copy (already exact) applies.
  expect((await copy(page, { from: "const", to: ";" })).text).toBe("");
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#content p"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    // Registered after the app's listener, so it sees what the app wrote.
    document.addEventListener(
      "copy",
      (event) => {
        window.copied = {
          prevented: event.defaultPrevented,
          html: event.clipboardData.getData("text/html"),
          text: event.clipboardData.getData("text/plain"),
        };
      },
      { once: true },
    );
  });
  await page.keyboard.press("Control+Shift+C");
  const rendered = await page.evaluate(() => window.copied);
  expect(rendered?.prevented).toBe(true);
  expect(rendered.html).toContain("<strong");
  expect(rendered.text).toContain("Plain bold text and");
  expect(rendered.text).not.toContain("x^2");
});
