export const WEIGHT_STEPS = Object.freeze([300, 350, 400, 450, 500, 550]);

// Target optical weight: `auto` lifts thin low-DPI light strokes (450),
// while higher DPR, dark mode, or the v0.6.4 comparison rule stay at 400.
export function readingWeight({
  weight,
  dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1,
  theme = "light",
  autoRule = "new",
  typeface = "",
} = {}) {
  const n = Number(weight);
  if (n === 600) return 550;
  if (WEIGHT_STEPS.includes(n)) return n;
  if (autoRule === "v064") return 400;
  // Source Serif is lighter than the sans faces at the same nominal weight
  // (measured against the previous default): auto reads 100 heavier.
  const lift = typeface === "serif" ? 100 : 0;
  return (dpr <= 1.25 && theme !== "dark" ? 450 : 400) + lift;
}

// Keep static CJK faces on CSS 400 for weights below 500 so `450` / `auto` never
// snaps static Noto Sans SC to Medium 500. Variable stacks pass plain font-weight.
export const bodyFontWeight = (targetWeight) =>
  targetWeight >= 500 ? 500 : 400;

// Always keep strong text and headings at least 150 above body weight,
// capping at 800 so all steps up to 550 keep strong emphasis contrast.
export const emphasisWeight = (bodyWeight) =>
  Math.min(800, Math.max(600, bodyWeight + 200));

// Fluid multiplier: 1.0 up to 1366 CSS px, rising linearly to 1.09 at >=1920.
export function fluidFactor(viewportWidth = 1366) {
  const t = Math.min(1, Math.max(0, (viewportWidth - 1366) / (1920 - 1366)));
  return 1 + 0.09 * t;
}

export const typefaceBase = (typeface) => (typeface === "serif" ? 16 : 18);

export function noteSize({
  typeface = "serif",
  zoom = 100,
  viewportWidth = 1366,
} = {}) {
  return (typefaceBase(typeface) * fluidFactor(viewportWidth) * zoom) / 100;
}

// Keeps only @font-face subsets whose unicode-range matches at least one
// code point present in the note so HTML export stays compact.
export function subsetFontCss(fontCss, text) {
  const used = new Set();
  for (const ch of String(text || "")) used.add(ch.codePointAt(0));
  if (!used.size) return "";
  const kept = [];
  for (const [face] of String(fontCss || "").matchAll(
    /@font-face\s*\{[^}]*\}/g,
  )) {
    const rangeSpec = face.match(/unicode-range\s*:\s*([^;]+)/i)?.[1];
    if (!rangeSpec) {
      kept.push(face);
      continue;
    }
    let hit = false;
    for (const part of rangeSpec.split(",")) {
      const m = /^U\+([0-9a-f]+)(?:-([0-9a-f]+))?$/i.exec(part.trim());
      if (!m) continue;
      const lo = parseInt(m[1], 16),
        hi = m[2] ? parseInt(m[2], 16) : lo;
      for (const cp of used) {
        if (cp >= lo && cp <= hi) {
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
    if (hit) kept.push(face);
  }
  return kept.join("\n");
}
