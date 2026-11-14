// Synthetic pictures for the image layout specs: plain PNGs of a size and a
// colour, as data addresses (the dev server cannot load a note's assets).
import zlib from "node:zlib";
import fs from "node:fs";

// With FOLIO_SHOTS set, a screenshot for review in .local/image-layout,
// `scroll` (a selector) brought into view first.
const shots = new URL("../../.local/image-layout/", import.meta.url);
export async function shot(page, name, scroll = null) {
  if (!process.env.FOLIO_SHOTS) return;
  if (scroll)
    await page
      .locator(scroll)
      .first()
      .evaluate((el) => el.scrollIntoView({ block: "center" }));
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({
    path: new URL(name + ".png", shots).pathname.slice(1),
  });
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
// A picture of width × height in one colour, a darker band across it.
export function picture(width, height, [r, g, b]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    const shade = Math.abs(y - height / 2) < height / 10 ? 0.8 : 1;
    for (let x = 0; x < width; x++)
      row.set([r * shade, g * shade, b * shade].map(Math.round), 1 + x * 3);
    rows.push(row);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return "data:image/png;base64," + png.toString("base64");
}
export const sage = picture(600, 400, [143, 170, 156]);
export const sand = picture(480, 360, [205, 186, 150]);
export const slate = picture(400, 400, [128, 145, 166]);
