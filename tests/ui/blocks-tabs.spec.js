import { test, expect } from "@playwright/test";

const sample =
  '# Blocks\n\n[Preview](Beta.md)\n\n```js\nconst greeting = "你好";\n\tconsole.log(greeting);\n```\n\n```unknown-language\n<raw> & exact\n```\n\n> Quoted **emphasis**\n\n| A | B |\n| - | - |\n| $x^2$ | value |\n\n- [x] done\n- [ ] todo\n\n<details><summary>Proof</summary>\n\nHidden $x+1$.\n\n</details>\n\nNote[^1].\n\n[^1]: Footnote text.\n\n---\n\n$$\nx^2+1\n$$\n';
async function boot(page) {
  await page.addInitScript((sample) => {
    const files = ["Alpha", "Beta", "Gamma"].map((name, i) => ({
      id: String(i),
      name: name + ".md",
      path: "C:/fixture/" + name + ".md",
      text: sample,
      version: "v1",
    }));
    window.mock = { handlers: {}, copied: [], files, drops: [] };
    window.folio = {
      on: (name, callback) => (window.mock.handlers[name] = callback),
      ready: async () => {
        const saved = JSON.parse(
          localStorage.getItem("blocks-session") || "null",
        );
        return {
          incoming: saved ? [] : files,
          restored: saved
            ? saved.tabs.map((t) => ({
                ...t,
                document: files.find((f) => f.id === t.fileId),
              }))
            : [],
          roots: [],
          settings: saved?.settings,
          active: saved?.active,
        };
      },
      read: async () => ({ unchanged: true }),
      list: async () => [],
      session: async (state) => {
        window.mock.saved = state;
        localStorage.setItem("blocks-session", JSON.stringify(state));
      },
      preview: async () => files[1],
      copyText: async (text) => {
        if (window.mock.copyError) throw Error("Denied");
        window.mock.copied.push(text);
      },
      openDroppedFiles: async (items) => {
        window.mock.drops.push(items.map((f) => f.name));
        return {
          documents: [
            files[0],
            {
              id: "new",
              name: "Dropped.md",
              path: "C:/fixture/Dropped.md",
              text: "# Dropped",
              version: "v1",
            },
          ],
          errors: [],
        };
      },
    };
  }, sample);
  await page.goto("/");
  await expect(page.getByRole("tab")).toHaveCount(3);
}

test("code blocks copy exact text and other block types retain semantics in both themes", async ({
  page,
}) => {
  await boot(page);
  const first = page.locator("#content .code-block").first();
  await expect(
    first.locator(".code-toolbar > span:not(.code-actions)"),
  ).toHaveText("js");
  const firstCopy = first.locator(".code-copy");
  await expect(firstCopy).toHaveAttribute("aria-label", "复制代码");
  await expect(
    first.getByRole("button", { name: "自动换行", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await firstCopy.click();
  await expect(firstCopy).toHaveText("已复制");
  await expect(firstCopy).toHaveAttribute("aria-label", "已复制代码");
  expect(await page.evaluate(() => window.mock.copied)).toEqual([
    'const greeting = "你好";\n\tconsole.log(greeting);\n',
  ]);
  await expect(firstCopy).toBeEnabled();
  await expect(firstCopy).toHaveAttribute("aria-label", "复制代码");
  const second = page.locator("#content .code-block").nth(1),
    secondCopy = second.locator(".code-copy");
  await expect(second.locator("code")).toHaveText("<raw> & exact\n");
  await page.evaluate(() => (window.mock.copyError = true));
  await secondCopy.click();
  await expect(page.locator("#toast")).toContainText("复制失败");
  await expect(secondCopy).toBeEnabled();
  await expect(secondCopy).toHaveAttribute("aria-label", "复制代码");
  await page.evaluate(() => (window.mock.copyError = false));
  await secondCopy.click();
  await expect(secondCopy).toHaveText("已复制");
  expect(await page.evaluate(() => window.mock.copied)).toEqual([
    'const greeting = "你好";\n\tconsole.log(greeting);\n',
    "<raw> & exact\n",
  ]);
  await expect(page.locator("#content blockquote strong")).toHaveText(
    "emphasis",
  );
  await expect(page.locator("#content table td .katex")).toHaveCount(1);
  await expect(page.locator("#content input[type=checkbox]")).toHaveCount(2);
  const task = await page
    .locator("#content .task-list-item")
    .first()
    .evaluate((el) => {
      const checkbox = el.querySelector("input").getBoundingClientRect();
      return {
        width: checkbox.width,
        listStyle: getComputedStyle(el).listStyleType,
        rowHeight: el.getBoundingClientRect().height,
      };
    });
  expect(task.width).toBeLessThan(20);
  expect(task.listStyle).toBe("none");
  expect(task.rowHeight).toBeLessThan(40);
  await page.locator("#content summary").click();
  await expect(page.locator("#content details")).toHaveAttribute("open", "");
  await expect(page.locator("#content .footnote-item")).toHaveCount(1);
  await expect(page.locator("#content hr:not(.footnotes-sep)")).toHaveCount(1);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    const styles = await first.locator("pre").evaluate((el) => ({
      weight: getComputedStyle(el).fontWeight,
      code: getComputedStyle(el.querySelector("code")).fontFamily,
    }));
    expect(styles.weight).toBe("400");
    expect(styles.code).toContain("JetBrains");
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/blocks-${theme}-v014.png` });
  }
});

test("hover-preview zoom is independent, preserves the main page and remembers its value", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("link", { name: "Preview", exact: true }).hover();
  const card = page.locator("#link-preview");
  await expect(card).toBeVisible();
  const size = () =>
    page.locator("#content").evaluate((el) => getComputedStyle(el).fontSize);
  const mainSize = await size();
  await card.getByRole("button", { name: "放大预览字号" }).click();
  await expect(card.locator('button[data-zoom="0"]')).toHaveText("110%");
  expect(await size()).toBe(mainSize);
  await card
    .getByRole("button", { name: "复制代码", exact: true })
    .first()
    .click();
  await expect
    .poll(() => page.evaluate(() => window.mock.copied.length))
    .toBe(1);
  await card.getByRole("button", { name: "关闭链接预览" }).click();
  await page.getByRole("link", { name: "Preview", exact: true }).hover();
  await expect(card.locator('button[data-zoom="0"]')).toHaveText("110%");
  await expect
    .poll(() => page.evaluate(() => window.mock.saved?.settings.previewZoom))
    .toBe(110);
});

test("tabs shrink, reorder by drag, persist order and keep edge-close glyphs out of view", async ({
  page,
}) => {
  await boot(page);
  const before = await page.locator(".tab").first().boundingBox();
  await page.setViewportSize({ width: 820, height: 800 });
  expect((await page.locator(".tab").first().boundingBox()).width).toBeLessThan(
    before.width,
  );
  await page.setViewportSize({ width: 1360, height: 900 });
  const first = await page.getByRole("tab").nth(0).boundingBox(),
    last = await page.getByRole("tab").nth(2).boundingBox();
  await page.mouse.move(first.x + 20, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 5, last.y + last.height / 2, {
    steps: 10,
  });
  await page.waitForTimeout(80);
  await page.mouse.up();
  await expect
    .poll(() => page.getByRole("tab").allTextContents())
    .toEqual(["Beta.md", "Gamma.md", "Alpha.md"]);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Gamma.md",
  );
  await expect
    .poll(() => page.evaluate(() => window.mock.saved?.tabs.map((t) => t.name)))
    .toEqual(["Beta.md", "Gamma.md", "Alpha.md"]);
  await page.reload();
  await expect
    .poll(() => page.getByRole("tab").allTextContents())
    .toEqual(["Beta.md", "Gamma.md", "Alpha.md"]);
  await page.setViewportSize({ width: 480, height: 800 });
  await page.locator("#tabs").evaluate((el) => (el.scrollLeft = 65));
  await expect(page.locator(".edge-clipped .tab-close").first()).toBeHidden();
  await page.getByRole("tab", { selected: true }).focus();
  await page.keyboard.press("Control+Shift+ArrowLeft");
  await expect(page.getByRole("tab").first()).toHaveText("Gamma.md");
});

test("file drop opens multiple documents without duplicating an already open file", async ({
  page,
}) => {
  await boot(page);
  const data = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["# Drop"], "Dropped.md", { type: "text/markdown" }),
    );
    return transfer;
  });
  await page.dispatchEvent("body", "dragenter", { dataTransfer: data });
  await expect(page.locator("body")).toHaveClass(/file-drop/);
  await page.dispatchEvent("body", "drop", { dataTransfer: data });
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(page.locator("#content h1")).toContainText("Dropped");
  await expect(page.locator("body")).not.toHaveClass(/file-drop/);
});

test("panel switches remain fixed while sidebars open and close", async ({
  page,
}) => {
  await boot(page);
  for (const id of ["sidebar-toggle", "outline-toggle"]) {
    const button = page.locator("#" + id),
      before = await button.boundingBox();
    await button.click();
    await page.waitForTimeout(180);
    const after = await button.boundingBox();
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
    await button.click();
    await page.waitForTimeout(180);
    expect((await button.boundingBox()).x).toBeCloseTo(before.x, 1);
  }
});
