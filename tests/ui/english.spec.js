import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// The rest of the suite runs in Chinese (playwright.config.mjs); this spec
// follows an English system and checks the interface carries no Chinese.
test.use({ locale: "en-US" });

const CHINESE = /[\u3400-\u9fff]/;
const note =
  "# Notes\n\nPlain **text** with $x^2$ and a [link](other.md).\n\n```js\nconst a = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [ ] task\n";

async function boot(page, extra = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, extra }) => {
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: extra.empty
            ? []
            : [
                {
                  id: "n",
                  name: "Notes.md",
                  path: "C:/s/Notes.md",
                  version: "1",
                  text,
                },
              ],
          restored: [],
          roots: [],
          settings: extra.settings || {},
        }),
        windowState: async () => ({
          own: true,
          fullScreen: false,
          maximized: false,
        }),
        windowAction: async () => {},
      });
    },
    { text: note, extra },
  );
  await page.goto("/");
}

// Interface text outside the rendered note: text, labels, titles, placeholders.
function chineseInChrome(page, scope = "body") {
  return page.evaluate(
    ({ scope, source }) => {
      const chinese = new RegExp(source);
      const found = [];
      const root = document.querySelector(scope);
      const skip = (el) =>
        el.closest(
          "#content, .cm-editor, #link-preview article, #toast, #interface-language option",
        );
      for (const el of root.querySelectorAll("*")) {
        if (skip(el)) continue;
        for (const name of ["aria-label", "title", "placeholder", "alt"]) {
          const value = el.getAttribute(name);
          if (value && chinese.test(value)) found.push(`${name}: ${value}`);
        }
        for (const node of el.childNodes)
          if (node.nodeType === 3 && chinese.test(node.data))
            found.push(`text: ${node.data.trim()}`);
      }
      return found;
    },
    { scope, source: CHINESE.source },
  );
}

test("an English system gets an English interface", async ({ page }) => {
  await boot(page);
  await expect(page.locator("#content h1")).toContainText("Notes");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
  await expect(page.locator('.modes [data-mode="read"]')).toHaveText("Read");
  await expect(page.getByRole("button", { name: "New note" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Notes.md" })).toBeVisible();
  await expect(page.locator(".window-controls button").first()).toHaveAttribute(
    "aria-label",
    "Full screen",
  );
  expect(await chineseInChrome(page)).toEqual([]);

  // Edit mode: the formatting toolbar and editor chrome.
  await page.locator('.modes [data-mode="edit"]').click();
  await expect(page.locator("#panes")).toHaveAttribute("data-mode", "edit");
  expect(await chineseInChrome(page)).toEqual([]);

  // Find bar and the Aa panel.
  await page.keyboard.press("Control+f");
  await expect(page.locator("#find-bar input")).toBeFocused();
  expect(await chineseInChrome(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.locator("#weight").click();
  await expect(page.locator("#appearance")).toBeVisible();
  await expect(page.locator("#appearance-title")).toHaveText(
    "Appearance & layout",
  );
  expect(await chineseInChrome(page, "#appearance")).toEqual([]);
  // Language names are shown in their own language.
  await expect(
    page.locator("#interface-language option[value='zh']"),
  ).toHaveText("中文");
});

test("the start page and a stored choice", async ({ page }) => {
  await boot(page, { empty: true });
  await expect(page.locator("#home")).toBeVisible();
  expect(await chineseInChrome(page)).toEqual([]);
});

test("choosing Chinese in Aa reloads the interface in Chinese", async ({
  page,
}) => {
  await boot(page);
  await expect(page.locator('.modes [data-mode="read"]')).toHaveText("Read");
  await page.locator("#weight").click();
  await Promise.all([
    page.waitForEvent("load"),
    page.locator("#interface-language").selectOption("zh"),
  ]);
  await expect(page.locator('.modes [data-mode="read"]')).toHaveText("阅读");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe(
    "zh-CN",
  );
});
