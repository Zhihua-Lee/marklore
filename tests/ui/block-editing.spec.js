import { test, expect } from "@playwright/test";
const note =
  "# Title\n\nFirst **paragraph** with $x^2$ and 中文.\n\nSecond paragraph stays exact.\n\n```python\nx = 1\n```\n\n$$\n\\boxed{x^2}\n$$\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<details><summary>Proof</summary>\n\nNested paragraph.\n\n</details>\n";
async function boot(page, text = note) {
  await page.addInitScript((text) => {
    const file = {
      id: "one",
      path: "C:/notes/One.md",
      name: "One.md",
      text,
      version: "v1",
    };
    window.mock = { handlers: {}, disk: text, version: "v1", saved: [] };
    window.folio = {
      on: (name, fn) => (window.mock.handlers[name] = fn),
      ready: async () => {
        const saved = JSON.parse(
          localStorage.getItem("block-session") || "null",
        );
        return saved
          ? {
              incoming: [],
              roots: [],
              settings: saved.settings,
              restored: saved.tabs.map((t) => ({ ...t, document: file })),
            }
          : {
              incoming: [file],
              roots: [],
              restored: [],
              settings: { sidebar: false, outline: false },
            };
      },
      read: async (_id, version) =>
        version === window.mock.version
          ? { unchanged: true }
          : { text: window.mock.disk, version: window.mock.version },
      save: async (_id, text, version) => {
        if (version !== window.mock.version) return { conflict: true };
        window.mock.saved.push(text);
        window.mock.disk = text;
        return { version: window.mock.version };
      },
      session: async (state) => {
        window.mock.session = state;
        localStorage.setItem("block-session", JSON.stringify(state));
      },
      list: async () => [],
      pickImage: async () => ({ url: "assets/picked.png", label: "Picked" }),
      insertImages: async (_id, files) => {
        window.mock.images = files.map((file) => file.name);
        if (window.mock.delayImages)
          await new Promise((resolve) => (window.mock.releaseImages = resolve));
        return {
          images: files.map((file) => ({
            url: "assets/" + file.name,
            label: file.name,
          })),
          errors: [],
        };
      },
      pickFiles: async () => [
        {
          ...file,
          id: "two",
          path: "C:/notes/Two.md",
          name: "Two.md",
          text: "# Other",
        },
      ],
    };
  }, text);
  await page.goto("/");
  await expect(page.getByRole("tab").first()).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
}
async function openBlock(page, selector) {
  await page.locator(selector).first().hover();
  await page.getByRole("button", { name: "就地编辑此块", exact: true }).click();
  await expect(page.locator(".block-editor")).toHaveCount(1);
}
async function replace(page, text) {
  await page.locator(".block-editor .cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(text);
}
async function draft(page) {
  return page.evaluate(
    () => window.mock.session?.tabs.find((t) => t.fileId === "one")?.draft,
  );
}
test("preview paragraph editing changes only the source block and preserves surrounding content", async ({
  page,
}) => {
  await boot(page);
  await page
    .locator("#content p")
    .nth(1)
    .evaluate((el) => (window.untouched = el));
  await openBlock(page, "#content p");
  await replace(page, "New 中文 paragraph");
  await expect(
    page.getByRole("button", { name: "编辑", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => draft(page)).toContain("New 中文 paragraph");
  await expect(page.locator(".block-editor")).toBeVisible();
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "就地加粗" }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator("#content strong").first()).toHaveText(
    "New 中文 paragraph",
  );
  expect(await page.evaluate(() => window.untouched.isConnected)).toBe(true);
  const secondFrom = note
    .replace(
      "First **paragraph** with $x^2$ and 中文.",
      "**New 中文 paragraph**",
    )
    .indexOf("Second paragraph");
  // Retained nodes must receive fresh mappings, not preserve stale offsets.
  expect(await page.evaluate(() => Number(window.untouched.dataset.from))).toBe(
    secondFrom,
  );
  expect(
    await page.evaluate(() =>
      Number(
        window.untouched.querySelector("[data-text-from]").dataset.textFrom,
      ),
    ),
  ).toBe(secondFrom);
  await expect
    .poll(() => draft(page))
    .toBe(
      note.replace(
        "First **paragraph** with $x^2$ and 中文.",
        "**New 中文 paragraph**",
      ),
    );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect(await page.evaluate(() => window.mock.saved[0])).toBe(
    note.replace(
      "First **paragraph** with $x^2$ and 中文.",
      "**New 中文 paragraph**",
    ),
  );
});
test("cancel restores exact original; local undo/redo and global undo survive mode change", async ({
  page,
}) => {
  await boot(page);
  await openBlock(page, "#content p");
  await replace(page, "DRAFT");
  await page.getByRole("button", { name: "就地撤销" }).click();
  await expect(page.locator(".block-editor .cm-content")).toContainText(
    "First",
  );
  await page.getByRole("button", { name: "就地重做" }).click();
  await expect(page.locator(".block-editor .cm-content")).toHaveText("DRAFT");
  await page.keyboard.press("Escape");
  await expect(page.locator(".block-editor")).toHaveCount(0);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect(await page.evaluate(() => window.mock.saved[0])).toBe(note);
  await openBlock(page, "#content p");
  await replace(page, "KEPT");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".block-editor")).toHaveCount(0);
  await expect(page.locator("#editor .cm-content")).toContainText("KEPT");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator("#content p").first()).toContainText("First");
});
test("formula and fenced code use local source without flattening notation", async ({
  page,
}) => {
  await boot(page);
  await openBlock(page, "#content .math-block");
  await expect(page.locator(".block-editor .cm-content")).toContainText(
    "\\boxed{x^2}",
  );
  await replace(page, "$$\n\\frac{1}{2}\n$$");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("#content .math-block .katex")).toHaveCount(1);
  await openBlock(page, "#content .code-block");
  await expect(page.locator(".block-editor .cm-content")).toContainText(
    "```python",
  );
  await replace(page, "```python\nx = 2\n```");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator("#content pre code")).toHaveText("x = 2\n");
  await expect.poll(() => draft(page)).toContain("\\frac{1}{2}");
  await expect(page.locator("#content .math-error")).toHaveCount(0);
});
test("list/table edits keep their complete container; note HTML cannot forge block ranges", async ({
  page,
}) => {
  await boot(page);
  await openBlock(page, "#content li");
  await expect(page.locator(".block-editor .cm-content")).toContainText(
    "- one",
  );
  await expect(page.locator(".block-editor .cm-content")).toContainText(
    "- two",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await openBlock(page, "#content td");
  await expect(page.locator(".block-editor .cm-content")).toContainText(
    "| A | B |",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  const forged = await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js");
    const box = document.createElement("div");
    box.innerHTML = renderMarkdown(
      '<div data-edit-from="0" data-edit-to="100" data-edit-kind="paragraph_open" data-folio-edit="guessed">forged</div>',
    ).html;
    return box.querySelectorAll("[data-edit-from],[data-folio-edit]").length;
  });
  expect(forged).toBe(0);
});
test("switching tabs and reloading recovers in-progress local changes", async ({
  page,
}) => {
  await boot(page);
  await openBlock(page, "#content p");
  await replace(page, "RECOVER 中文");
  await expect.poll(() => draft(page)).toContain("RECOVER 中文");
  await page.reload();
  await expect(page.locator("#content")).toContainText("RECOVER 中文");
  await openBlock(page, "#content p");
  await replace(page, "SWITCH KEEP");
  await page.getByRole("button", { name: "打开文件", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("tab").filter({ hasText: "One.md" }).click();
  await expect(page.locator("#content")).toContainText("SWITCH KEEP");
});
test("external disk changes conflict with local typing and save snapshots include the local draft", async ({
  page,
}) => {
  await boot(page);
  await openBlock(page, "#content p");
  await replace(page, "LOCAL KEEP");
  await page.evaluate(() => {
    window.mock.disk = "# Disk changed";
    window.mock.version = "v2";
    window.mock.handlers.disk({ id: "one" });
  });
  await expect(page.locator("#conflict")).toBeVisible();
  await expect(page.locator(".block-editor .cm-content")).toHaveText(
    "LOCAL KEEP",
  );
  await page.keyboard.press("Control+s");
  await expect(page.locator("#toast")).toContainText("磁盘内容已改变");
  expect(await page.evaluate(() => window.mock.saved)).toEqual([]);
  await expect.poll(() => draft(page)).toContain("LOCAL KEEP");
});
test("keyboard entry, local links and narrow/dark layout are usable", async ({
  page,
}) => {
  await boot(page);
  await page.locator("#reader").focus();
  await page.keyboard.press("Alt+Enter");
  await expect(page.locator(".block-editor")).toBeVisible();
  await page.keyboard.press("Escape");
  await openBlock(page, "#content p");
  await replace(page, "Link label");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+k");
  await page.locator(".block-edit-link input").fill("notes/chapter.md#section");
  await page
    .locator(".block-edit-link")
    .getByRole("button", { name: "插入", exact: true })
    .click();
  await expect(page.locator(".block-editor .cm-content")).toContainText(
    "[Link label](<notes/chapter.md#section>)",
  );
  await page.setViewportSize({ width: 600, height: 800 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.screenshot({ path: ".local/block-edit-dark-v016.png" });
  expect(
    await page
      .locator(".block-editor")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator("#content a").first()).toHaveAttribute(
    "href",
    "notes/chapter.md#section",
  );
});

async function pasteImages(page) {
  await page.locator(".block-editor .cm-content").evaluate((el) => {
    const data = new DataTransfer();
    data.items.add(new File(["test"], "first.png", { type: "image/png" }));
    data.items.add(new File(["test"], "second.png", { type: "image/png" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
}
test("local image batch is undoable and picker shares the same insertion target", async ({
  page,
}) => {
  await boot(page);
  await openBlock(page, "#content p");
  await page.keyboard.press("Control+End");
  await pasteImages(page);
  await expect(page.locator(".block-editor .cm-content")).toContainText(
    "assets/second.png",
  );
  await page.getByRole("button", { name: "就地撤销", exact: true }).click();
  await expect(page.locator(".block-editor .cm-content")).not.toContainText(
    "assets/",
  );
  await page.getByRole("button", { name: "就地插入图片", exact: true }).click();
  await expect(page.locator(".block-editor .cm-content")).toContainText(
    "assets/picked.png",
  );
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect.poll(() => draft(page)).toContain("assets/picked.png");
});
test("pending image import cannot replace later local typing", async ({
  page,
}) => {
  await boot(page);
  await openBlock(page, "#content p");
  await page.evaluate(() => (window.mock.delayImages = true));
  await pasteImages(page);
  await expect
    .poll(() => page.evaluate(() => Boolean(window.mock.releaseImages)))
    .toBe(true);
  await replace(page, "KEEP NEW INPUT");
  await page.evaluate(() => window.mock.releaseImages());
  await expect(page.locator("#toast")).toContainText("未插入到其他位置");
  await expect(page.locator(".block-editor .cm-content")).toHaveText(
    "KEEP NEW INPUT",
  );
});
