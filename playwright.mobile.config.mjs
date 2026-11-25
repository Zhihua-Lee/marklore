import { defineConfig, devices } from "@playwright/test";

// Phone reader specs (tests/mobile), against the mobile dev server
// (FOLIO_MOBILE_URL, default http://127.0.0.1:5180/). WebKit runs only where it
// is installed (PLAYWRIGHT_BROWSERS_PATH pointing at a folder with webkit).
const webkit = process.env.FOLIO_MOBILE_WEBKIT === "1";

export default defineConfig({
  testDir: "tests/mobile",
  timeout: 30000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.FOLIO_MOBILE_URL || "http://127.0.0.1:5180/",
  },
  projects: [
    {
      name: "iphone-chromium",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        channel: process.env.FOLIO_BROWSER_CHANNEL ?? "",
      },
    },
    ...(webkit
      ? [{ name: "iphone-webkit", use: { ...devices["iPhone 13"], browserName: "webkit" } }]
      : []),
  ],
});
