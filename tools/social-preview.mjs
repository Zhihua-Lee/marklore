// The repository's social preview card (1280×640), shown where the repo link
// is shared. Upload it in GitHub: Settings → General → Social preview.
//   node tools/social-preview.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logo = await fs.readFile(path.join(root, "docs/images/logo.svg"), "utf8");
const shot = await fs.readFile(path.join(root, "docs/images/en/overview.png"));
const out = path.join(root, "docs/images/social-preview.png");

const html = `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; }
  body { width: 1280px; height: 640px; overflow: hidden; position: relative;
    background: #f5f1e5; color: #1f2a26; font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif; }
  .text { position: absolute; left: 80px; top: 92px; width: 470px; }
  .text svg { width: 112px; height: 112px; display: block; margin-left: -6px; }
  h1 { font-size: 76px; font-weight: 700; letter-spacing: -1.5px; margin: 26px 0 0; color: #285e50; }
  .idea { font-size: 34px; line-height: 1.3; font-weight: 600; margin: 18px 0 0; }
  .zh { font-size: 26px; margin: 14px 0 0; font-family: "Microsoft YaHei UI", sans-serif; color: #3d4a45; }
  .what { font-size: 21px; line-height: 1.45; margin: 26px 0 0; color: #56635e; }
  .shot { position: absolute; left: 600px; top: 76px; width: 900px; border-radius: 14px;
    box-shadow: 0 18px 50px rgba(31, 42, 38, 0.22), 0 0 0 1px rgba(31, 42, 38, 0.10); }
  .band { position: absolute; left: 0; right: 0; bottom: 0; height: 10px; background: #285e50; }
</style>
<div class="text">${logo}
  <h1>Marklore</h1>
  <p class="idea">AI drafts, you refine<br>and mark up.</p>
  <p class="zh">AI 打初稿，你来细修和批注</p>
  <p class="what">A Markdown knowledge base for Windows.<br>Plain .md files on your disk.</p>
</div>
<img class="shot" src="data:image/png;base64,${shot.toString("base64")}">
<div class="band"></div>`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html);
  await page.locator(".shot").evaluate((image) => image.decode());
  await page.screenshot({ path: out });
} finally {
  await browser.close();
}
console.log(`${path.relative(root, out)} ${(await fs.stat(out)).size} bytes`);
