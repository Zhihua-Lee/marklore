import { execFileSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { t } from "./i18n.mjs";

export const TEXT_RENDERING_MODES = Object.freeze([
  "auto",
  "grayscale",
  "subpixel",
]);

export function normalizeMode(mode) {
  return TEXT_RENDERING_MODES.includes(mode) ? mode : "auto";
}

export function normalizeScale(scale) {
  return typeof scale === "number" && Number.isFinite(scale) && scale > 0
    ? scale
    : null;
}

export function decide({ mode, scale } = {}) {
  const cleanMode = normalizeMode(mode);
  if (cleanMode === "grayscale") return "grayscale";
  if (cleanMode === "subpixel") return "subpixel";
  const effectiveScale = normalizeScale(scale) ?? 1;
  return effectiveScale >= 2 ? "grayscale" : "subpixel";
}

export function parseAppliedDpi(output) {
  const match = /AppliedDPI\s+REG_DWORD\s+(0x[0-9a-f]+|\d+)/i.exec(
    String(output || ""),
  );
  if (!match) return null;
  const raw = match[1];
  const dpi = /^0x/i.test(raw) ? parseInt(raw, 16) : Number(raw);
  return Number.isFinite(dpi) && dpi > 0 ? dpi / 96 : null;
}

export function readAppliedDpiSync({
  platform = process.platform,
  exec = execFileSync,
} = {}) {
  if (platform !== "win32") return null;
  try {
    const out = exec(
      "reg",
      [
        "query",
        "HKCU\\Control Panel\\Desktop\\WindowMetrics",
        "/v",
        "AppliedDPI",
      ],
      { timeout: 1000, encoding: "utf8" },
    );
    return parseAppliedDpi(out);
  } catch {
    return null;
  }
}

export function readTextRenderingSync(file, options = {}) {
  let raw = null;
  try {
    const parsed = JSON.parse(fsSync.readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      raw = parsed;
  } catch {
    // Missing or damaged file counts as default auto mode.
  }
  const mode = normalizeMode(raw?.mode);
  const storedScale = normalizeScale(raw?.scale);
  const persisted =
    raw &&
    TEXT_RENDERING_MODES.includes(raw.mode) &&
    (raw.scale == null || storedScale !== null)
      ? { mode, scale: storedScale }
      : null;
  const scale = storedScale ?? readAppliedDpiSync(options);
  return {
    mode,
    scale,
    effective: decide({ mode, scale }),
    persisted,
  };
}

export async function writeTextRendering(file, next) {
  const payload = {
    mode: normalizeMode(next?.mode),
    scale: normalizeScale(next?.scale),
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + ".tmp";
  await fs.writeFile(temp, JSON.stringify(payload) + "\n", "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(temp, file);
      return payload;
    } catch (error) {
      if (attempt >= 4 || !["EPERM", "EBUSY", "EACCES"].includes(error.code))
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}

export function createTextRenderingStore({
  file,
  initial,
  write = writeTextRendering,
}) {
  let mode = normalizeMode(initial?.mode);
  let scale = normalizeScale(initial?.scale);
  const effective = decide({ mode, scale });
  let persisted = initial?.persisted
    ? {
        mode: normalizeMode(initial.persisted.mode),
        scale: normalizeScale(initial.persisted.scale),
      }
    : null;
  let pending = Promise.resolve();

  function enqueueWrite() {
    const next = { mode, scale };
    if (
      persisted &&
      persisted.mode === next.mode &&
      persisted.scale === next.scale
    )
      return pending;
    persisted = next;
    pending = pending
      .catch(() => {})
      .then(() => write(file, next))
      .catch((error) => {
        console.warn("Folio: text-rendering save failed", error.message);
      });
    return pending;
  }

  return {
    status: () => ({ mode, effective, scale }),
    recordScale(nextScale) {
      const clean = normalizeScale(nextScale);
      if (clean === null || clean === scale) return false;
      scale = clean;
      void enqueueWrite();
      return true;
    },
    async setMode(nextMode) {
      if (!TEXT_RENDERING_MODES.includes(nextMode))
        throw Error(t("无效的文字抗锯齿设置"));
      mode = nextMode;
      await enqueueWrite();
      return { mode, effective, scale };
    },
    flush: () => pending,
  };
}
