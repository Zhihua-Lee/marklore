import fs from "node:fs";
import { chromium, defineConfig } from "@playwright/test";

const ci = Boolean(process.env.CI);
// Headless Edge opens a hidden window for every page, and Windows Explorer
// keeps about 6 GDI objects per such window until it is restarted (it ends
// itself near 9 000, see tools/explorer-gdi.mjs): one full UI run costs it
// thousands. Chromium's headless shell opens no windows, so it is used when
// installed (`playwright install chromium-headless-shell`); otherwise Edge,
// which ships with Windows.
function headlessShellInstalled() {
  try {
    const full = chromium.executablePath();
    const shell = full.replace(
      /chromium-(\d+)([\\/])chrome-win64[\\/]chrome\.exe$/,
      "chromium_headless_shell-$1$2chrome-headless-shell-win64$2chrome-headless-shell.exe",
    );
    return shell !== full && fs.existsSync(shell);
  } catch {
    return false;
  }
}
const channel =
  process.env.FOLIO_BROWSER_CHANNEL ??
  (headlessShellInstalled() ? "" : "msedge");
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
  // Does not start while Explorer is near its GDI limit.
  globalSetup: "./tools/explorer-gdi.mjs",
  use: {
    browserName: "chromium",
    // FOLIO_BROWSER_CHANNEL="msedge" forces Edge, "" bundled Chromium.
    channel: channel || undefined,
    headless: true,
    // Headless Edge still makes a real (hidden) window, which Windows can
    // bring up for a moment: keep it off every display.
    launchOptions: { args: ["--window-position=-32000,-32000"] },
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
