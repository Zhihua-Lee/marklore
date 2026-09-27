import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";
import { legacyWelcome } from "../fixtures/legacy-welcome.mjs";
async function boot(page, restored = [], settings = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ restored, settings }) => {
      window.folio = folioTest.mock({
        ready: async () => ({ restored, settings, incoming: [], roots: [] }),
        pickFiles: async () => [
          {
            id: "note",
            name: "思考.md",
            path: "C:/notes/思考.md",
            version: "v1",
            text: "# 观察与记录\n\n让正文成为界面的中心。\n\n## 下一步\n\n- 阅读\n- 整理\n- 推敲",
          },
        ],
      });
    },
    { restored, settings },
  );
  await page.goto("/");
}
test("start page is not a seeded document and last close returns home", async ({
  page,
}) => {
  await boot(page);
  await expect(page.locator("#home")).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    /独立重写|原来的笔记软件|要求已完成|不使用描边/,
  );
  await page.screenshot({ path: "test-results/start-page.png" });
  await page.locator("#start-open").click();
  await expect(
    page.getByRole("tab", { name: "思考.md", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#home")).toBeHidden();
  await page.screenshot({ path: "test-results/product-reading.png" });
  await page.getByRole("button", { name: "关闭 思考.md", exact: true }).click();
  await expect(page.locator("#home")).toBeVisible();
  await page.locator("#start-new").click();
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator(".cm-content")).toBeFocused();
});
test("upgrade retires only the exact untouched welcome and preserves edited or saved notes", async ({
  page,
}) => {
  await boot(page, [{ name: "欢迎.md", content: legacyWelcome }]);
  await expect(page.locator("#home")).toBeVisible();
  await page.close();
});
test("edited welcome remains a document in dark and narrow layouts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 680 });
  await boot(
    page,
    [{ name: "欢迎.md", content: legacyWelcome + "\n我的笔记" }],
    { theme: "dark" },
  );
  await expect(
    page.getByRole("tab", { name: "欢迎.md", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#content")).toContainText("我的笔记");
  expect(
    await page
      .locator(".toolbar")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: "test-results/product-narrow-dark.png" });
});
