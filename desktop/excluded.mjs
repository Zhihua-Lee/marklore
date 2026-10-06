// Library folders left out of search and backlinks: chosen by right-clicking
// a folder in the library, listed in Settings, kept with the settings. Pure
// JavaScript, shared by the renderer (settings) and the main process (index).

export const MAX_EXCLUDED = 200;
const ABSOLUTE = /^(?:[a-z]:[\\/]|[\\/]{2}[^\\/])/i;
const key = (p) =>
  p
    .replace(/[\\/]+/g, "\\")
    .replace(/\\$/, "")
    .toLowerCase();

// Absolute paths only, each once (case-insensitively), at most 200.
export function normalizeExcluded(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(),
    out = [];
  for (const p of list) {
    if (typeof p !== "string" || p.length > 1024 || !ABSOLUTE.test(p)) continue;
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= MAX_EXCLUDED) break;
  }
  return out;
}

// Is this file or folder one of the excluded folders or inside one?
export function excludedBy(list) {
  const keys = list.map(key);
  return (p) => {
    const k = key(p);
    return keys.some((e) => k === e || k.startsWith(e + "\\"));
  };
}
