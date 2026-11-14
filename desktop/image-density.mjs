// An image's recorded pixel density, as a display factor: a screenshot taken
// on a 2x display (144 dpi in its file) shows at half its pixel size, as on
// the screen it was taken from. Read from the PNG pHYs chunk, or a JPEG's
// JFIF header or EXIF resolution; 1 when the file records none or something
// implausible. Shared by the main process (files on disk, read once per
// version) and the renderer (images embedded as data addresses).

// Dots per inch as a factor: up to 120 dpi is 1x (72 and 96 are both "one
// pixel per point" in the programs that write them); whole multiples of 72
// (macOS) or 96 (Windows) are 2x, 3x, 4x; anything else rounds to a quarter
// between 1x and 4x. Unequal axes or absurd values count as unknown.
export function densityFactor(x, y = x) {
  if (!(x > 0 && y > 0) || Math.abs(x - y) > 1) return 1;
  if (x < 50 || x > 1200 || x <= 120) return 1;
  for (const base of [72, 96]) {
    const f = x / base;
    const whole = Math.round(f);
    if (whole >= 2 && Math.abs(f - whole) < 0.05) return Math.min(whole, 4);
  }
  return Math.min(4, Math.max(1, Math.round((x / 96) * 4) / 4));
}

const u16 = (b, at, little = false) =>
  little ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1];
const u32 = (b, at, little = false) =>
  little
    ? (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
    : ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

function png(b) {
  for (let at = 8; at + 8 <= b.length;) {
    const length = u32(b, at);
    const type = String.fromCharCode(
      b[at + 4],
      b[at + 5],
      b[at + 6],
      b[at + 7],
    );
    if (type === "IDAT" || type === "IEND") break;
    if (type === "pHYs" && length === 9 && at + 17 <= b.length) {
      // Pixels per metre, when the unit is the metre.
      if (b[at + 16] !== 1) return 1;
      return shown(
        densityFactor(u32(b, at + 8) * 0.0254, u32(b, at + 12) * 0.0254),
        u32(b, 16),
        u32(b, 20),
      );
    }
    at += 12 + length;
  }
  return 1;
}

// EXIF: the first directory's resolution and its unit.
function exif(b, start, end) {
  const little = b[start] === 0x49;
  if (u16(b, start + 2, little) !== 42) return null;
  const ifd = start + u32(b, start + 4, little);
  if (ifd + 2 > end) return null;
  const count = u16(b, ifd, little);
  let x = null,
    y = null,
    unit = 2;
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    const tag = u16(b, entry, little);
    const rational = () => {
      const at = start + u32(b, entry + 8, little);
      if (at + 8 > end) return null;
      const d = u32(b, at + 4, little);
      return d ? u32(b, at, little) / d : null;
    };
    if (tag === 0x011a) x = rational();
    else if (tag === 0x011b) y = rational();
    else if (tag === 0x0128) unit = u16(b, entry + 8, little);
  }
  if (!x) return null;
  const scale = unit === 3 ? 2.54 : unit === 2 ? 1 : null;
  return scale ? densityFactor(x * scale, (y ?? x) * scale) : 1;
}
function jpeg(b) {
  let jfif = null,
    found = null,
    size = null;
  for (let at = 2; at + 4 <= b.length;) {
    if (b[at] !== 0xff) break;
    const marker = b[at + 1];
    if (marker === 0xda || marker === 0xd9) break;
    // A frame header: the picture's size.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker) &&
      at + 9 <= b.length
    )
      size = [u16(b, at + 7), u16(b, at + 5)];
    const length = u16(b, at + 2);
    const data = at + 4;
    const end = Math.min(b.length, at + 2 + length);
    const tag = String.fromCharCode(...b.subarray(data, data + 5));
    if (marker === 0xe0 && tag === "JFIF\0" && data + 12 <= end) {
      const unit = b[data + 7];
      const scale = unit === 1 ? 1 : unit === 2 ? 2.54 : null;
      if (scale)
        jfif = densityFactor(
          u16(b, data + 8) * scale,
          u16(b, data + 10) * scale,
        );
    } else if (marker === 0xe1 && tag === "Exif\0" && data + 14 <= end) {
      found ??= exif(b, data + 6, end);
    }
    at += 2 + length;
  }
  return size ? shown(found ?? jfif ?? 1, ...size) : (found ?? jfif ?? 1);
}

// An icon is not made smaller than a small image (48px on its longer side):
// shown at its pixel size instead.
export const SMALLEST = 48;
const shown = (factor, width, height) =>
  Math.max(width, height) / factor < SMALLEST ? 1 : factor;

// The factor recorded at the start of an image file (its first bytes are
// enough: the density comes before the pixels).
export function imageDensity(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return png(b);
  if (b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
  return 1;
}
// How much of a file to read for it.
export const DENSITY_BYTES = 256 * 1024;
