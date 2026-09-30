import { defineConfig } from "@playwright/test";

const ci = Boolean(process.env.CI);
// Navigation and scrolling behave differently with smooth vs instant motion;
// run those specs both ways (a smooth-only outline bug once hid behind "reduce").
const motionSpecs = /(navigation-groups|reading-regressions)\.spec\.js$/;

export default defineConfig({
  testDir: "tests/ui",
  timeout: 30000,
  workers: ci ? 2 : 1,
  retries: ci ? 1 : 0,
  forbidOnly: ci,
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    browserName: "chromium",
    // Edge ships with Windows; FOLIO_BROWSER_CHANNEL="" uses bundled Chromium elsewhere.
    channel: (process.env.FOLIO_BROWSER_CHANNEL ?? "msedge") || undefined,
    headless: true,
    viewport: { width: 1360, height: 900 },
    // The interface follows the system language; specs assert Chinese text.
    // tests/ui/english.spec.js switches to en-US.
    locale: "zh-CN",
    baseURL: process.env.FOLIO_BASE_URL || "http://127.0.0.1:5173",
    trace: ci ? "retain-on-failure" : "off",
  },
  projects: [
    { name: "default" },
    {
      name: "reduced-motion",
      testMatch: motionSpecs,
      use: { contextOptions: { reducedMotion: "reduce" } },
    },
  ],
  webServer: process.env.FOLIO_BASE_URL
    ? undefined
    : {
        command: "node node_modules/vite/bin/vite.js --host 127.0.0.1",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: !ci,
      },
});
