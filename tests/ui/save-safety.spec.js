import { test, expect } from "@playwright/test";

async function boot(page, count = 2) {
  await page.addInitScript(
    ({ count }) => {
      const files = Array.from({ length: count }, (_, i) => ({
        id: `file-${i}`,
        path: `C:/synthetic/Note-${i}.md`,
        name: `Note-${i}.md`,
        text: `## Note ${i}\n\nOriginal ${i}`,
        version: "v1",
      }));
      window.mock = {
        files,
        handlers: {},
        saved: [],
        slow: false,
        saveAsCalls: [],
        session: null,
      };
      window.folio = {
        on: (name, handler) => {
          window.mock.handlers[name] = handler;
        },
        ready: async () => ({ incoming: files, restored: [], roots: [] }),
        read: async (id, version) => {
          const file = files.find((f) => f.id === id);
          return version === file.version ? { unchanged: true } : { ...file };
        },
        save: async (id, text, version) => {
          const file = files.find((f) => f.id === id);
          if (file.version !== version) return { conflict: true };
          window.mock.saved.push({ id, text, version });
          if (window.mock.slow) {
            await new Promise((resolve) => {
              window.mock.finishSave = resolve;
            });
          }
          Object.assign(file, { text, version: version + "s" });
          return { version: file.version };
        },
        saveAs: async (text, name, excludedIds) => {
          window.mock.saveAsCalls.push({ text, name, excludedIds });
          if (window.mock.returnCollision) return { ...files[0], text };
          throw Error("目标已在其他标签页打开，请选择其他文件名。");
        },
        session: async (value) => {
          window.mock.session = value;
        },
        pickFiles: async () => [{ ...files[0] }],
        list: async () => [],
        link: async () => null,
      };
    },
    { count },
  );
  await page.goto("/");
  await expect(page.getByRole("tab")).toHaveCount(Math.min(count, 100));
  await expect(page.locator("#content h2")).toBeVisible();
}

async function append(page, text) {
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}

test("save-and-close keeps typing made after the save snapshot", async ({
  page,
}) => {
  await boot(page);
  await append(page, " FIRST-DRAFT");
  await page.evaluate(() => {
    window.mock.slow = true;
  });
  await page
    .getByRole("button", { name: "关闭 Note-1.md", exact: true })
    .click();
  await page
    .locator("#confirm")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.mock.saved.length))
    .toBe(1);
  await append(page, " NEWER-DRAFT");
  await page.evaluate(() => {
    window.mock.slow = false;
    window.mock.finishSave();
  });
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "● Note-1.md",
  );
  await expect(page.locator(".cm-content")).toContainText("NEWER-DRAFT");
  await expect(page.locator("#toast")).toContainText("保存期间有新的修改");
  expect(await page.evaluate(() => window.mock.files[1].text)).not.toContain(
    "NEWER-DRAFT",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.mock.session?.tabs.find((d) => d.fileId === "file-1")?.draft,
      ),
    )
    .toContain("NEWER-DRAFT");
  await page.getByRole("button", { name: "保存", exact: true }).first().click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Note-1.md",
  );
  await page
    .getByRole("button", { name: "关闭 Note-1.md", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(1);
});

test("save conflict displays disk choices without a watcher notification", async ({
  page,
}) => {
  await boot(page);
  await append(page, " MY-DRAFT");
  await page.evaluate(() => {
    Object.assign(window.mock.files[1], {
      text: "## EXTERNAL-REVISION",
      version: "v2",
    });
  });
  await expect(page.locator("#conflict")).toBeHidden();
  await page.getByRole("button", { name: "保存", exact: true }).first().click();
  await expect(page.locator("#conflict")).toBeVisible();
  await expect(
    page.locator("#conflict").getByRole("button", { name: "加载磁盘版本" }),
  ).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("MY-DRAFT");
  expect(await page.evaluate(() => window.mock.saved.length)).toBe(0);
});

test("Save As excludes other open files and rejection preserves both drafts", async ({
  page,
}) => {
  await boot(page);
  await append(page, " SECOND-DRAFT");
  await page.getByRole("tab", { name: "Note-0.md", exact: true }).click();
  await append(page, " FIRST-DRAFT");
  await page.getByRole("tab", { name: "● Note-1.md", exact: true }).click();
  await page.evaluate(() => window.mock.handlers.command("saveAs"));
  await expect(page.locator("#toast")).toContainText("目标已在其他标签页打开");
  expect(
    await page.evaluate(() => window.mock.saveAsCalls[0].excludedIds),
  ).toEqual(["file-0"]);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".cm-content")).toContainText("SECOND-DRAFT");
  await page.getByRole("tab", { name: "● Note-0.md", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("FIRST-DRAFT");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.mock.session?.tabs.filter((d) => d.draft)?.length,
      ),
    )
    .toBe(2);
});

test("unexpected Save As collision never gives two drafts the same native handle", async ({
  page,
}) => {
  await boot(page);
  await append(page, " SECOND-DRAFT");
  await page.getByRole("tab", { name: "Note-0.md", exact: true }).click();
  await append(page, " FIRST-DRAFT");
  await page.getByRole("tab", { name: "● Note-1.md", exact: true }).click();
  await page.evaluate(() => {
    window.mock.returnCollision = true;
    window.mock.handlers.command("saveAs");
  });
  await expect(page.locator("#toast")).toContainText("两份编辑内容均已保留");
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "● Note-1.md",
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.mock.session?.tabs.map((d) => d.fileId)),
    )
    .toEqual(["file-0", "file-1"]);
  expect(
    await page.evaluate(() => window.mock.session.tabs.map((d) => d.draft)),
  ).toEqual([
    expect.stringContaining("FIRST-DRAFT"),
    expect.stringContaining("SECOND-DRAFT"),
  ]);
});

test("100-tab cap rejects new tabs but still activates already-open files", async ({
  page,
}) => {
  await boot(page, 101);
  await expect(page.locator("#toast")).toContainText(
    "最多同时打开 100 个标签页",
  );
  await page.getByRole("button", { name: "新笔记", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(100);
  await page.getByRole("button", { name: "打开文件", exact: true }).click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Note-0.md",
  );
  await expect(page.getByRole("tab")).toHaveCount(100);
  await expect
    .poll(() => page.evaluate(() => window.mock.session?.tabs.length))
    .toBe(100);
});

test("close during a toolbar save leaves the saving document open", async ({
  page,
}) => {
  await boot(page);
  await append(page, " IN-FLIGHT");
  await page.evaluate(() => {
    window.mock.slow = true;
  });
  await page.getByRole("button", { name: "保存", exact: true }).first().click();
  await expect
    .poll(() => page.evaluate(() => window.mock.saved.length))
    .toBe(1);
  await page
    .getByRole("button", { name: "关闭 Note-1.md", exact: true })
    .click();
  await expect(page.locator("#confirm")).toBeHidden();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator("#toast")).toContainText("正在保存");
  await page.evaluate(() => window.mock.finishSave());
  await expect(page.getByRole("tab", { selected: true })).toHaveText(
    "Note-1.md",
  );
});
