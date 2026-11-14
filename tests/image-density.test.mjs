import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { densityFactor, imageDensity } from "../desktop/image-density.mjs";
import { fileDensity } from "../desktop/image-density-file.mjs";

// The density an image file records, as the factor it is shown smaller by
// (desktop/image-density.mjs): only plausible values count.

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function png(ppmX, ppmY = ppmX, unit = 1, size = 200) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const phys = Buffer.alloc(9);
  phys.writeUInt32BE(ppmX, 0);
  phys.writeUInt32BE(ppmY, 4);
  phys[8] = unit;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...(ppmX === null ? [] : [chunk("pHYs", phys)]),
    chunk("IDAT", zlib.deflateSync(Buffer.alloc(14))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function jfif(unit, x, y = x) {
  const app0 = Buffer.from([
    0xff,
    0xe0,
    0,
    16,
    0x4a,
    0x46,
    0x49,
    0x46,
    0,
    1,
    1,
    unit,
    x >> 8,
    x & 255,
    y >> 8,
    y & 255,
    0,
    0,
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    Buffer.from([0xff, 0xda, 0, 2]),
  ]);
}
// A JPEG with EXIF (little-endian TIFF): XResolution, YResolution, unit.
function exifJpeg(dpi, unit = 2) {
  const tiff = Buffer.alloc(8 + 2 + 3 * 12 + 4 + 16);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(3, 8);
  const rational = 8 + 2 + 36 + 4;
  const entry = (i, tag, type, value) => {
    const at = 10 + i * 12;
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(1, at + 4);
    tiff.writeUInt32LE(value, at + 8);
  };
  entry(0, 0x011a, 5, rational);
  entry(1, 0x011b, 5, rational + 8);
  entry(2, 0x0128, 3, unit);
  for (const at of [rational, rational + 8]) {
    tiff.writeUInt32LE(dpi * 10, at);
    tiff.writeUInt32LE(10, at + 4);
  }
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    head,
    body,
    Buffer.from([0xff, 0xda, 0, 2]),
  ]);
}

test("dots per inch as a factor: 1x up to 120 dpi, whole multiples of 72 or 96", () => {
  for (const [dpi, factor] of [
    [72, 1],
    [96, 1],
    [120, 1],
    [144, 2],
    [192, 2],
    [216, 3],
    [288, 4],
    [150, 1.5],
    [600, 4],
    [30, 1],
    [5000, 1],
    [0, 1],
    [NaN, 1],
  ])
    assert.equal(densityFactor(dpi), factor, String(dpi));
  // Unequal axes: unknown.
  assert.equal(densityFactor(144, 72), 1);
});

test("a PNG's pHYs, a JPEG's JFIF or EXIF density", () => {
  assert.equal(imageDensity(png(5669)), 2); // 144 dpi
  assert.equal(imageDensity(png(2835)), 1); // 72 dpi
  assert.equal(imageDensity(png(3780)), 1); // 96 dpi
  assert.equal(imageDensity(png(7559)), 2); // 192 dpi
  assert.equal(imageDensity(png(5669, 5669, 0)), 1); // aspect only
  assert.equal(imageDensity(png(null)), 1);
  assert.equal(imageDensity(png(5669, 2835)), 1);
  assert.equal(imageDensity(jfif(1, 144)), 2);
  assert.equal(imageDensity(jfif(2, 57)), 2); // 57 per cm: 144.8 dpi
  assert.equal(imageDensity(jfif(0, 144)), 1);
  assert.equal(imageDensity(exifJpeg(144)), 2);
  assert.equal(imageDensity(exifJpeg(72)), 1);
  assert.equal(imageDensity(exifJpeg(300, 1)), 1); // no unit
  // An icon (32px at 144 dpi) is not made smaller than 48px.
  assert.equal(imageDensity(png(5669, 5669, 1, 32)), 1);
  assert.equal(imageDensity(png(5669, 5669, 1, 96)), 2);
  // Broken or cut short: no density.
  assert.equal(imageDensity(png(5669).subarray(0, 40)), 1);
  assert.equal(imageDensity(Buffer.from("GIF89a")), 1);
  assert.equal(imageDensity(Buffer.alloc(0)), 1);
});

test("a file's density is read from its start, once per version", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "marklore-density-"));
  try {
    const file = path.join(dir, "shot.png");
    await fs.writeFile(file, png(5669));
    assert.equal(await fileDensity(file), 2);
    await fs.writeFile(file, Buffer.concat([png(2835), Buffer.alloc(10)]));
    assert.equal(await fileDensity(file), 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
