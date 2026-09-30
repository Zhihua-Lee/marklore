import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Motion comes from the Playwright project: these run with smooth scrolling and
// again under the "reduced-motion" project (see playwright.config.mjs).
async function boot(page) {
  await installFolio(page);
  await page.addInitScript(() => {
    const files = ["A", "B", "C", "D"].map((name, i) => ({
      id: name,
      name: name + ".md",
      path: "C:/fixture/" + name + ".md",
      version: "v1",
      text:
        `# ${name}\n\n` +
        Array.from(
          { length: 35 },
          (_, n) =>
            `## Section ${n}\n\n${("Reading paragraph 中文段落 " + n + ". ").repeat(15)}\n\n[Next note](${["B", "C", "A", "A"][i]}.md#section-12)\n\n`,
        ).join(""),
    }));
    window.mock = { files, handlers: {} };
    window.folio = folioTest.mock({
      ready: async () => {
        const saved = JSON.parse(localStorage.getItem("nav-session") || "null");
        return {
          incoming: saved ? [] : files,
          restored:
            saved?.tabs.map((t) => ({
              ...t,
              document: files.find((f) => f.id === t.fileId),
            })) || [],
          settings: saved?.settings || { sidebar: false, outline: true },
          roots: [],
          active: saved?.active || files[0].path,
        };
      },
      session: async (state) => {
        window.mock.saved = state;
        localStorage.setItem("nav-session", JSON.stringify(state));
      },
      link: async (_id, target) => files.find((f) => f.name === target),
      preview: async (_id, target) => files.find((f) => f.name === target),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("tab", { selected: true })).toHaveText("A.md");
}
const selected = (page) => page.getByRole("tab", { selected: true });
const scroll = (page) => page.locator("#reader").evaluate((el) => el.scrollTop);
// Smooth jumps animate; read a location only once scrolling has come to rest.
async function settled(page) {
  let last = -1;
  await expect
    .poll(
      async () => {
        const now = await scroll(page);
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [120] },
    )
    .toBe(true);
  return last;
}
async function section(page, number) {
  await page
    .locator("#outline")
    .getByRole("button", { name: `Section ${number}`, exact: true })
    .click();
  await expect.poll(() => scroll(page)).toBeGreaterThan(number ? 100 : -1);
  return settled(page);
}
async function appearance(page, name, value) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("combobox", { name, exact: true }).selectOption(value);
  await page.getByRole("button", { name: "关闭设置" }).click();
}
async function createGroup(page, tab, name) {
  await page
    .getByRole("tab", { name: tab, exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "新建分组…", exact: true }).click();
  await page.getByRole("textbox", { name: "分组名称" }).fill(name);
  await page
    .getByRole("dialog", { name: "新建分组", exact: true })
    .getByRole("button", { name: "确定" })
    .click();
}

test("mouse/keyboard history restores linked reading locations without closing or duplicating tabs", async ({
  page,
}) => {
  await boot(page);
  await expect(page.locator(".history-controls")).toBeHidden();
  const a = await section(page, 8);
  await page
    .locator("#section-8")
    .locator("..")
    .getByRole("link", { name: "Next note" })
    .click();
  await expect(selected(page)).toHaveText("B.md");
  await expect.poll(() => scroll(page)).toBeGreaterThan(a);
  const b = await settled(page);
  await page
    .locator("#section-12")
    .locator("..")
    .getByRole("link", { name: "Next note" })
    .click();
  await expect(selected(page)).toHaveText("C.md");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(selected(page)).toHaveText("B.md");
  await expect
    .poll(async () => Math.abs((await scroll(page)) - b))
    .toBeLessThan(5);
  await page.dispatchEvent("body", "mouseup", { button: 3 });
  await expect(selected(page)).toHaveText("A.md");
  await expect
    .poll(async () => Math.abs((await scroll(page)) - a))
    .toBeLessThan(5);
  await page.dispatchEvent("body", "mouseup", { button: 4 });
  await expect(selected(page)).toHaveText("B.md");
  await expect(page.getByRole("tab")).toHaveCount(4);
  await page.getByRole("tab", { name: "D.md", exact: true }).click();
  await appearance(page, "前进 / 后退按钮", "visible");
  await expect(
    page.getByRole("button", { name: "前进", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "后退", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(() => window.mock.saved?.settings.showHistoryButtons),
    )
    .toBe(true);
  await page.reload();
  await expect(page.locator(".history-controls")).toBeVisible();
});

test("current-note scope, closed tabs, edit drafts and dual hardware events are safe", async ({
  page,
}) => {
  await boot(page);
  const first = await section(page, 3);
  await page.getByRole("tab", { name: "B.md", exact: true }).click();
  await page.getByRole("tab", { name: "A.md", exact: true }).click();
  await section(page, 20);
  await appearance(page, "导航范围", "current");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(selected(page)).toHaveText("A.md");
  await expect
    .poll(async () => Math.abs((await scroll(page)) - first))
    .toBeLessThan(5);
  await appearance(page, "导航范围", "all");
  await page.getByRole("tab", { name: "B.md", exact: true }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator("#editor .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("UNSAVED navigation draft");
  await page.getByRole("tab", { name: "C.md", exact: true }).click();
  await page.getByRole("tab", { name: "D.md", exact: true }).click();
  await page.evaluate(() => {
    window.mock.handlers.command("back");
    document.body.dispatchEvent(
      new MouseEvent("mouseup", { button: 3, bubbles: true }),
    );
  });
  await expect(selected(page)).toHaveText("C.md");
  await page.getByRole("button", { name: "关闭 C.md", exact: true }).click();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(selected(page)).toHaveText(/B.md/);
  await expect(page.locator("#editor .cm-content")).toContainText(
    "UNSAVED navigation draft",
  );
  await expect(
    page.getByRole("tab", { name: "C.md", exact: true }),
  ).toHaveCount(0);
});

test("groups rename, collapse, persist, ungroup without closing and preserve dirty content", async ({
  page,
}) => {
  await boot(page);
  await createGroup(page, "A.md", "Analysis 分析");
  await page
    .getByRole("tab", { name: "B.md", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "移入分组 · Analysis 分析" })
    .click();
  const group = page.getByRole("button", {
    name: "分组 Analysis 分析",
    exact: true,
  });
  await expect(group).toContainText("2");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator("#editor .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("GROUP DRAFT");
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator("#editor .cm-content")).toContainText(
    "GROUP DRAFT",
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.mock.saved?.settings.tabGroups[0]?.collapsed),
    )
    .toBe(true);
  await page.reload();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#editor .cm-content")).toContainText(
    "GROUP DRAFT",
  );
  await group.click({ button: "right" });
  await page.getByRole("menuitem", { name: "编辑分组…" }).click();
  await page.getByRole("textbox", { name: "分组名称" }).fill("Linear Algebra");
  await page.getByRole("combobox", { name: "分组颜色" }).selectOption("blue");
  await page
    .getByRole("dialog", { name: "编辑分组" })
    .getByRole("button", { name: "确定" })
    .click();
  const renamed = page.getByRole("button", {
    name: "分组 Linear Algebra",
    exact: true,
  });
  await renamed.click({ button: "right" });
  await page.getByRole("menuitem", { name: "取消分组（保留标签）" }).click();
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(page.locator("#editor .cm-content")).toContainText(
    "GROUP DRAFT",
  );
});

test("dragging into/out of groups, whole-group reordering and escape work at narrow widths", async ({
  page,
}) => {
  await boot(page);
  await createGroup(page, "A.md", "Study");
  async function drag(from, to, escape = false) {
    const a = await from.boundingBox(),
      b = await to.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.8, b.y + b.height / 2, {
      steps: 12,
    });
    await page.waitForTimeout(60);
    if (escape) await page.keyboard.press("Escape");
    await page.mouse.up();
  }
  const group = page.getByRole("button", { name: "分组 Study", exact: true });
  await drag(page.getByRole("tab", { name: "B.md", exact: true }), group);
  await expect(group).toContainText("2");
  await drag(group, page.getByRole("tab", { name: "D.md", exact: true }));
  await expect
    .poll(() => page.getByRole("tab").allTextContents())
    .toEqual(["C.md", "D.md", "A.md", "B.md"]);
  await drag(
    page.getByRole("tab", { name: "B.md", exact: true }),
    page.getByRole("tab", { name: "C.md", exact: true }),
  );
  await expect(group).toContainText("1");
  const order = await page.getByRole("tab").allTextContents();
  await drag(group, page.getByRole("tab", { name: "C.md", exact: true }), true);
  expect(await page.getByRole("tab").allTextContents()).toEqual(order);
  await appearance(page, "前进 / 后退按钮", "visible");
  await page.setViewportSize({ width: 600, height: 800 });
  await group.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".local/groups-light-v019.png" });
  await page.locator("#theme").click();
  await page.screenshot({ path: ".local/groups-dark-v019.png" });
  await page.setViewportSize({ width: 480, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("collapsed sections have unified hover and keyboard feedback without layout shift", async ({
  page,
}) => {
  // Asserts the reduced-motion contract (no transition), so request it explicitly.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boot(page);
  const block = page.locator("#section-0").locator("..");
  await block.locator(":scope > h2 > .fold").click();
  await page.mouse.move(2, 200);
  await page.locator("#reader").focus();
  const heading = block.locator(":scope > h2"),
    rect = await heading.boundingBox();
  const background = await heading.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await heading.hover();
  await expect
    .poll(() => heading.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(background);
  expect(await heading.boundingBox()).toEqual(rect);
  await expect(heading).toHaveCSS("transition-duration", "0s");
  await page.screenshot({ path: ".local/fold-hover-v019.png" });
  await heading.locator(".section-summary").click();
  await expect(block).not.toHaveClass(/collapsed/);
});

test("details cards coordinate border, summary and marker feedback without changing author colors", async ({
  page,
}) => {
  // Asserts the reduced-motion contract (no transition), so request it explicitly.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boot(page);
  await page.evaluate(() =>
    window.mock.handlers.open([
      {
        id: "details",
        name: "Details.md",
        path: "C:/fixture/Details.md",
        version: "v1",
        text: '# Fold cards\n\n<details><summary><span style="color: #ff0000">3.3、3.4 · 扣分 · PDF 第 1 页 · 展开原始答案</span></summary>\n\nAnswer content\n\n<details><summary>Nested</summary>Nested body</details>\n\n</details>',
      },
    ]),
  );
  const card = page.locator("#content details").first(),
    summary = card.locator(":scope > summary");
  await expect(summary).toBeVisible();
  await page.mouse.move(2, 500);
  const rect = await card.boundingBox(),
    border = await card.evaluate((el) => getComputedStyle(el).borderColor);
  const marker = await summary.evaluate(
    (el) => getComputedStyle(el, "::marker").color,
  );
  await summary.hover();
  await expect
    .poll(() => card.evaluate((el) => getComputedStyle(el).borderColor))
    .not.toBe(border);
  await expect
    .poll(() =>
      summary.evaluate((el) => getComputedStyle(el, "::marker").color),
    )
    .not.toBe(marker);
  await expect(summary.locator("span")).toHaveCSS("color", "rgb(255, 0, 0)");
  expect(await card.boundingBox()).toEqual(rect);
  await expect(card).toHaveCSS("transition-duration", "0s");
  await page.screenshot({ path: ".local/details-hover-light-v019.png" });
  await page.locator("#theme").click();
  await summary.hover();
  await page.screenshot({ path: ".local/details-hover-dark-v019.png" });
  await summary.click();
  await expect(card).toHaveAttribute("open", "");
  await expect(card).toContainText("Answer content");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(card).not.toHaveAttribute("open");
  await expect(card).not.toHaveCSS("box-shadow", "none");
});
