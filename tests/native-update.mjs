// Updating end to end from a local feed. FOLIO_PROFILE_DIR stands in for the
// user profile, so the real one is never read or written. Each copy is updated
// twice: with the whole package, then with only the app files (a release on
// the same Electron).
// - A zip copy (default), on a copy of the packaged app: the feed offers
//   "v9.9.8", the same build with a marker file, as a zip; then "v9.9.9" as
//   app files. The app downloads and checks it, quits, and the helper
//   overwrites the folder and starts it again. The portable data folder beside
//   the program stays.
// - An installed copy (FOLIO_TEST_EXE has the uninstaller beside it), as
//   tools/installer-check.ps1 -Newer runs it: the feed offers the setup in
//   FOLIO_UPDATE_SETUP, version FOLIO_UPDATE_VERSION, installed over itself;
//   then "v9.9.9" as app files, which must also update the version
//   "Apps & features" shows.
import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { assetNames, appFiles } from "../desktop/updater.mjs";

if (!process.env.FOLIO_TEST_EXE || process.platform !== "win32") {
  console.log("Native update skipped: needs a packaged Windows build.");
  process.exit(0);
}
process.noAsar = true;
const step = (text) => console.log(`[update] ${text}`);
const exists = (p) =>
  fs.access(p).then(
    () => true,
    () => false,
  );
const source = path.dirname(process.env.FOLIO_TEST_EXE),
  installed = await exists(path.join(source, "Uninstall Marklore.exe"));
if (installed && !process.env.FOLIO_UPDATE_SETUP) {
  console.log(
    "Native update skipped: an installed copy needs FOLIO_UPDATE_SETUP.",
  );
  process.exit(0);
}
const runtime = (
  await fs.readFile(path.join(source, "version"), "utf8")
).trim();
const temp = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "folio-update-")),
);
const program = installed ? source : path.join(temp, "app"),
  profile = path.join(temp, "profile"),
  note = path.join(temp, "Update.md"),
  executable = path.join(program, path.basename(process.env.FOLIO_TEST_EXE));
await fs.writeFile(note, "# Update\n\nStill here.\n");
const tar = (cwd, ...args) =>
  execFileSync(path.join(process.env.SystemRoot, "System32", "tar.exe"), args, {
    cwd,
    windowsHide: true,
  });

// The release the feed offers: its one download and the checksums.
async function release(kind, version) {
  const names = assetNames(version, runtime),
    served = path.join(temp, "served-" + version);
  let asset, body;
  if (kind === "setup") {
    asset = names.setup;
    body = await fs.readFile(process.env.FOLIO_UPDATE_SETUP);
  } else {
    const folder = path.join(served, names.folder);
    if (kind === "zip") {
      await fs.cp(source, folder, { recursive: true });
      await fs.rm(path.join(folder, "debug.log"), { force: true });
    } else
      for (const file of appFiles) {
        await fs.mkdir(path.dirname(path.join(folder, file)), {
          recursive: true,
        });
        await fs.copyFile(path.join(source, file), path.join(folder, file));
      }
    await fs.writeFile(path.join(folder, `UPDATED-${version}.txt`), version);
    asset = kind === "zip" ? names.zip : names.app;
    tar(served, "-a", "-c", "-f", asset, names.folder);
    body = await fs.readFile(path.join(served, asset));
  }
  const sums = `${createHash("sha256").update(body).digest("hex")}  ${asset}\n`;
  return { [asset]: body, [names.sums]: Buffer.from(sums) };
}

let offered = { version: "", files: {} };
const server = http.createServer((request, response) => {
  const base = `http://127.0.0.1:${server.address().port}`;
  if (request.url === "/latest") {
    response.setHeader("content-type", "application/json");
    return response.end(
      JSON.stringify({
        tag_name: "v" + offered.version,
        html_url: base + "/release",
        assets: Object.entries(offered.files).map(([name, data]) => ({
          name,
          size: data.length,
          browser_download_url: `${base}/${name}`,
        })),
      }),
    );
  }
  const data = offered.files[request.url.slice(1)];
  if (!data) return response.writeHead(404).end();
  response.setHeader("content-length", data.length);
  response.end(data);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const feed = `http://127.0.0.1:${server.address().port}/latest`;

const powershell = (command) =>
  execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  });
// The copy started by the helper, found by its path.
function running() {
  return powershell(
    `Get-CimInstance Win32_Process -Filter "Name='Marklore.exe'" | Where-Object { $_.ExecutablePath -eq '${executable.replace(/'/g, "''")}' } | ForEach-Object { $_.ProcessId }`,
  )
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
}
function stop() {
  for (const id of running())
    try {
      execFileSync("taskkill", ["/PID", String(id), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {}
}
// The version the installed copy's uninstall entry names.
const displayVersion = () =>
  powershell(
    "Get-ChildItem 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -eq 'Marklore' } | ForEach-Object { $_.DisplayVersion }",
  ).trim();
async function until(test, what, ms = 120000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw Error("Timed out: " + what);
}

async function update(kind, version) {
  offered = { version, files: await release(kind, version) };
  step(`launch (${installed ? "installed" : "zip"} copy), offered ${kind}`);
  const app = await electron.launch({
    executablePath: executable,
    args: [note],
    env: {
      ...process.env,
      FOLIO_PROFILE_DIR: profile,
      FOLIO_DATA_DIR: "",
      FOLIO_UPDATE_FEED: feed,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.getByRole("tab", { name: "Update.md" }).waitFor();
  await page.locator("#weight").click();
  await page.locator('.settings-nav [data-section="desktop-settings"]').click();
  const action = page.locator("#update-action"),
    status = page.locator("#update-status");
  await action.waitFor({ state: "visible" });
  step("check");
  await action.click();
  await page.waitForFunction(
    (version) =>
      document.querySelector("#update-action").textContent.includes(version),
    version,
  );
  assert.ok((await status.textContent()).includes("有新版本 v" + version));
  const exited = new Promise((resolve) => app.process().once("exit", resolve));
  step("update");
  await action.click();
  await Promise.race([
    exited,
    new Promise((_, reject) =>
      setTimeout(
        async () =>
          reject(
            Error(
              "Marklore did not quit: " +
                (await status.textContent().catch(() => "?")),
            ),
          ),
        60000,
      ),
    ),
  ]);
  step("waiting for the helper");
  if (installed)
    await until(async () => displayVersion() === version, "the new version");
  if (kind !== "setup")
    await until(
      () => exists(path.join(program, `UPDATED-${version}.txt`)),
      "the new files",
    );
  await until(async () => running().length > 0, "the restarted copy");
  // The restarted copy reads pending.json, reports and clears the downloads.
  await until(
    async () =>
      !(await exists(path.join(profile, "marklore-update", "pending.json"))),
    "the restarted copy to settle",
  );
  // The downloads are gone too, the unpacked app.asar included (Electron's fs
  // once took it for an archive and left the folder behind).
  await until(
    async () => !(await exists(path.join(profile, "marklore-update"))),
    "the update's files to be removed",
    30000,
  );
  if (!installed)
    assert.equal(
      await fs.readFile(path.join(program, "data", "keep.txt"), "utf8"),
      "mine",
    );
  stop();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  step(
    `ok: v${version} (${kind}) in place, program restarted at the same path`,
  );
}

let failed = false;
try {
  if (!installed) {
    step("copying the packaged app");
    await fs.cp(source, program, { recursive: true });
    await fs.rm(path.join(program, "debug.log"), { force: true });
    // Portable: its data must survive the update.
    await fs.mkdir(path.join(program, "data"));
    await fs.writeFile(path.join(program, "data", "keep.txt"), "mine");
  }
  if (installed) await update("setup", process.env.FOLIO_UPDATE_VERSION);
  else await update("zip", "9.9.8");
  await update("app", "9.9.9");
} catch (error) {
  failed = true;
  console.error(error);
  const log = path.join(profile, "marklore-update", "update.log");
  if (await exists(log)) console.error(await fs.readFile(log, "utf8"));
  else
    console.error(
      "No helper log; update folder:",
      await fs
        .readdir(path.join(profile, "marklore-update"))
        .catch((e) => e.code),
    );
} finally {
  stop();
  server.close();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
}
console.log(failed ? "Native update FAILED" : "Native update passed");
process.exitCode = failed ? 1 : 0;
