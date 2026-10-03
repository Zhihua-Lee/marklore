import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

const note = [
  "# Fourier analysis",
  "",
  "Intro with [ok](#definition), [missing note](Missing.md) and [bad anchor](#nope).",
  "",
  "## Definition",
  "",
  '<a id="def-ft"></a>',
  "",
  "**Definition（Fourier transform）。** For integrable $f$, the transform is defined.",
  "",
  '<a id="def-unused"></a>',
  "",
  "**Lemma（Unused）。** Nobody links here yet.",
  "",
  "## Parseval's identity",
  "",
  "Energy is the same in both domains.",
].join("\n");

const entry = (name, fragment, section, line) => ({
  source: "C:/kb/" + name,
  name,
  href: name + "#L" + line + "C1",
  fragment,
  section,
  snippet: `See the <mark class="backlink-hit">${fragment || "note"}</mark> with $x^2$.`,
});

async function boot(page, settings = {}) {
  await installFolio(page);
  await page.addInitScript(
    ({ note, incoming, settings }) => {
      window.mock = { links: [], statusAsked: [] };
      window.folio = folioTest.mock({
        ready: async () => ({
          roots: [],
          restored: [],
          incoming: [
            {
              id: "n",
              name: "Fourier.md",
              path: "C:/kb/Fourier.md",
              text: note,
              version: "1",
            },
          ],
          settings: { sidebar: false, ...settings },
        }),
        backlinks: async () => incoming,
        linkStatus: async (_id, hrefs) => {
          window.mock.statusAsked.push(...hrefs);
          return hrefs.map((href) =>
            href === "Missing.md" ? "missing-file" : "ok",
          );
        },
        link: async (_id, target) => {
          window.mock.links.push(target);
          return null;
        },
      });
    },
    {
      note,
      settings,
      incoming: [
        entry("Convolution.md", "def-ft", "Theorem", 12),
        entry("Sampling.md", "def-ft", "Aliasing", 4),
        entry("Energy.md", "parsevals-identity", "Proof", 7),
        entry("Index.md", "", "", 3),
        entry("Old.md", "gone", "", 9),
      ],
    },
  );
  await page.goto("/");
  await expect(page.locator("#content h1")).toBeVisible();
}
// A block given as a selector inside the note, or as a locator.
const badge = (page, block) =>
  (typeof block === "string"
    ? page.locator("#content").locator(block)
    : block
  ).locator(":scope > .backlink-badge");

test("counts sit beside what is linked; the card lists who links, in context", async ({
  page,
}) => {
  await boot(page);
  const definition = page.locator("#content p", {
    hasText: "Definition（Fourier transform）",
  });
  await expect(badge(page, definition)).toHaveAttribute("data-count", "2");
  await expect(badge(page, "h2#parsevals-identity")).toHaveAttribute(
    "data-count",
    "1",
  );
  // The title counts every link into the note; one points at a missing place.
  await expect(badge(page, "h1")).toHaveAttribute("data-count", "5");
  await expect(badge(page, "h1")).toHaveClass(/has-missing/);
  // Unlinked blocks and headings show nothing.
  await expect(
    page.locator("#content h2#definition .backlink-badge"),
  ).toHaveCount(0);
  await expect(
    page
      .locator("#content p", { hasText: "Unused" })
      .locator(".backlink-badge"),
  ).toHaveCount(0);
  // The count is drawn by CSS: it is not part of the page's text.
  expect(await definition.innerText()).not.toMatch(/^2|2$/);

  await badge(page, definition).hover();
  const card = page.locator("#backlinks-card");
  await expect(card).toBeVisible();
  await expect(card.locator("header")).toContainText("2");
  await expect(card.locator(".backlink-source")).toHaveText([
    "Convolution",
    "Sampling",
  ]);
  await expect(card.locator(".backlink-section").first()).toHaveText(
    "› Theorem",
  );
  await expect(card.locator(".backlink-hit").first()).toHaveText("def-ft");
  await expect(card.locator(".katex").first()).toBeVisible();
  await card.locator(".backlink-entry").first().click();
  await expect(card).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.mock.links))
    .toEqual(["Convolution.md"]);

  // The title's card groups links by the place they point at.
  await badge(page, "h1").click();
  await expect(card.locator(".backlinks-target")).toContainText([
    "Definition（Fourier transform）",
    "Parseval's identity",
    "整篇笔记",
    "不存在的位置 #gone",
  ]);
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
});

test("links that lead nowhere are marked in place", async ({ page }) => {
  await boot(page);
  const link = (name) => page.locator("#content a", { hasText: name });
  await expect(link("missing note")).toHaveClass(/link-broken/);
  await expect(link("missing note")).toHaveAttribute(
    "title",
    "链接的笔记不存在",
  );
  await expect(link("bad anchor")).toHaveClass(/link-broken/);
  await expect(link("ok")).not.toHaveClass(/link-broken/);
});

test("outline: anchored blocks and counts by setting", async ({ page }) => {
  await boot(page);
  const outline = page.locator("#outline");
  await expect(outline.locator(".outline-anchor")).toHaveCount(0);
  await expect(outline.locator(".outline-count")).toHaveCount(0);

  await page.getByRole("button", { name: "设置", exact: true }).click();
  const choice = page.getByRole("combobox", { name: "目录中的引用点" });
  await choice.selectOption("referenced");
  const labels = outline.locator(".outline-anchor .outline-label");
  await expect(labels).toHaveText(["Definition（Fourier transform）"]);
  await expect(outline.locator(".outline-anchor .outline-count")).toHaveText([
    "2",
  ]);
  await expect(
    outline
      .getByRole("button", { name: /Parseval's identity/ })
      .locator(".outline-count"),
  ).toHaveText("1");

  await choice.selectOption("all");
  await expect(labels).toHaveText([
    "Definition（Fourier transform）",
    "Lemma（Unused）",
  ]);
  await page.getByRole("button", { name: "关闭设置" }).click();
  // Anchored entries sit under their section and jump there.
  const order = await outline
    .locator(":scope > button")
    .evaluateAll((buttons) =>
      buttons.map((b) => b.dataset.anchor || b.textContent.trim()),
    );
  expect(order.indexOf("def-ft")).toBe(order.indexOf("Definition") + 1);
  await outline.locator(".outline-anchor", { hasText: "Lemma" }).click();
  await expect(
    page.locator("#content p", { hasText: "Lemma（Unused）" }),
  ).toBeInViewport();
});
