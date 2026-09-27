import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createIntegration,
  registrationCommands,
  progId,
} from "../desktop/integration.mjs";

const executable = "D:\\Portable Apps\\Folio Notes\\Folio Notes.exe";
function fixture(profile, overrides = {}) {
  const calls = [],
    launches = [],
    writes = [];
  const app = {
    isPackaged: true,
    getLoginItemSettings: (options) => {
      assert.deepEqual(options, { path: executable, args: ["--background"] });
      return { openAtLogin: false, executableWillLaunchAtLogin: false };
    },
    setLoginItemSettings: (options) => writes.push(options),
  };
  const shell = { openExternal: async (uri) => launches.push(uri) };
  const run = async (_exe, args, options) => {
    calls.push(args);
    assert.equal(options.windowsHide, true);
    if (args[0] === "query")
      throw Object.assign(Error("not found"), { code: 1 });
    return { stdout: "" };
  };
  return {
    integration: createIntegration({
      app,
      shell,
      profile,
      executable,
      platform: "win32",
      windowsRelease: "10.0.22631",
      run,
      ...overrides,
    }),
    calls,
    launches,
    writes,
  };
}

test("registration is per-user, quoted, opt-in and never overwrites protected defaults", () => {
  const commands = registrationCommands(executable);
  assert.equal(commands.length, 10);
  for (const command of commands) {
    assert.equal(command[0], "add");
    assert.ok(command[1].startsWith("HKCU\\Software\\"));
    assert.doesNotMatch(
      command.join(" "),
      /UserChoice|HKEY_LOCAL_MACHINE|HKLM/,
    );
    if (/\\\.(md|markdown)\\/.test(command[1]))
      assert.ok(command[1].endsWith("OpenWithProgids"));
  }
  assert.ok(commands.some((c) => c.includes(`"${executable}" "%1"`)));
  assert.ok(commands.some((c) => c.includes(".md") && c.includes(progId)));
  assert.ok(
    commands.some((c) => c.includes(".markdown") && c.includes(progId)),
  );
  for (const invalid of ["relative.exe", 'D:\\bad"name.exe', "D:\\bad\n.exe"])
    assert.throws(() => registrationCommands(invalid));
});

test("default status and preference load do not mutate startup or registry", async () => {
  const temp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "folio-integration-")),
  );
  try {
    const { integration, calls, writes } = fixture(temp);
    await integration.load();
    assert.equal(integration.closeToTray, false);
    const status = await integration.status();
    assert.equal(status.startup, false);
    assert.equal(status.registered, false);
    assert.deepEqual(
      status.defaults.map((d) => d.known),
      [false, false],
    );
    assert.ok(calls.every((c) => c[0] === "query"));
    assert.equal(writes.length, 0);
    await integration.setBackground(true);
    const restored = fixture(temp).integration;
    await restored.load();
    assert.equal(restored.closeToTray, true);
    await assert.rejects(() => integration.setBackground("true"));
    await fs.writeFile(path.join(temp, "desktop-settings.json"), "null");
    await restored.load();
    assert.equal(restored.closeToTray, false);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test("startup and application registration require explicit actions and keep a stable name", async () => {
  const { integration, calls, writes, launches } = fixture("unused");
  integration.setStartup(true);
  integration.setStartup(false);
  assert.deepEqual(
    writes,
    [true, false].map((openAtLogin) => ({
      path: executable,
      args: ["--background"],
      name: "Folio Notes",
      openAtLogin,
    })),
  );
  assert.throws(() => integration.setStartup("true"));
  await integration.register();
  assert.deepEqual(calls, registrationCommands(executable));
  await integration.defaults();
  await integration.startupSettings();
  assert.deepEqual(launches, [
    "ms-settings:defaultapps?registeredAppUser=Folio%20Notes",
    "ms-settings:startupapps",
  ]);
});

test("status distinguishes another portable version and protected per-extension choices", async () => {
  const { integration } = fixture("unused", {
    run: async (_exe, args) => {
      let value = null;
      if (args[1].endsWith("RegisteredApplications"))
        value = "Software\\FolioNotes\\Capabilities";
      if (args[1].endsWith("command"))
        value = '"D:\\old\\Folio Notes.exe" "%1"';
      if (args[1].endsWith("Run"))
        value = '"D:\\old\\Folio Notes.exe" --background';
      if (args[1].includes("\\.md\\")) value = progId;
      if (args[1].includes("\\.markdown\\")) value = "Other.App";
      return { stdout: `    value    REG_SZ    ${value}\r\n` };
    },
  });
  const status = await integration.status();
  assert.equal(status.registered, true);
  assert.equal(status.registeredHere, false);
  assert.equal(status.startupOtherVersion, true);
  assert.deepEqual(
    status.defaults.map((d) => d.ours),
    [true, false],
  );
});

test("Windows 10 opens the supported general defaults page", async () => {
  const { integration, launches } = fixture("unused", {
    windowsRelease: "10.0.19045",
  });
  await integration.defaults();
  assert.deepEqual(launches, ["ms-settings:defaultapps"]);
});

test("unsupported systems and unexpected registry errors are not reported as successful", async () => {
  const { integration, calls } = fixture("unused", { platform: "linux" });
  assert.equal((await integration.status()).supported, false);
  assert.equal(calls.length, 0);
  assert.throws(() => integration.setStartup(true));
  await assert.rejects(() => integration.register());
  await assert.rejects(() => integration.defaults());
  const denied = fixture("unused", {
    run: async () => {
      throw Object.assign(Error("access denied"), { code: 5 });
    },
  }).integration;
  await assert.rejects(() => denied.status(), /access denied/);
});
