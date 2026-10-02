// Folio Notes became Marklore in v0.2.0. Its profile folder (tabs, drafts,
// recent files, backups) moves with it on the first start of the new name:
// a rename within %APPDATA%, so nothing is copied. If the rename fails, for
// example because the old version is still running and holds files there,
// this start keeps using the old folder and the next start tries again.
import fs from "node:fs";
import path from "node:path";

export const profileName = "Marklore";
export const legacyProfileName = "folio-notes";

export function profileFolder(
  appData,
  { exists = fs.existsSync, rename = fs.renameSync } = {},
) {
  const current = path.join(appData, profileName),
    legacy = path.join(appData, legacyProfileName);
  if (exists(current) || !exists(legacy)) return current;
  try {
    rename(legacy, current);
    return current;
  } catch {
    return legacy;
  }
}
