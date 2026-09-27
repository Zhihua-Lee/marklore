import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

async function boot(page, { opened = false } = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ opened }) => {
      const text =
        "# Links\n\n[Heading](Other%20%E4%B8%AD%E6%96%87.md#destination) · [Line](Other%20%E4%B8%AD%E6%96%87.md#L9C1) · [Missing](Other%20%E4%B8%AD%E6%96%87.md#absent) · [Denied](../private.md) · [External](https://example.com)\n\n[Slow](Slow.md) · [Fast](Fast.md)";
      const other = {
        id: "other",
        path: "C:/synthetic/Other 中文.md",
        name: "Other 中文.md",
        version: "v1",
        text:
          "# Other\n\nIntroduction\n\n" +
          "A long paragraph. ".repeat(300) +
          "\n\n## Destination\n\nPrecise destination 中文与 $x^2$.\n\n<details><summary>Proof</summary>\n\nHidden proof\n\n</details>",
      };
      window.mock = { other, previews: [], links: [], handlers: {} };
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [
            {
              id: "main",
              path: "C:/synthetic/Main.md",
              name: "Main.md",
              text,
              version: "v1",
            },
          ],
          restored: opened
            ? [
                {
                  document: other,
                  mode: "read",
                  draft: other.text.replace(
                    "Precise destination",
                    "UNSAVED TARGET",
                  ),
                  base: other.text,
                  version: "v1",
                },
              ]
            : [],
          roots: [],
        }),
        read: async (id, version) =>
          version
            ? { unchanged: true }
            : { text: window.mock.other.text, version: "v1" },
        preview: async (id, href) => {
          window.mock.previews.push(href);
          if (href.includes("private")) throw Error("目标位于授权文件夹之外");
          if (href.includes("Slow"))
            await new Promise((r) => (window.releaseSlow = r));
          if (/Slow|Fast/.test(href))
            return {
              ...other,
              id: href,
              name: href,
              path: "C:/synthetic/" + href,
              text: "# " + href,
            };
          return { id: other.id, path: other.path, name: other.name };
        },
        link: async (id, href) => {
          window.mock.links.push({ id, href });
          return window.mock.other;
        },
      });
    },
    { opened },
  );
  await page.goto("/");
  await expect(page.locator("#content h1")).toContainText("Links");
}

test("hover renders target math at heading without tab/progress mutation", async ({
  page,
}) => {
  await boot(page);
  const scroll = await page.locator("#reader").evaluate((el) => el.scrollTop);
  await page.getByRole("link", { name: "Heading", exact: true }).hover();
  const card = page.getByRole("dialog", { name: "链接预览" });
  await expect(card).toBeVisible();
  await expect(card.locator(".preview-title")).toHaveText("Other 中文.md");
  await expect(card.locator(".katex")).toHaveCount(1);
  await expect
    .poll(() =>
      card
        .locator(".preview-scroll")
        .evaluate((el) =>
          Math.abs(
            el.querySelector("#destination").getBoundingClientRect().top -
              el.getBoundingClientRect().top -
              12,
          ),
        ),
    )
    .toBeLessThan(5);
  await expect(page.getByRole("tab")).toHaveCount(1);
  expect(await page.locator("#reader").evaluate((el) => el.scrollTop)).toBe(
    scroll,
  );
  await card.locator("#destination").hover();
  await page.waitForTimeout(350);
  await expect(card).toBeVisible();
  await page.screenshot({ path: "test-results/hover-preview.png" });
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
});

test("hover prioritizes open unsaved content", async ({ page }) => {
  await boot(page, { opened: true });
  await page.getByRole("link", { name: "Heading", exact: true }).hover();
  await expect(page.locator("#link-preview article")).toContainText(
    "UNSAVED TARGET",
  );
  await expect(page.locator(".preview-status")).toContainText("未保存");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(
    page.getByRole("tab", { name: "Main.md", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("line anchors and unavailable anchors are explicit", async ({ page }) => {
  await boot(page);
  await page.getByRole("link", { name: "Line", exact: true }).hover();
  await expect(page.locator("#link-preview article")).toContainText(
    "Precise destination",
  );
  expect(
    await page.locator(".preview-scroll").evaluate((el) => el.scrollTop),
  ).toBeGreaterThan(500);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Missing", exact: true }).hover();
  await expect(page.locator(".preview-status")).toContainText(
    "未找到锚点：absent",
  );
});

test("slow hover cannot replace newer target and fresh hover reads disk again", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("link", { name: "Slow", exact: true }).hover();
  await page.waitForFunction(() => !!window.releaseSlow);
  await page.getByRole("link", { name: "Fast", exact: true }).hover();
  await expect(page.locator(".preview-title")).toHaveText("Fast.md");
  await page.evaluate(() => window.releaseSlow());
  await page.waitForTimeout(100);
  await expect(page.locator(".preview-title")).toHaveText("Fast.md");
  await page.keyboard.press("Escape");
  await page.evaluate(
    () => (window.mock.other.text = "# Destination\n\nFresh external edit"),
  );
  await page.getByRole("link", { name: "Heading", exact: true }).hover();
  await expect(page.locator("#link-preview article")).toContainText(
    "Fresh external edit",
  );
});

test("permission errors stay local, external URLs do not trigger preview", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("link", { name: "Denied", exact: true }).hover();
  await expect(page.locator(".preview-status")).toContainText("授权文件夹之外");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "External", exact: true }).hover();
  await page.waitForTimeout(450);
  await expect(page.locator("#link-preview")).toBeHidden();
  expect(await page.evaluate(() => window.mock.previews)).toEqual([
    "../private.md",
  ]);
});

test("keyboard enters preview and returns to originating link", async ({
  page,
}) => {
  await boot(page);
  const link = page.getByRole("link", { name: "Heading", exact: true });
  await link.focus();
  await expect(page.locator("#link-preview article")).toContainText(
    "Precise destination",
  );
  await page.keyboard.press("F2");
  await expect(page.locator(".preview-scroll")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(link).toBeFocused();
  await page.waitForTimeout(450);
  await expect(page.locator("#link-preview")).toBeHidden();
});

test("explicit Open follows same link and preserves normal tab behavior", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("link", { name: "Heading", exact: true }).hover();
  await expect(page.locator("#link-preview article")).toContainText(
    "Precise destination",
  );
  await page.locator(".preview-open").click();
  await expect(
    page.getByRole("tab", { name: "Other 中文.md", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#link-preview")).toBeHidden();
});

test("replacing the origin during an asynchronous hover cannot leave an orphan card", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("link", { name: "Slow", exact: true }).hover();
  await page.waitForFunction(() => !!window.releaseSlow);
  await page.evaluate(() => {
    document.querySelector('#content a[href="Slow.md"]').remove();
    window.releaseSlow();
  });
  await expect(page.locator("#link-preview")).toBeHidden();
  await expect(page.getByRole("tab")).toHaveCount(1);
});
