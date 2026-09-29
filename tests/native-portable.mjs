// Portable mode end to end on a copy of the packaged app: enabling moves the
// tabs and settings into <app>/data and restarts; disabling moves them back
// and keeps the folder under a new name. FOLIO_PROFILE_DIR stands in for the
// user profile, so the real one is never read or written.
import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (!process.env.FOLIO_TEST_EXE) {
  console.log(
    "Native portable skipped: needs a packaged build (FOLIO_TEST_EXE).",
  );
  process.exit(0);
}
// Under Electron's Node, copy app.asar as a plain file, not as an archive.
process.noAsar = true;
const temp = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "folio-portable-")),
);
const program = path.join(temp, "app");
const profile = path.join(temp, "profile");
const note = path.join(temp, "Portable.md");
console.log("[portable] copying the packaged app");
await fs.cp(path.dirname(process.env.FOLIO_TEST_EXE), program, {
  recursive: true,
});
console.log("[portable] copied");
await fs.writeFile(note, "# Portable\n\nCarried along.\n");
const executable = path.join(
  program,
  path.basename(process.env.FOLIO_TEST_EXE),
);
const exists = (p) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

const step = (text) => console.log(`[portable] ${text}`);
async function launch(args = []) {
  step("launch " + args.length);
  const app = await electron.launch({
    executablePath: executable,
    args,
    env: {
      ...process.env,
      FOLIO_PROFILE_DIR: profile,
      FOLIO_NO_RELAUNCH: "1",
      FOLIO_DATA_DIR: "",
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.getByRole("tab", { name: "Portable.md" }).waitFor();
  return { app, page };
}
async function state(page) {
  return page.evaluate(() => window.folio.desktopStatus());
}
// Toggle portable mode in Aa; Folio saves, switches folders and exits.
async function toggle({ app, page }) {
  step("toggle");
  const exited = new Promise((resolve, reject) => {
    app.process().once("exit", resolve);
    setTimeout(
      () => reject(Error("Folio did not exit after the switch")),
      20000,
    );
  });
  await page.locator("#weight").click();
  await page.locator("#portable-mode").click();
  await exited.catch(async (error) => {
    const toast = await page
      .locator("#toast")
      .textContent()
      .catch(() => "");
    const listing = await fs
      .readdir(path.join(program, "data"))
      .catch(() => []);
    throw Error(`${error.message}: ${toast} | data: ${listing.join(", ")}`);
  });
}

let running;
try {
  running = await launch([note]);
  let status = await state(running.page);
  assert.equal(status.portable.available, true);
  assert.equal(status.portable.on, false);
  await running.page.locator("#theme").click();
  await running.page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await toggle(running);
  running = null;
  const data = path.join(program, "data");
  assert.equal(await exists(path.join(data, "session.json")), true);
  assert.equal(await exists(path.join(data, "Cache")), false);
  assert.equal(await exists(path.join(profile, "session.json")), true);

  // Relaunched: the same tab and theme, now read from <app>/data.
  running = await launch();
  status = await state(running.page);
  assert.equal(status.portable.on, true);
  assert.equal(status.portable.folder, data);
  assert.equal(
    await running.page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
  );
  assert.equal(
    await running.app.evaluate(({ app }) => app.getPath("userData")),
    data,
  );
  await toggle(running);
  running = null;
  // Marked now (the running app held its lock file there), renamed at the
  // next start.
  assert.equal(await exists(path.join(data, "DISABLED")), true);

  // Back in the profile, still with the tab and theme.
  running = await launch();
  status = await state(running.page);
  assert.equal(status.portable.on, false);
  const kept = (await fs.readdir(program)).filter((name) =>
    name.startsWith("data-disabled-"),
  );
  assert.equal(kept.length, 1);
  assert.equal(await exists(data), false);
  assert.equal(
    await running.app.evaluate(({ app }) => app.getPath("userData")),
    profile,
  );
  assert.equal(
    await running.page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
  );
  await running.app.close();
  running = null;
  console.log(
    "Native portable passed: data moves to <app>/data and back with tabs and settings; Chromium caches stay out; the folder is kept on disable; profile stand-in only.",
  );
} finally {
  if (running) await running.app.close().catch(() => {});
  await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
}
