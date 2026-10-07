import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// Many tabs in a strip narrower than a browser's: they shrink almost to a
// circle, showing as much of their name as fits; the current one stays
// readable, and a group is labelled by a small pill as wide as its name.
async function boot(page, count = 22, width = 1280) {
  await page.setViewportSize({ width, height: 400 });
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

const look = (locator) =>
  locator.evaluate((el) => {
    const label = el.querySelector(".tab-label");
    return {
      width: el.getBoundingClientRect().width,
      initial: getComputedStyle(label, "::before").content,
      close: getComputedStyle(el.querySelector(".tab-close")).display,
      ext: getComputedStyle(label.querySelector(".tab-ext")).display,
      clip: getComputedStyle(label).textOverflow,
    };
  });

test("a narrow tab shows as much of its name as fits, without the extension", async ({
  page,
}) => {
  await boot(page, 14);
  const narrow = tab(page, "线性.md");
  const seen = await look(narrow);
  expect(seen.width).toBeLessThan(84);
  expect(seen.width).toBeGreaterThan(40);
  expect(seen.close).toBe("none");
  expect(seen.ext).toBe("none");
  expect(seen.clip).toBe("clip");
  expect(seen.initial).toBe("none");
  await expect(narrow.getByRole("tab")).toHaveText("线性.md");
});

test("crowded tabs shrink to their first character; all fit; the current one is readable", async ({
  page,
}) => {
  await boot(page, 22);
  await expect(page.locator(".topbar")).not.toHaveAttribute(
    "data-overflow",
    "true",
  );
  const narrow = tab(page, "线性.md");
  const seen = await look(narrow);
  expect(seen.width).toBeLessThanOrEqual(34);
  expect(seen.width).toBeGreaterThanOrEqual(28);
  expect(seen.initial).toBe('"线"');
  expect(seen.close).toBe("none");
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

test("a group's label is a pill as wide as its name; a count only if chosen", async ({
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
  // Folded, it shows just its name; the count is in the tooltip, and on
  // the pill only when Settings asks for it.
  const folded = page.locator(".tab-group").nth(1);
  await expect(folded).toHaveText("TA");
  await expect(folded).toHaveAttribute("title", /2 篇/);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.locator("#group-counts").check();
  await expect(folded).toHaveText("TA · 2");
  await page.locator("#group-counts").uncheck();
  await expect(folded).toHaveText("TA");
});

test("folding slides the tabs (transform only) and redraws the group line after", async ({
  page,
}) => {
  test.skip(
    test.info().project.name === "reduced-motion",
    "no animation with reduced motion",
  );
  await boot(page, 12);
  const pill = page.locator(".tab-group").first();
  const line = () =>
    page.evaluate(
      () => document.querySelectorAll(".tab-group-lines path").length,
    );
  expect(await line()).toBe(1);
  // The animations a fold starts animate positions, never widths.
  const properties = await pill.evaluate((el) => {
    el.click();
    return [
      ...new Set(
        document
          .getAnimations()
          .filter((a) => a.effect.target?.closest?.("#tabs"))
          .flatMap((a) => a.effect.getKeyframes())
          .flatMap((frame) => Object.keys(frame))
          .filter(
            (key) =>
              !["offset", "easing", "composite", "computedOffset"].includes(
                key,
              ),
          ),
      ),
    ].sort();
  });
  expect(properties).toEqual(
    ["opacity", "transform"].filter((p) => properties.includes(p)),
  );
  expect(properties).toContain("transform");
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((a) => a.effect.target?.closest?.("#tabs")).length,
      ),
    )
    .toBe(0);
  // Folded, the group has no line; unfolded, it has it again.
  expect(await line()).toBe(0);
  await pill.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((a) => a.effect.target?.closest?.("#tabs")).length,
      ),
    )
    .toBe(0);
  expect(await line()).toBe(1);
  await expect(page.locator(".tab-group-lines")).toBeVisible();
});

for (const [theme, fill, ink] of [
  // The green group: a soft fill with a deep ink of its hue, per theme.
  ["light", "rgb(207, 227, 217)", "rgb(36, 88, 71)"],
  ["dark", "rgb(43, 60, 54)", "rgb(148, 200, 182)"],
])
  test(`${theme}: group colours follow the theme`, async ({ page }) => {
    await boot(page, 8);
    if (theme === "dark")
      await page.evaluate(
        () => (document.documentElement.dataset.theme = "dark"),
      );
    const pill = page.locator(".tab-group").first();
    await expect(pill).toHaveCSS("background-color", fill);
    await expect(pill).toHaveCSS("color", ink);
  });

test("a middle click closes a tab", async ({ page }) => {
  await boot(page, 8);
  await expect(page.locator("#tabs .tab")).toHaveCount(8);
  await tab(page, "实验.md").click({ button: "middle" });
  await expect(page.locator("#tabs .tab")).toHaveCount(7);
  await expect(page.getByRole("tab", { name: "实验.md" })).toHaveCount(0);
});
