import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Full mark (book, mug, steam) from 32 px up; the book alone below that and
// for the tray, where the mug would blur into noise.
const full = await fs.readFile(path.join(root, "src/folio.svg"), "utf8");
const small = await fs.readFile(path.join(root, "src/folio-small.svg"), "utf8");
const out = path.join(root, "desktop/icons");
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const sizes = [16, 20, 24, 32, 48, 64, 128, 256],
    images = [];
  const page = await browser.newPage({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 1,
  });
  const draw = (svg, size) =>
    page.evaluate(
      async ({ svg, size }) => {
        const image = new Image();
        image.src =
          "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        canvas.getContext("2d").drawImage(image, 0, 0, size, size);
        return {
          png: canvas.toDataURL("image/png").split(",")[1],
          rgba: Array.from(
            canvas.getContext("2d").getImageData(0, 0, size, size).data,
          ),
        };
      },
      { svg, size },
    );
  // The tray shows 16 px (32 px on high-DPI), so it always uses the book alone.
  const tray = await draw(small, 32);
  await fs.writeFile(
    path.join(out, "tray.png"),
    Buffer.from(tray.png, "base64"),
  );
  for (const size of sizes) {
    const data = await draw(size <= 24 ? small : full, size);
    const png = Buffer.from(data.png, "base64");
    // DIB entries keep small Windows shell icons compatible with classic icon
    // extractors; only the 256px entry uses PNG compression.
    if (size === 256) images.push(png);
    else {
      const rowBytes = Math.ceil(size / 32) * 4,
        colorBytes = size * size * 4;
      const dib = Buffer.alloc(40 + colorBytes + rowBytes * size);
      dib.writeUInt32LE(40, 0);
      dib.writeInt32LE(size, 4);
      dib.writeInt32LE(size * 2, 8);
      dib.writeUInt16LE(1, 12);
      dib.writeUInt16LE(32, 14);
      dib.writeUInt32LE(colorBytes, 20);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const source = (y * size + x) * 4,
            target = 40 + ((size - 1 - y) * size + x) * 4;
          dib[target] = data.rgba[source + 2];
          dib[target + 1] = data.rgba[source + 1];
          dib[target + 2] = data.rgba[source];
          dib[target + 3] = data.rgba[source + 3];
          if (!data.rgba[source + 3])
            dib[40 + colorBytes + (size - 1 - y) * rowBytes + (x >> 3)] |=
              128 >> (x % 8);
        }
      images.push(dib);
    }

    if (size === 256) await fs.writeFile(path.join(out, "folio.png"), png);
  }
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const i = 6 + index * 16;
    header[i] = header[i + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, i + 4);
    header.writeUInt16LE(32, i + 6);
    header.writeUInt32LE(images[index].length, i + 8);
    header.writeUInt32LE(offset, i + 12);
    offset += images[index].length;
  });
  await fs.writeFile(
    path.join(out, "folio.ico"),
    Buffer.concat([header, ...images]),
  );
  console.log(
    "Built Folio mark: PNG, tray and 8-resolution Windows ICO (book-only below 32 px).",
  );
} finally {
  await browser.close();
}
