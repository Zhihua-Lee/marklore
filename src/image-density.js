// An image nobody sized shows at the size its file records (a screenshot
// taken at 2x shows at half its pixels), through a density descriptor
// (`srcset="… 2x"`): the browser then lays it out at that size from the
// start, without a jump. The factor comes from the file's first bytes
// (desktop/image-density.mjs): read here for an embedded image, asked of the
// main process for a note's own (once per address; kept for the session).
// An explicit width (the `<img width>` form) wins, and so does the size
// range of image-layout.css.
import { imageDensity } from "../desktop/image-density.mjs";

const factors = new Map();
const asked = new Map();
// The factor for an address: a number, or null while it is being asked for.
function factorOf(src) {
  if (factors.has(src)) return factors.get(src);
  const data = /^data:image\/(?:png|jpeg);base64,/i.exec(src);
  if (data) {
    // A few kilobytes of the start: where the density is written.
    const head = src.slice(data[0].length, data[0].length + 87384);
    let factor = 1;
    try {
      const text = atob(head.slice(0, head.length - (head.length % 4)));
      factor = imageDensity(Uint8Array.from(text, (c) => c.charCodeAt(0)));
    } catch {}
    remember(src, factor);
    return factor;
  }
  const url = /^folio-asset:/.test(src) && new URL(src);
  const api = globalThis.window?.folio;
  if (!url || !api?.imageInfo) {
    remember(src, 1);
    return 1;
  }
  if (!asked.has(src))
    asked.set(
      src,
      api
        .imageInfo(url.hostname, url.searchParams.get("path") || "", {
          density: true,
        })
        .then((info) => remember(src, Number(info?.density) || 1))
        .catch(() => remember(src, 1))
        .finally(() => asked.delete(src)),
    );
  return null;
}
function remember(src, factor) {
  if (factors.size >= 4000) factors.clear();
  factors.set(src, factor);
  return factor;
}
// Show `img` at its recorded density unless it was given a width.
export function applyDensity(img) {
  const src = img.getAttribute("src") || "";
  if (!src || img.hasAttribute("width")) return;
  const set = (factor) => {
    if (
      factor > 1 &&
      img.getAttribute("src") === src &&
      !img.hasAttribute("width")
    )
      img.setAttribute("srcset", `${src} ${factor}x`);
  };
  const factor = factorOf(src);
  if (factor !== null) set(factor);
  else asked.get(src)?.then(() => set(factors.get(src)));
}
