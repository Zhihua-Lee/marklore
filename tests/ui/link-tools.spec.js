import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Linking to places without typing paths: "Copy link to here" (adding an
// anchor where needed) and picking a note's anchor in a link field.
const note = [
  "# Fourier analysis",
  "",
  "## Definition",
  "",
  '<a id="ft-def"></a>',
  "",
  "**Definition（Fourier transform）。** The transform of $f$.",
  "",
  "**Lemma（Unused）。** Nobody links here yet.",
  "",
  "- first item",
  "- **Fact.** second item",
].join("\n");

async function boot(page) {
  await installFolio(page);
  await page.addInitScript((text) => {
    window.mock = { copied: [] };
    window.folio = folioTest.mock({
      ready: async () => ({
        roots: [],
        restored: [],
        incoming: [
          {
            id: "n",
            name: "Fourier.md",
            path: "C:/kb/Fourier.md",
            text,
            version: "1",
          },
        ],
        settings: { sidebar: false },
      }),
      copyText: async (value) => {
        window.mock.copied.push(value);
      },
      linkTargets: async () => [
        {
          name: "Fourier.md",
          rel: "",
          anchors: [
            {
              id: "definition",
              kind: "heading",
              label: "Definition",
              level: 2,
            },
            {
              id: "ft-def",
              kind: "explicit",
              label: "Definition（Fourier transform）",
            },
          ],
        },
        {
          name: "Convolution theorem.md",
          rel: "week 2/Convolution theorem.md",
          anchors: [
            {
              id: "convolution-theorem",
              kind: "heading",
              label: "Convolution theorem",
              level: 1,
            },
            {
              id: "theorem",
              kind: "explicit",
              label: "Theorem（convolution）",
            },
          ],
        },
        { name: "Sampling.md", rel: "Sampling.md", anchors: [] },
      ],
    });
  }, note);
  await page.goto("/");
  await expect(page.locator("#content h1")).toBeVisible();
}
const copied = (page) => page.evaluate(() => window.mock.copied.at(-1));
// The editor's lines joined as in the file (innerText doubles blank lines).
const source = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#editor .cm-line")]
      .map((line) => line.textContent)
      .join("\n"),
  );
async function copyLinkTo(page, locator) {
  await locator.click({ button: "right", position: { x: 30, y: 8 } });
  await page.getByRole("menuitem", { name: "复制指向这里的链接" }).click();
}

test("copy a link to a heading or an anchored definition", async ({ page }) => {
  await boot(page);
  await copyLinkTo(page, page.locator("#content h2"));
  await expect
    .poll(() => copied(page))
    .toBe("[Definition](file:///C:/kb/Fourier.md#definition)");
  await copyLinkTo(
    page,
    page.locator("#content p", { hasText: "Fourier transform" }),
  );
  await expect
    .poll(() => copied(page))
    .toBe("[Definition（Fourier transform）](file:///C:/kb/Fourier.md#ft-def)");
});

test("a paragraph without an anchor gets one, named after its bold lead", async ({
  page,
}) => {
  await boot(page);
  await copyLinkTo(page, page.locator("#content p", { hasText: "Lemma" }));
  const dialog = page.getByRole("dialog", { name: "复制指向这里的链接" });
  const name = dialog.getByRole("textbox", { name: "锚点名称" });
  await expect(name).toHaveValue("lemma-unused");
  // A name already used in the note is refused.
  await name.fill("ft-def");
  await dialog.getByRole("button", { name: "加入锚点并复制" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("这个名称已被本笔记使用");
  await name.fill("lemma");
  await dialog.getByRole("button", { name: "加入锚点并复制" }).click();
  await expect
    .poll(() => copied(page))
    .toBe("[Lemma（Unused）](file:///C:/kb/Fourier.md#lemma)");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect
    .poll(() => source(page))
    .toContain('<a id="lemma"></a>\n\n**Lemma（Unused）。**');
  // A list item takes the anchor at its start.
  await copyLinkTo(
    page,
    page.locator("#content li", { hasText: "second item" }),
  );
  await expect(name).toHaveValue("fact");
  await dialog.getByRole("button", { name: "加入锚点并复制" }).click();
  await expect
    .poll(() => source(page))
    .toContain('- <a id="fact"></a>**Fact.** second item');
  // The new anchors count as anchors of the note.
  await expect(page.locator("#content #lemma")).toHaveCount(1);
});

test("a copied link pasted into a note becomes relative to it", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const paste = (text) =>
    page.evaluate((text) => {
      const editor = document.querySelector("#editor .cm-content");
      editor.focus();
      const data = new DataTransfer();
      data.setData("text/plain", text);
      editor.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, text);
  await page.locator("#editor .cm-line").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await paste("[Other](file:///C:/kb/week%202/Other%20note.md#part)");
  await expect
    .poll(() => source(page))
    .toContain("[Other](week%202/Other%20note.md#part)");
  await page.keyboard.press("Enter");
  await paste("[Self](file:///C:/kb/Fourier.md#ft-def)");
  await expect.poll(() => source(page)).toContain("[Self](#ft-def)");
  await page.keyboard.press("Enter");
  await paste("[Up](file:///C:/notes/Elsewhere.md)");
  await expect
    .poll(() => source(page))
    .toContain("[Up](../notes/Elsewhere.md)");
});

test("the insert-link dialog suggests notes, then their anchors", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator("#editor .cm-line").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "插入链接" }).click();
  const url = page.getByRole("textbox", { name: "链接或文件路径" });
  await url.focus();
  const options = page.locator(".link-picker:visible .link-option");
  await expect(options.first()).toBeVisible();
  await url.fill("conv");
  await options.filter({ hasText: "Convolution theorem" }).first().click();
  // A note opens its anchors.
  await expect(url).toHaveValue("week%202/Convolution%20theorem.md#");
  await options.filter({ hasText: "◇ Theorem（convolution）" }).click();
  await expect(url).toHaveValue("week%202/Convolution%20theorem.md#theorem");
  await expect(page.getByRole("textbox", { name: "显示文字" })).toHaveValue(
    "Theorem（convolution）",
  );
  await page.getByRole("button", { name: "插入", exact: true }).click();
  await expect
    .poll(() => source(page))
    .toContain(
      "[Theorem（convolution）](<week%202/Convolution%20theorem.md#theorem>)",
    );
});

test("the format bar's link field picks an anchor and links at once", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .locator("#content li", { hasText: "first item" })
    .evaluate((li) => {
      const node = [...li.querySelectorAll("[data-text-from]")][0].firstChild;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 5);
      document.querySelector("#reader").focus();
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
  const bar = page.getByRole("toolbar", { name: "选中文字格式" });
  await bar.getByRole("button", { name: "链接", exact: true }).click();
  const url = bar.getByRole("textbox", { name: "链接地址" });
  await url.fill("Fourier");
  await page
    .locator(".link-picker:visible .link-option", {
      hasText: "◇ Definition（Fourier transform）",
    })
    .click();
  await expect.poll(() => source(page)).toContain("- [first](<#ft-def>) item");
});
