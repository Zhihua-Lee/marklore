import { test, expect } from "@playwright/test";

test("the reader mounts with the mock back end", async ({ page }) => {
  await page.goto("./?mock");
  await expect(page.locator("#app")).toContainText("Marklore");
});
