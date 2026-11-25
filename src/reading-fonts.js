// Faces of the default serif pairing, generated so each script is tuned on its own:
// - Latin (Source Serif 4) is scaled with size-adjust to the x-height the
//   default face has always had (Literata's 0.52 em), so it sits level with
//   16 px Chinese and the existing size, rhythm and formula scale still fit.
// - Chinese (Noto Serif SC) gets one face per requested weight, pinned by the
//   font-variation-settings descriptor to that weight + CJK_BOOST. Song strokes
//   are thinner than Latin ones at the same nominal weight; the boost keeps the
//   two scripts the same colour (measured with .local/typo/weight-check.mjs).
// A weight without its own face falls back to the nearest one (CSS font matching).
import latinCss from "@fontsource-variable/source-serif-4/standard.css?raw";
import latinItalicCss from "@fontsource-variable/source-serif-4/standard-italic.css?raw";
import cjkCss from "@fontsource-variable/noto-serif-sc/wght.css?raw";

export const SERIF_LATIN = "Marklore Serif Latin";
export const SERIF_CJK = "Marklore Serif SC";
export const SERIF_LATIN_SIZE = "113%";
export const CJK_BOOST = 100;
export const serifStack = `"${SERIF_LATIN}", "${SERIF_CJK}", "Songti SC", SimSun, serif`;

const faces = (css) =>
  [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);
const family = (face, name) =>
  face.replace(/font-family:[^;]+;/, `font-family: '${name}';`);

const latinFaces = [...faces(latinCss), ...faces(latinItalicCss)].map((face) =>
  family(face, SERIF_LATIN).replace(
    /font-display:[^;]+;/,
    (display) => `${display}\n  size-adjust: ${SERIF_LATIN_SIZE};`,
  ),
);
const cjkFaces = faces(cjkCss).map((face) => family(face, SERIF_CJK));

// `url` maps a fontsource "./files/x.woff2" reference to where the file is served.
export function serifFaceCss(weights, url = (ref) => ref) {
  const steps = [...new Set(weights.map((w) => Math.round(Number(w))))]
    .filter((w) => w >= 100 && w <= 900)
    .sort((a, b) => a - b);
  const pinned = steps.flatMap((step) =>
    cjkFaces.map((face) =>
      face.replace(
        /font-weight:[^;]+;/,
        `font-weight: ${step};\n  font-variation-settings: "wght" ${Math.min(900, step + CJK_BOOST)};`,
      ),
    ),
  );
  return [...latinFaces, ...pinned]
    .join("\n")
    .replace(/url\((\.\/files\/[^)]+)\)/g, (_, ref) => `url(${url(ref)})`);
}

// Served URLs of the font files (file name → URL), from one virtual module
// (vite.config.mjs) instead of a module per file.
import served from "virtual:serif-font-urls";

const servedUrl = (ref) => served[ref.slice("./files/".length)] || ref;

let appliedSteps = "";
// Keeps the page's serif faces in step with the weights in use.
export function applySerifFaces(weights) {
  const steps = [...new Set(weights)].sort().join(",");
  if (steps === appliedSteps) return;
  appliedSteps = steps;
  let style = document.getElementById("serif-faces");
  if (!style) {
    style = document.createElement("style");
    style.id = "serif-faces";
    document.head.append(style);
  }
  style.textContent = serifFaceCss(weights, servedUrl);
}
