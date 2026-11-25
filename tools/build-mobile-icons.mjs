// Home-screen icons for the phone reader (mobile/public): the app mark on an
// opaque page-coloured square (iOS shows transparent icon pixels as black).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = await fs.readFile(path.join(root, "src/folio.svg"), "utf8");
const out = path.join(root, "mobile/public");
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.FOLIO_BROWSER_CHANNEL ?? "",
});
try {
  const page = await browser.newPage();
  for (const [name, size, inset] of [
    ["icon-180.png", 180, 0.14],
    ["icon-192.png", 192, 0.14],
    ["icon-512.png", 512, 0.14],
    // Android "maskable": the mark inside the central safe zone.
    ["icon-maskable-512.png", 512, 0.22],
  ]) {
    const data = await page.evaluate(
      async ({ svg, size, inset }) => {
        const image = new Image();
        image.src =
          "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const g = canvas.getContext("2d");
        g.fillStyle = "#f6f5f1";
        g.fillRect(0, 0, size, size);
        const m = Math.round(size * inset);
        g.drawImage(image, m, m, size - 2 * m, size - 2 * m);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { svg, size, inset },
    );
    await fs.writeFile(path.join(out, name), Buffer.from(data, "base64"));
  }
} finally {
  await browser.close();
}
console.log("icons written to", out);
