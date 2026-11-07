import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

// What is under the reader's eyes stays put. Up to v0.2.6 a double click in
// Read mode moved the clicked paragraph to 80 px below the top (274 px here),
// opening a paragraph for editing pushed the text below it down by 114 px
// (a tool bar above it and a button row below), and Done or Esc left the
// block a pixel or two higher each time.
const filler = (n) =>
  Array.from(
    { length: n },
    (_, i) => `前文段落 ${i}：把目标推到屏幕中部的普通文字，带一点 English。`,
  ).join("\n\n");
const note = [
  "# 不跳动",
  filler(40),
  "目标段落：含 **加粗** 与公式 $x^2+y^2=z^2$，以及中文标点。",
  "后续段落：紧跟在目标之后。",
  filler(10),
].join("\n\n");

async function boot(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installFolio(page);
  await page.addInitScript((text) => {
    const file = {
      id: "one",
      path: "C:/notes/One.md",
      name: "One.md",
      text,
      version: "v1",
    };
    window.folio = folioTest.mock({
      ready: async () => ({
        incoming: [file],
        roots: [],
        restored: [],
        settings: { sidebar: false, outline: false },
      }),
    });
  }, note);
  await page.goto("/");
  await page.locator("#content h1").waitFor();
  const target = page
    .locator("#content p")
    .filter({ hasText: "目标段落" })
    .first();
  await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  return target;
}
const top = async (locator) => (await locator.boundingBox()).y;

test("a double click in Read mode keeps the clicked paragraph in place", async ({
  page,
}) => {
  const target = await boot(page);
  const before = await top(target);
  expect(
    await page.locator("#reader").evaluate((r) => r.scrollTop),
  ).toBeGreaterThan(500);
  await target.dblclick({ position: { x: 30, y: 8 } });
  await expect(page.locator("#panes")).toHaveAttribute("data-mode", "edit");
  await page.waitForTimeout(300);
  expect(Math.abs((await top(target)) - before)).toBeLessThan(1.5);
});
