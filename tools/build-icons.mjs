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
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
  });
  // inset: the margin left around the image, as a fraction of the canvas.
  const draw = (svg, size, inset = 0) =>
    page.evaluate(
      async ({ svg, size, inset }) => {
        const image = new Image();
        image.src =
          "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const margin = size * inset;
        canvas
          .getContext("2d")
          .drawImage(
            image,
            margin,
            margin,
            size - 2 * margin,
            size - 2 * margin,
          );
        return {
          png: canvas.toDataURL("image/png").split(",")[1],
          rgba: Array.from(
            canvas.getContext("2d").getImageData(0, 0, size, size).data,
          ),
        };
      },
      { svg, size, inset },
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
  // macOS: Apple's grid puts the 824 px tile in a 1024 px canvas, so the
  // mark's tile (60 of its 64 units) is drawn at that size. PNG entries only;
  // the book alone below 64 px, as on Windows.
  const inset = (1 - (824 / 1024) * (64 / 60)) / 2;
  const entries = [
    ["icp4", 16],
    ["icp5", 32],
    ["ic11", 32],
    ["ic12", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic13", 256],
    ["ic09", 512],
    ["ic14", 512],
    ["ic10", 1024],
  ];
  const chunks = [];
  for (const [type, size] of entries) {
    const data = await draw(size < 64 ? small : full, size, inset);
    const png = Buffer.from(data.png, "base64"),
      head = Buffer.alloc(8);
    head.write(type, 0, "latin1");
    head.writeUInt32BE(png.length + 8, 4);
    chunks.push(head, png);
  }
  const icns = Buffer.concat(chunks),
    icnsHead = Buffer.alloc(8);
  icnsHead.write("icns", 0, "latin1");
  icnsHead.writeUInt32BE(icns.length + 8, 4);
  await fs.writeFile(
    path.join(out, "folio.icns"),
    Buffer.concat([icnsHead, icns]),
  );
  console.log(
    "Built Folio mark: PNG, tray, 8-resolution Windows ICO (book-only below 32 px) and macOS ICNS.",
  );
} finally {
  await browser.close();
}
