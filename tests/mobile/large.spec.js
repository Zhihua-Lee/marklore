// A OneNote-export-sized library (?mock=big: 40 sections, 800 pages) stays
// quick on a phone: home, search and opening a page, with the CPU slowed 4x
// (Chromium only; WebKit has no CPU throttling).
import { test, expect } from "@playwright/test";

test("home, search and a page stay quick with 800 pages", async ({
  page,
  browserName,
}) => {
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  const t0 = Date.now();
  await page.goto("./?mock=big");
  await expect(page.locator(".mobile-status-footer")).toContainText(
    "847 篇笔记",
  );
  const home = Date.now() - t0;

  const t1 = Date.now();
  await page.locator(".mobile-search-input").fill("第 37.5 页");
  await expect(page.locator(".mobile-search-item").first()).toContainText(
    "第 37.5 页",
  );
  const search = Date.now() - t1;

  const t2 = Date.now();
  await page.locator(".mobile-search-item").first().click();
  await expect(page.locator(".katex").first()).toBeVisible();
  const open = Date.now() - t2;
  console.log(JSON.stringify({ browserName, home, search, open }));
  // Generous bounds for a slowed CPU; the numbers are in the log.
  expect(home).toBeLessThan(6000);
  expect(search).toBeLessThan(3000);
  expect(open).toBeLessThan(3000);
});
