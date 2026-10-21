import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { t } from "./i18n.mjs";

const execute = promisify(execFile);
// Starts a program and leaves it running on its own. The native tests put a
// recorder in globalThis.__desktopLaunch: they never open system dialogs.
const launchDetached = (file, args) =>
  globalThis.__desktopLaunch
    ? globalThis.__desktopLaunch(file, args)
    : new Promise((resolve, reject) => {
        const child = spawn(file, args, { detached: true, stdio: "ignore" });
        child.once("error", reject);
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      });
export const applicationName = "Marklore";
export const progId = "Marklore.Markdown";
const classes = "HKCU\\Software\\Classes";
const capabilities = "Software\\Marklore\\Capabilities";
const extensions = [".md", ".markdown"];
// Other formats (unified diffs) are their own file type, registered only while
// the reader has them turned on.
export const otherProgId = "Marklore.Other";
export const otherExtensions = [".diff", ".patch"];
const runKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
// What versions named Folio Notes registered; removed when registering again.
export const legacy = {
  name: "Folio Notes",
  progId: "FolioNotes.Markdown",
  key: "HKCU\\Software\\FolioNotes",
};

// Deletes the Folio Notes entries; each may already be gone.
export function legacyCommands() {
  return [
    ["delete", `${classes}\\${legacy.progId}`, "/f"],
    ["delete", legacy.key, "/f"],
    [
      "delete",
      "HKCU\\Software\\RegisteredApplications",
      "/v",
      legacy.name,
      "/f",
    ],
    ...extensions.map((ext) => [
      "delete",
      `${classes}\\${ext}\\OpenWithProgids`,
      "/v",
      legacy.progId,
      "/f",
    ]),
  ];
}

// Removes the other formats' registration (turned off, or never on).
export function otherCommands() {
  return [
    ["delete", `${classes}\\${otherProgId}`, "/f"],
    ...otherExtensions.flatMap((ext) => [
      ["delete", `HKCU\\${capabilities}\\FileAssociations`, "/v", ext, "/f"],
      [
        "delete",
        `${classes}\\${ext}\\OpenWithProgids`,
        "/v",
        otherProgId,
        "/f",
      ],
    ]),
  ];
}

// Register an opt-in candidate, never write UserChoice or extension defaults.
export function registrationCommands(executable, { other = false } = {}) {
  if (!path.win32.isAbsolute(executable) || /["\r\n]/.test(executable))
    throw Error(t("无效程序路径"));
  const add = (key, name, value, type = "REG_SZ") => [
    "add",
    key,
    ...(name === null ? ["/ve"] : ["/v", name]),
    "/t",
    type,
    "/d",
    value,
    "/f",
  ];
  return [
    add(`${classes}\\${progId}`, null, t("Markdown 文档")),
    add(`${classes}\\${progId}\\DefaultIcon`, null, `"${executable}",0`),
    add(
      `${classes}\\${progId}\\shell\\open\\command`,
      null,
      `"${executable}" "%1"`,
    ),
    add(`HKCU\\${capabilities}`, "ApplicationName", applicationName),
    add(
      `HKCU\\${capabilities}`,
      "ApplicationDescription",
      t("离线 Markdown 笔记阅读与编辑"),
    ),
    ...extensions.map((ext) =>
      add(`HKCU\\${capabilities}\\FileAssociations`, ext, progId),
    ),
    ...extensions.map((ext) =>
      add(`${classes}\\${ext}\\OpenWithProgids`, progId, "", "REG_NONE"),
    ),
    ...(other
      ? [
          add(`${classes}\\${otherProgId}`, null, t("Diff / Patch 文件")),
          add(
            `${classes}\\${otherProgId}\\DefaultIcon`,
            null,
            `"${executable}",0`,
          ),
          add(
            `${classes}\\${otherProgId}\\shell\\open\\command`,
            null,
            `"${executable}" "%1"`,
          ),
          ...otherExtensions.map((ext) =>
            add(`HKCU\\${capabilities}\\FileAssociations`, ext, otherProgId),
          ),
          ...otherExtensions.map((ext) =>
            add(
              `${classes}\\${ext}\\OpenWithProgids`,
              otherProgId,
              "",
              "REG_NONE",
            ),
          ),
        ]
      : []),
    add(
      "HKCU\\Software\\RegisteredApplications",
      applicationName,
      capabilities,
    ),
  ];
}

export function createIntegration({
  app,
  shell,
  profile,
  executable = process.execPath,
  platform = process.platform,
  windowsRelease = os.release(),
  run = execute,
  launch = launchDetached,
  temp = os.tmpdir(),
}) {
  const reg = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "reg.exe",
  );
  const preferenceFile = path.join(profile, "desktop-settings.json");
  let preferences = {
    closeToTray: false,
    otherFormats: false,
    checkUpdates: false,
  };
  async function store(change) {
    await fs.mkdir(profile, { recursive: true });
    const next = { ...preferences, ...change },
      temp = preferenceFile + ".tmp";
    await fs.writeFile(temp, JSON.stringify(next), "utf8");
    await fs.rename(temp, preferenceFile);
    preferences = next;
  }
  const loginOptions = { path: executable, args: ["--background"] };
  const supported = platform === "win32" && app.isPackaged;
  const invoke = (args) =>
    run(reg, args, {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
  async function forget(commands) {
    for (const command of commands) await invoke(command).catch(() => {});
  }
  async function query(key, name) {
    try {
      const result = await invoke([
        "query",
        key,
        ...(name === null ? ["/ve"] : ["/v", name]),
      ]);
      return result.stdout.match(/REG_SZ\s+([^\r\n]*)/)?.[1]?.trim() || null;
    } catch (error) {
      if (error.code === 1) return null;
      throw error;
    }
  }
  return {
    async load() {
      try {
        const stored = JSON.parse(await fs.readFile(preferenceFile, "utf8"));
        preferences.closeToTray = stored?.closeToTray === true;
        preferences.otherFormats = stored?.otherFormats === true;
        preferences.checkUpdates = stored?.checkUpdates === true;
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
          throw error;
      }
    },
    get closeToTray() {
      return preferences.closeToTray;
    },
    get otherFormats() {
      return preferences.otherFormats;
    },
    get checkUpdates() {
      return preferences.checkUpdates;
    },
    login() {
      return supported
        ? app.getLoginItemSettings(loginOptions)
        : { openAtLogin: false };
    },
    async status() {
      const startup = this.login();
      if (!supported)
        return { ...preferences, supported, startup: false, executable };
      const [
        registration,
        command,
        startupCommand,
        legacyStartup,
        ...defaults
      ] = await Promise.all([
        query("HKCU\\Software\\RegisteredApplications", applicationName),
        query(`${classes}\\${progId}\\shell\\open\\command`, null),
        query(runKey, applicationName),
        query(runKey, legacy.name),
        ...[...extensions, ...otherExtensions].map((ext) =>
          query(
            `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice`,
            "ProgId",
          ),
        ),
      ]);
      return {
        ...preferences,
        supported,
        executable,
        startup: startup.openAtLogin,
        startupEnabled: startup.executableWillLaunchAtLogin,
        startupOtherVersion:
          Boolean(startupCommand || legacyStartup) && !startup.openAtLogin,
        registered: registration === capabilities,
        registeredHere: command === `"${executable}" "%1"`,
        defaults: [...extensions, ...otherExtensions].map((extension, i) => ({
          extension,
          other: otherExtensions.includes(extension),
          ours: defaults[i] === progId || defaults[i] === otherProgId,
          known: defaults[i] !== null,
        })),
      };
    },
    async setBackground(value) {
      if (typeof value !== "boolean") throw Error(t("无效后台设置"));
      await store({ closeToTray: value });
    },
    async setCheckUpdates(value) {
      if (typeof value !== "boolean") throw Error(t("无效设置"));
      await store({ checkUpdates: value });
    },
    // Other formats on or off; an existing registration of this copy follows.
    async setOtherFormats(value) {
      if (typeof value !== "boolean") throw Error(t("无效设置"));
      await store({ otherFormats: value });
      if (!supported) return;
      if (!value) await forget(otherCommands());
      else if (
        (await query(`${classes}\\${progId}\\shell\\open\\command`, null)) ===
        `"${executable}" "%1"`
      )
        await this.register();
    },
    setStartup(value) {
      if (!supported || typeof value !== "boolean")
        throw Error(t("仅 Windows 打包版支持开机启动"));
      app.setLoginItemSettings({
        ...loginOptions,
        name: applicationName,
        openAtLogin: value,
      });
      // A Folio Notes login entry would also start the old version.
      return forget([["delete", runKey, "/v", legacy.name, "/f"]]);
    },
    async register() {
      if (!supported) throw Error(t("仅 Windows 打包版支持文件关联"));
      for (const command of registrationCommands(executable, {
        other: preferences.otherFormats,
      }))
        await invoke(command);
      if (!preferences.otherFormats) await forget(otherCommands());
      await forget(legacyCommands());
    },
    async defaults() {
      if (!supported) throw Error(t("仅 Windows 支持默认应用设置"));
      // No app can make itself the default; Windows asks the user. Windows 11
      // has a Default apps page for Marklore alone. Windows 10 only has the
      // page of every file type, so it gets the "How do you want to open this
      // file?" dialog for a .md file instead, with "Always use this app".
      if (Number(windowsRelease.split(".")[2]) >= 22000) {
        await shell.openExternal(
          "ms-settings:defaultapps?registeredAppUser=" +
            encodeURIComponent(applicationName),
        );
        return;
      }
      const folder = path.join(temp, "Marklore"),
        sample = path.join(folder, "Marklore.md");
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(sample, "# Marklore\n", "utf8");
      await launch(
        path.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32",
          "rundll32.exe",
        ),
        ["shell32.dll,OpenAs_RunDLL", sample],
      );
    },
    async startupSettings() {
      if (!supported) throw Error(t("仅 Windows 支持启动应用设置"));
      await shell.openExternal("ms-settings:startupapps");
    },
  };
}
