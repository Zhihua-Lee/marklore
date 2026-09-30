import fs from "node:fs/promises";
import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import { t } from "./i18n.mjs";

// Portable mode: a "data" folder beside Folio Notes.exe holds the app's own
// state (tabs, drafts, recent files, tray settings, backups), so a copy on a
// USB stick keeps it. Chromium's caches stay in the user profile (main.mjs
// points sessionData there): they are large, need no carrying, and would keep
// the folder locked while running. Switching copies the state across, then
// Folio restarts.
export const PORTABLE_FOLDER = "data";
export const OWN_DATA = [
  "session.json",
  "recent.json",
  "desktop-settings.json",
  "backups",
];

// Written when portable mode is switched off: the running app holds its
// single-instance lock file in the folder, so it is renamed on the next start.
export const DISABLED_MARK = "DISABLED";

export const portableDir = (executable) =>
  path.join(path.dirname(executable), PORTABLE_FOLDER);

export const isPortable = (executable, exists = existsSync) => {
  const dir = portableDir(executable);
  return exists(dir) && !exists(path.join(dir, DISABLED_MARK));
};

export async function copyOwnData(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const name of OWN_DATA)
    try {
      await fs.cp(path.join(from, name), path.join(to, name), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
}

// Built beside the program under a temporary name, then renamed: a failed
// copy never leaves a half-filled "data" folder that would switch modes.
export async function enablePortable({ executable, current }) {
  const target = portableDir(executable);
  if (existsSync(target)) throw Error(t("程序目录中已有 data 文件夹"));
  const staging = `${target}.partial-${process.pid}`;
  try {
    await copyOwnData(current, staging);
    await fs.rename(staging, target);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error.code === "EACCES" || error.code === "EPERM"
      ? Error(t("程序所在文件夹不可写入，无法启用便携模式"))
      : error;
  }
  return target;
}

// The data goes back to the user profile. The folder is renamed, never
// deleted, on the next start (retireDisabled).
export async function disablePortable({ executable, fallback }) {
  const source = portableDir(executable);
  await copyOwnData(source, fallback);
  await fs.writeFile(
    path.join(source, DISABLED_MARK),
    "Folio Notes portable mode was switched off; this folder is renamed on the next start.\n",
  );
}

// At startup, before the single-instance lock is taken in that folder.
export function retireDisabled(executable, now = new Date()) {
  const source = portableDir(executable);
  if (!existsSync(path.join(source, DISABLED_MARK))) return null;
  const stamp = now.toISOString().slice(0, 10);
  let kept = path.join(path.dirname(source), `data-disabled-${stamp}`);
  for (let n = 2; existsSync(kept); n++)
    kept = path.join(path.dirname(source), `data-disabled-${stamp}-${n}`);
  try {
    renameSync(source, kept);
    return kept;
  } catch {
    return null; // Still marked, so it is not used; retried next start.
  }
}
