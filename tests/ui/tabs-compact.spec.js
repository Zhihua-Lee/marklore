import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Many tabs in a strip narrower than a browser's: they shrink almost to a
// circle showing their first character, the current one stays readable, and
// a group is labelled by a small pill as wide as its name.
async function boot(page, count = 22) {
  await page.setViewportSize({ width: 1280, height: 400 });
  await installFolio(page);
  await page.addInitScript((count) => {
    const doc = (id, name, groupId) => ({
      id,
      name: name + ".md",
      fileId: id,
      groupId,
      mode: "read",
      document: {
        id,
        name: name + ".md",
        path: "C:/s/" + name + ".md",
        version: "1",
        text: "# " + name + "\n",
      },
    });
    const names =
      "傅里叶 卷积 采样 拉普拉斯 阅读 概率 线性 实验 论文 参考 会议 待办 Week3 Homework 复习 草稿 数据 图表 附录 摘要 引言 方法".split(
        " ",
      );
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [],
        restored: names
          .slice(0, count)
          .map((n, i) => doc("d" + i, n, i < 3 ? "g1" : i < 5 ? "g2" : null)),
        roots: [],
        active: "d5",
        settings: {
          sidebar: false,
          tabGroups: [
            { id: "g1", name: "信号处理", color: "green" },
            { id: "g2", name: "TA", color: "blue", collapsed: true },
          ],
        },
      }),
    });
  }, count);
  await page.goto("/");
  await page.locator("#tabs .tab").first().waitFor();
}
const tab = (page, name) =>
  page.locator("#tabs .tab").filter({ has: page.getByRole("tab", { name }) });

test("narrow tabs show their first character; all fit; the current one is readable", async ({
  page,
}) => {
  await boot(page);
  await expect(page.locator(".topbar")).not.toHaveAttribute(
    "data-overflow",
    "true",
  );
  const narrow = tab(page, "线性.md");
  const look = await narrow.evaluate((el) => {
    const label = el.querySelector(".tab-label");
    return {
      width: el.getBoundingClientRect().width,
      initial: getComputedStyle(label, "::before").content,
      close: getComputedStyle(el.querySelector(".tab-close")).display,
    };
  });
  expect(look.width).toBeLessThanOrEqual(56);
  expect(look.width).toBeGreaterThanOrEqual(28);
  expect(look.initial).toBe('"线"');
  expect(look.close).toBe("none");
  // The full name is still what assistive technology and the tooltip get.
  await expect(narrow.getByRole("tab")).toHaveAttribute(
    "title",
    "C:/s/线性.md",
  );
  const current = await tab(page, "概率.md").evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  expect(current).toBeGreaterThanOrEqual(100);
});

test("a group's label is a pill as wide as its name; folded it shows a count", async ({
  page,
}) => {
  await boot(page, 8);
  const pill = page.locator(".tab-group").first();
  await expect(pill).toHaveText("信号处理");
  const box = await pill.evaluate((el) => {
    const r = el.getBoundingClientRect(),
      t = document.querySelector("#tabs .tab").getBoundingClientRect();
    return {
      height: r.height,
      tab: t.height,
      width: r.width,
      text: el.scrollWidth,
    };
  });
  expect(box.height).toBeLessThan(box.tab);
  expect(box.width).toBeLessThanOrEqual(box.text + 1);
  await expect(page.locator(".tab-group").nth(1)).toHaveText("TA · 2");
});

test("a middle click closes a tab", async ({ page }) => {
  await boot(page, 8);
  await expect(page.locator("#tabs .tab")).toHaveCount(8);
  await tab(page, "实验.md").click({ button: "middle" });
  await expect(page.locator("#tabs .tab")).toHaveCount(7);
  await expect(page.getByRole("tab", { name: "实验.md" })).toHaveCount(0);
});
