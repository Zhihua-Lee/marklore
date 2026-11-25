// The built reader opens without a connection once it has been opened online
// (service worker with the build's file list), and an open page moves to a
// new build by itself. Runs against `vite preview` of dist-mobile:
// FOLIO_MOBILE_PREVIEW_URL (skipped when unset).
import { test, expect } from "@playwright/test";
import fs from "node:fs";

const preview = process.env.FOLIO_MOBILE_PREVIEW_URL;
const builtWorker = "dist-mobile/sw.js";

test("an open reader reloads into a new build", async ({
  page,
  browserName,
}) => {
  test.skip(
    !preview,
    "needs FOLIO_MOBILE_PREVIEW_URL (vite preview of dist-mobile)",
  );
  test.skip(
    browserName === "webkit",
    "service workers on Windows WebKit are checked on the phone instead",
  );
  await page.goto(preview);
  await page.waitForFunction(() => window.markloreReader);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.evaluate(() => (window.oldPage = true));

  // A new build: sw.js differs (its version), nothing else needs to change.
  const original = fs.readFileSync(builtWorker, "utf8");
  try {
    fs.writeFileSync(
      builtWorker,
      original.replace(/"version":"(\w+)"/, (_, v) => `"version":"${v}next"`),
    );
    await page.evaluate(async () =>
      (await navigator.serviceWorker.getRegistration()).update(),
    );
    await page.waitForFunction(
      () => window.markloreReader && !window.oldPage,
      null,
      { timeout: 15000 },
    );
  } finally {
    fs.writeFileSync(builtWorker, original);
  }
});

test("the built reader starts offline after one online visit", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    !preview,
    "needs FOLIO_MOBILE_PREVIEW_URL (vite preview of dist-mobile)",
  );
  // Playwright's Windows WebKit fails internally when offline emulation meets a
  // service worker; this is checked on the phone instead.
  test.skip(
    browserName === "webkit",
    "offline emulation with service workers fails in Windows WebKit",
  );
  await page.goto(preview);
  await page.waitForFunction(() => window.markloreReader);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The first visit is not controlled yet; reload once so the worker serves it.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.markloreReader);
  await expect(page.locator("#app")).not.toBeEmpty();
  // A return from sign-in (?code=…) is served the same shell.
  await page.goto(preview + "?code=x&state=y");
  await page.waitForFunction(() => window.markloreReader);
  expect(page.url()).not.toContain("code=");
});
