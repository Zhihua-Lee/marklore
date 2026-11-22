import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

async function boot(page, { opened = false, settings = {} } = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ opened, settings }) => {
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
          settings,
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
    { opened, settings },
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

test("layout corrections keep an open preview; scrolling the link away closes it", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("link", { name: "Heading", exact: true }).hover();
  const card = page.locator("#link-preview");
  await expect(card).toBeVisible();
  // Content grows above the link and the reader compensates (as late fonts,
  // lazy formulas or table widths do): the link stays put, so must the card.
  await page.evaluate(() => {
    const content = document.querySelector("#content"),
      reader = document.querySelector("#reader"),
      link = [...content.querySelectorAll("a")].find(
        (a) => a.textContent === "Heading",
      );
    const tail = document.createElement("div");
    tail.style.height = "3000px";
    content.append(tail);
    const before = link.getBoundingClientRect().top;
    const grow = document.createElement("div");
    grow.style.height = "300px";
    content.prepend(grow);
    // Compensate by exactly how far the link moved, like restoreAnchor does.
    reader.scrollTop += link.getBoundingClientRect().top - before;
  });
  await page.waitForTimeout(100);
  await expect(card).toBeVisible();
  // A real scroll moves the link; the card closes.
  await page.evaluate(() => {
    document.querySelector("#reader").scrollTop += 200;
  });
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
  await page.waitForTimeout(1100);
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

// Restrained previews (Settings → Navigation & scrolling → Link preview):
// they open only once the pointer rests on a link, never while a mouse
// button is held, shortly after a selection or beside selected text.
const center = async (locator) => {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
// Whether the card opens within ms.
const opens = (page, ms) =>
  page
    .locator("#link-preview")
    .waitFor({ state: "visible", timeout: ms })
    .then(
      () => true,
      () => false,
    );

test("a preview opens only once the pointer rests on the link", async ({
  page,
}) => {
  await boot(page);
  const card = page.locator("#link-preview");
  const fast = page.getByRole("link", { name: "Fast", exact: true });
  const started = Date.now();
  await fast.hover();
  await expect(card).toBeVisible();
  expect(Date.now() - started).toBeGreaterThanOrEqual(650);
  // Leaving it open: closed after a short grace.
  await page.mouse.move(5, 500);
  await expect(card).toBeHidden();
  // Leaving the link before it opened: it does not open.
  await fast.hover();
  await page.waitForTimeout(350);
  await page.mouse.move(5, 500);
  expect(await opens(page, 1200)).toBe(false);
  // Moving along the link starts the wait again.
  const { x, y } = await center(fast);
  await page.mouse.move(x - 8, y);
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(150);
    await page.mouse.move(x - 8 + (i % 2 ? 0 : 12), y);
  }
  await expect(card).toBeHidden();
  await expect(card).toBeVisible();
  // It does not move with the pointer or take the focus.
  const placed = await card.boundingBox();
  await page.mouse.move(x + 6, y);
  expect(await card.boundingBox()).toEqual(placed);
  expect(await card.evaluate((el) => el.contains(document.activeElement))).toBe(
    false,
  );
});

test("no preview while a mouse button is held or a selection is dragged", async ({
  page,
}) => {
  await boot(page);
  const fast = page.getByRole("link", { name: "Fast", exact: true });
  // Pressed on the link and held there.
  const at = await center(fast);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  expect(await opens(page, 1300)).toBe(false);
  await page.mouse.up();
  await page.mouse.move(5, 500);
  // A selection dragged from the heading across the link, let go on it.
  const heading = await center(page.locator("#content h1"));
  const from = { x: heading.x - 20, y: heading.y };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(
      from.x + ((at.x - from.x) * i) / 8,
      from.y + ((at.y - from.y) * i) / 8,
    );
  expect(await opens(page, 1300)).toBe(false);
  await page.mouse.up();
  expect(
    await page.evaluate(() => getSelection().toString().length),
  ).toBeGreaterThan(0);
  // Resting there, the selection holding the link: still none.
  await page.mouse.move(at.x + 2, at.y);
  expect(await opens(page, 1800)).toBe(false);
  expect(await page.evaluate(() => window.mock.previews)).toEqual([]);
});

test("no preview just after a selection, nor beside selected text", async ({
  page,
}) => {
  await boot(page);
  const card = page.locator("#link-preview");
  const fast = page.getByRole("link", { name: "Fast", exact: true });
  // Text selected far from the link: the preview waits until a moment
  // after the selection was made, then opens.
  const started = Date.now();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#content h1"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await fast.hover();
  await expect(card).toBeVisible();
  expect(Date.now() - started).toBeGreaterThanOrEqual(950);
  await page.mouse.move(5, 500);
  await expect(card).toBeHidden();
  // Text selected right beside the link: none while it stays selected.
  await page.evaluate(() => {
    const link = document.querySelector('#content a[href="Fast.md"]');
    const range = document.createRange();
    range.selectNodeContents(link.previousSibling);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.waitForTimeout(1100);
  await fast.hover();
  expect(await opens(page, 1600)).toBe(false);
  // Cleared: the pointer resting again opens it.
  await page.evaluate(() => getSelection().removeAllRanges());
  const { x, y } = await center(fast);
  await page.mouse.move(x + 6, y);
  await expect(card).toBeVisible();
});

test("Ctrl mode opens a preview only while Ctrl is held; off never", async ({
  page,
}) => {
  await boot(page, { settings: { linkPreview: "ctrl" } });
  const card = page.locator("#link-preview");
  const fast = page.getByRole("link", { name: "Fast", exact: true });
  await fast.hover();
  expect(await opens(page, 1300)).toBe(false);
  // Ctrl pressed with the pointer on the link, let go once it opened.
  await page.keyboard.down("Control");
  await expect(card).toBeVisible();
  await page.keyboard.up("Control");
  await page.waitForTimeout(400);
  await expect(card).toBeVisible();
  await page.mouse.move(5, 500);
  await expect(card).toBeHidden();
  // Let go before it opened: it does not open.
  await fast.hover();
  await page.keyboard.down("Control");
  await page.keyboard.up("Control");
  expect(await opens(page, 1000)).toBe(false);
  // Moved onto the link with Ctrl held: it opens.
  await page.mouse.move(5, 500);
  await page.keyboard.down("Control");
  await fast.hover();
  await expect(card).toBeVisible();
  await page.keyboard.up("Control");
  await page.mouse.move(5, 500);
  await expect(card).toBeHidden();
  // Off: neither the pointer, nor Ctrl, nor keyboard focus.
  await page.locator("#weight").click();
  await page.locator("#link-preview-mode").selectOption("off");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await fast.hover();
  await page.keyboard.down("Control");
  expect(await opens(page, 1300)).toBe(false);
  await page.keyboard.up("Control");
  await page.mouse.move(5, 500);
  await page.keyboard.press("Tab");
  await fast.focus();
  expect(await opens(page, 800)).toBe(false);
});
