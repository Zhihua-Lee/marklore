// The density factor of an image file on disk (image-density.mjs): only its
// first bytes are read, once per version of the file (path, size, time).
import fs from "node:fs/promises";
import { imageDensity, DENSITY_BYTES } from "./image-density.mjs";

const known = new Map();
export async function fileDensity(file) {
  const stat = await fs.stat(file);
  const key = `${file}\0${stat.size}\0${stat.mtimeMs}`;
  if (known.has(key)) return known.get(key);
  const handle = await fs.open(file, "r");
  let factor = 1;
  try {
    const buffer = Buffer.alloc(Math.min(DENSITY_BYTES, stat.size));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    factor = imageDensity(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
  if (known.size >= 2000) known.clear();
  known.set(key, factor);
  return factor;
}
