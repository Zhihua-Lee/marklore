import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/ui",
  timeout: 30000,
  workers: 1,
  use: {
    browserName: "chromium",
    channel: "msedge",
    headless: true,
    viewport: { width: 1360, height: 900 },
    baseURL: "http://127.0.0.1:5173",
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
  },
});
