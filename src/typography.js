// Target optical weight: `auto` lifts thin low-DPI light strokes (450),
// while higher DPR and dark mode stay at 400.
export function readingWeight({
  weight,
  dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1,
  theme = "light",
} = {}) {
  const n = Number(weight);
  if (n === 600) return 500;
  if ([400, 450, 500].includes(n)) return n;
  return dpr <= 1.25 && theme !== "dark" ? 450 : 400;
}

// Keep `auto` / `450` on real CSS font-weight 400 so static CJK faces stay Regular
// and only variable fonts lift via font-variation-settings "wght"; only 500 uses 500.
export const bodyFontWeight = (targetWeight) =>
  targetWeight >= 500 ? 500 : 400;

// Always keep strong text and headings at least 150 above body weight,
// capping at 700 so body (<=500) and bold (>=650) never collide.
export const emphasisWeight = (bodyWeight) =>
  Math.min(700, Math.max(600, bodyWeight + 200));

// Fluid multiplier: 1.0 up to 1366 CSS px, rising linearly to 1.09 at >=1920.
export function fluidFactor(viewportWidth = 1366) {
  const t = Math.min(1, Math.max(0, (viewportWidth - 1366) / (1920 - 1366)));
  return 1 + 0.09 * t;
}

export const typefaceBase = (typeface) => (typeface === "literata" ? 16 : 18);

export function noteSize({
  typeface = "literata",
  zoom = 100,
  viewportWidth = 1366,
} = {}) {
  return (typefaceBase(typeface) * fluidFactor(viewportWidth) * zoom) / 100;
}
