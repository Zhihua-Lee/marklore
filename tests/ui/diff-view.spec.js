import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// A .diff/.patch (an other format, turned on in Settings) reads as one section
// per changed file, its lines washed green or red, positions in its own text.
const diff = [
  "diff --git a/src/app.js b/src/app.js",
  "index 1111111..2222222 100644",
  "--- a/src/app.js",
  "+++ b/src/app.js",
  "@@ -1,3 +1,3 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  " export { a, b };",
  "diff --git a/README.md b/README.md",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/README.md",
  "@@ -0,0 +1,40 @@",
  ...Array.from({ length: 40 }, (_, i) => `+line ${i} of a long new file`),
  "",
].join("\n");

async function boot(page, docs) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installFolio(page);
  await page.addInitScript((docs) => {
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [],
        restored: docs.map(({ name, text }, i) => ({
          id: "d" + i,
          name,
          fileId: "d" + i,
          groupId: null,
          mode: "read",
          document: {
            id: "d" + i,
            name,
            path: "C:/s/" + name,
            version: "1",
            text,
          },
        })),
        roots: [],
        active: "d0",
        settings: { sidebar: false },
      }),
    });
  }, docs);
  await page.goto("/");
  await page.locator("#content").waitFor();
}

test("a diff reads as one section per file, with whole lines tinted", async ({
  page,
}) => {
  await boot(page, [{ name: "fix.diff", text: diff }]);
  const content = page.locator("#content");
  await expect(content.locator("h2")).toHaveCount(2);
  await expect(content.locator("h2").first()).toContainText("src/app.js");
  await expect(content.locator("h2").first()).toContainText("+1 −1");
  await expect(content.locator("h2").nth(1)).toContainText("README.md");
  await expect(content.locator("h2").nth(1)).toContainText("新文件");
  // Paths are code, not links (README.md would otherwise look like a domain).
  await expect(content.locator("h2 a")).toHaveCount(0);
  await expect(page.locator("#outline > button")).toHaveCount(2);

  await expect(content.locator(".diff-add")).toHaveCount(41);
  await expect(content.locator(".diff-del")).toHaveCount(1);
  // A long file shows in full: the file's section folds, not its code.
  await expect(content.locator(".code-fold")).toHaveCount(0);
  await expect(content.locator(".code-collapsed")).toHaveCount(0);
  const look = await content
    .locator(".diff-add")
    .first()
    .evaluate((el) => {
      const pre = el.closest("pre").getBoundingClientRect(),
        line = el.getBoundingClientRect();
      return {
        background: getComputedStyle(el).backgroundColor,
        plain: getComputedStyle(
          el.closest("pre").querySelector(".diff-context"),
        ).backgroundColor,
        spans: Math.abs(line.width - pre.width) < 1,
      };
    });
  expect(look.background).not.toBe(look.plain);
  expect(look.spans).toBe(true);
  // Read-only: no block of the generated Markdown is edited in place.
  await expect(page.locator("#content [data-edit-from]")).toHaveCount(0);
});

test("positions are the diff's own: the outline and source view agree", async ({
  page,
}) => {
  await boot(page, [{ name: "fix.patch", text: diff }]);
  const second = page.locator("#outline > button").nth(1);
  await expect(second).toHaveAttribute(
    "data-from",
    String(diff.indexOf("diff --git a/README.md")),
  );
  for (const block of await page.locator("#content [data-from]").all()) {
    const from = Number(await block.getAttribute("data-from"));
    expect(from).toBeGreaterThanOrEqual(0);
    expect(from).toBeLessThanOrEqual(diff.length);
  }
  // Source view shows the diff itself, unchanged.
  await page.getByRole("button", { name: "源码" }).click();
  await expect(page.locator("#editor .cm-content")).toContainText(
    "diff --git a/src/app.js b/src/app.js",
  );
  const lines = await page
    .locator("#editor .cm-line")
    .evaluateAll((all) => all.slice(0, 9).map((l) => l.textContent));
  expect(lines).toEqual(diff.split("\n").slice(0, 9));
  // Plain text in the editor: no Markdown heading or list styling.
  await expect(page.locator("#editor .cm-line .tok-heading")).toHaveCount(0);
});

test("a diff block in a note gets the same line tints", async ({ page }) => {
  await boot(page, [
    {
      name: "review.md",
      text: "# Review\n\n```diff\n-old\n+new\n same\n```\n",
    },
  ]);
  const content = page.locator("#content");
  await expect(content.locator(".diff-del")).toHaveText("-old\n");
  await expect(content.locator(".diff-add")).toHaveText("+new\n");
  await expect(content.locator(".diff-context")).toHaveText(" same\n");
});
