import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";
const long = Array.from(
  { length: 70 },
  (_, i) =>
    `## Section ${i}\n\nParagraph ${i} 中文笔记 plain text repeated for source mapping.\n\n$$\nx_{${i}}^2\n$$\n\n`,
).join("");
export async function boot(page, text = long) {
  await installFolio(page);
  await page.addInitScript(
    ({ text }) => {
      window.mock = {
        disk: text,
        version: "v1",
        handlers: {},
        saved: [],
        session: null,
      };
      window.folio = folioTest.mock({
        ready: async () => ({
          restored: [],
          incoming: [
            {
              id: "test-file",
              path: "C:/synthetic/Long.md",
              name: "Long.md",
              text,
              version: "v1",
            },
          ],
          roots: [],
        }),
        read: async (_id, version) =>
          version === window.mock.version
            ? { unchanged: true }
            : { text: window.mock.disk, version: window.mock.version },
        save: async (id, text, version) => {
          if (version !== window.mock.version) return { conflict: true };
          window.mock.saved.push(text);
          window.mock.disk = text;
          window.mock.version += "s";
          return { version: window.mock.version };
        },
        session: async (value) => {
          window.mock.session = value;
        },
        pickFiles: async () => [
          {
            id: "other",
            path: "C:/synthetic/Other.md",
            name: "Other.md",
            text: "# Other\n\nSecond document",
            version: "v1",
          },
        ],
        reveal: async () => {},
        link: async () => null,
      });
    },
    { text },
  );
  await page.goto("/");
  await expect(
    page.getByRole("tab", { name: "Long.md", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#content h2").first()).toBeVisible();
}
test("Read/Edit/Source keep semantic section and tab progress", async ({
  page,
}) => {
  await boot(page);
  await page.locator("#reader").evaluate((el) => {
    const h = el.querySelector("#section-40");
    el.scrollTop +=
      h.getBoundingClientRect().top - el.getBoundingClientRect().top - 32;
  });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator(".cm-editor")).toBeVisible();
  await page.waitForTimeout(150);
  const delta = () =>
    page
      .locator("#reader")
      .evaluate((el) =>
        Math.abs(
          el.querySelector("#section-40").getBoundingClientRect().top -
            el.getBoundingClientRect().top -
            32,
        ),
      );
  expect(await delta()).toBeLessThan(70);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await delta()).toBeLessThan(100);
  await page.getByRole("button", { name: "打开文件", exact: true }).click();
  await page.getByRole("tab", { name: "Long.md", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await delta()).toBeLessThan(100);
});
test("external changes refresh clean document but cannot overwrite dirty content", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    window.mock.disk = "## External\n\nAI updated";
    window.mock.version = "v2";
    window.mock.handlers.disk();
  });
  await expect(page.locator("#content")).toContainText("AI updated");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" my draft");
  await page.evaluate(() => {
    window.mock.disk = "## New external";
    window.mock.version = "v3";
    window.mock.handlers.disk();
  });
  await expect(page.locator("#conflict")).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).first().click();
  expect(await page.evaluate(() => window.mock.saved.length)).toBe(0);
  await expect(page.locator(".cm-content")).toContainText("my draft");
});
test("offline math, details, code, selectable CJK; malicious HTML sanitized", async ({
  page,
}) => {
  await boot(
    page,
    '## Test\n\n中文 **bold** and $a^2$ and \\(b^2\\).\n\n$$\n\\frac{1}{2}\n$$\n\n<details><summary>展开</summary>\n\n隐藏 **内容**\n\n</details>\n\n<script>window.pwned=true</script>\n<img src="x" onerror="window.pwned=true">\n\n```js\nconst a=1;\n```',
  );
  expect(await page.locator("#content .katex").count()).toBe(3);
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  expect(await page.locator("#content script").count()).toBe(0);
  await page.getByText("展开", { exact: true }).click();
  await expect(
    page.locator("#content").getByText("内容", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#content pre")).toContainText("const a=1");
  expect(
    await page
      .locator("#content")
      .evaluate((el) => getComputedStyle(el).userSelect),
  ).toBe("text");
});
test("fold arrows and 50–200% text sizing", async ({ page }) => {
  await boot(page);
  const fold = page.locator("#section-0 .fold");
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(fold).toHaveText("▸");
  await fold.click();
  await expect(fold).toHaveText("▾");
  await page.locator("#weight").click();
  for (let i = 0; i < 10; i++)
    await page.getByRole("button", { name: "缩小字号" }).click();
  await expect(page.locator("#zoom-reset")).toHaveText("50%");
  for (let i = 0; i < 20; i++)
    await page.getByRole("button", { name: "放大字号" }).click();
  await expect(page.locator("#zoom-reset")).toHaveText("200%");
});
test("preview double click enters edit mode and navigates source", async ({
  page,
}) => {
  await boot(page);
  await page.locator("#section-30").scrollIntoViewIfNeeded();
  await page
    .locator("[data-text-from]")
    .filter({ hasText: "Paragraph 30" })
    .dblclick();
  await expect(page.locator("#panes")).toHaveAttribute("data-mode", "edit");
  await expect(page.locator(".cm-editor")).toBeVisible();
  const expectedLine = long
    .slice(0, long.indexOf("Paragraph 30"))
    .split("\n").length;
  await expect(page.locator("#editor-position")).toContainText(
    `行 ${expectedLine} /`,
  );
});
test("same file is deduplicated and unsaved close can be cancelled", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "打开文件", exact: true }).click();
  await page.getByRole("button", { name: "打开文件", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" draft");
  await page.getByRole("button", { name: "关闭 Other.md" }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
});
test("capture a visual review", async ({ page }) => {
  await boot(
    page,
    "## 读懂一页笔记\n\n用清晰的文字，记录值得反复思考的问题。\n\n## 梯度与方向\n\n参数更新 $\\theta$ 时，我们沿着下降方向前进。\n\n$$\n\\theta_{t+1}=\\theta_t-\\eta\\nabla L(\\theta_t)\n$$\n\n> 笔记属于你。文件留在本地。\n\n```python\ntheta = theta - rate * gradient\n```",
  );
  await page.screenshot({ path: "test-results/reading.png" });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.screenshot({ path: "test-results/editing.png" });
});
test("editor navigation controls the return position; undo survives switching tabs", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nUNDO-ME");
  await page.getByRole("button", { name: "打开文件", exact: true }).click();
  await page.getByRole("tab", { name: /Long.md/ }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).not.toContainText("UNDO-ME");
  await page.keyboard.press("Control+End");
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await page.waitForTimeout(200);
  expect(
    await page
      .locator("#reader")
      .evaluate((el) => el.scrollTop / (el.scrollHeight - el.clientHeight)),
  ).toBeGreaterThan(0.9);
});
test("slow refresh cannot overwrite edits made while the disk read is in flight", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.evaluate(() => {
    window.folio.read = () =>
      new Promise((resolve) => (window.mock.finishRead = resolve));
    window.mock.handlers.disk();
  });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" PROTECTED-DRAFT");
  await page.evaluate(() =>
    window.mock.finishRead({ text: "## Stale read", version: "v2" }),
  );
  await page.waitForTimeout(100);
  await expect(page.locator(".cm-content")).toContainText("PROTECTED-DRAFT");
  await expect(page.locator("#content")).not.toContainText("Stale read");
});
test("read progress survives text scale, split resize and collapsed sections", async ({
  page,
}) => {
  await boot(page);
  await page.locator("#section-0 .fold").click();
  await page.locator("#reader").evaluate((el) => {
    const h = el.querySelector("#section-40");
    el.scrollTop +=
      h.getBoundingClientRect().top - el.getBoundingClientRect().top - 32;
  });
  await page.locator("#weight").click();
  await page.getByRole("button", { name: "放大字号" }).click();
  await page.locator("#appearance-close").click();
  await page.waitForTimeout(150);
  const delta = await page
    .locator("#reader")
    .evaluate((el) =>
      Math.abs(
        el.querySelector("#section-40").getBoundingClientRect().top -
          el.getBoundingClientRect().top -
          32,
      ),
    );
  expect(delta).toBeLessThan(100);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("separator").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("separator")).toHaveAttribute(
    "aria-valuenow",
    "55",
  );
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(page.locator("#section-0 .fold")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});
test("mouse drag reorders overflowing tabs without changing selected tab", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() =>
    window.mock.handlers.open(
      Array.from({ length: 15 }, (_, i) => ({
        id: "extra-" + i,
        name: "Notebook " + i + ".md",
        path: "C:/synthetic/extra" + i + ".md",
        text: "# Extra " + i,
        version: "v1",
      })),
    ),
  );
  const start = await page.locator("#tabs").evaluate((host) => {
      const viewport = host.getBoundingClientRect();
      for (const label of host.querySelectorAll(".tab-label")) {
        const box = label.getBoundingClientRect(),
          left = Math.max(box.left, viewport.left),
          right = Math.min(box.right, viewport.right);
        if (right - left > 50)
          return { x: left + 15, y: (box.top + box.bottom) / 2 };
      }
      throw Error("No visible tab label for drag gesture");
    }),
    before = await page.getByRole("tab").allTextContents();
  const active = await page.getByRole("tab", { selected: true }).textContent();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 250, start.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => page.getByRole("tab").allTextContents())
    .not.toEqual(before);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(active);
});
