import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "folio-native-export-"));
const note = path.join(temp, "source.md"),
  htmlPath = path.join(temp, "export.html"),
  pdfPath = path.join(temp, "export.pdf");
const source = `# Export fixture\n\nEnglish and 中文 paragraph with $e^{i\\pi}+1=0$.\n\n<mark style="background-color: #f2d878; color: #000000">Highlighted</mark> <span style="color: #b23c36">Colored</span>\n\n## Folded section\n\nFOLDED CONTENT INCLUDED\n\n<details><summary>Details title</summary><p>CLOSED DETAILS INCLUDED 中文</p></details>\n\n![Local illustration](image.svg)\n\n\`\`\`mermaid\nflowchart LR\nA[Draft] --> B[Export]\n\`\`\`\n\n<div style="break-before:page">SECOND PAGE END</div>\n`;
await fs.writeFile(note, source);
await fs.writeFile(
  path.join(temp, "image.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="50"><rect width="180" height="50" fill="#357d70"/><text x="15" y="32" fill="white" font-size="20">LOCAL IMAGE</text></svg>',
);
let instance;
try {
  instance = await electron.launch({
    ...(process.env.FOLIO_TEST_EXE
      ? { executablePath: process.env.FOLIO_TEST_EXE }
      : {}),
    args: process.env.FOLIO_TEST_EXE ? [note] : [project, note],
    env: {
      ...process.env,
      FOLIO_DATA_DIR: path.join(temp, "profile"),
      ELECTRON_RUN_AS_NODE: undefined,
    },
    timeout: 30000,
  });
  const page = await instance.firstWindow();
  await instance.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].hide(),
  );
  await page.locator("#content h1").waitFor();
  const command = (cmd) =>
    instance.evaluate(
      ({ BrowserWindow }, name) =>
        BrowserWindow.getAllWindows()[0].webContents.send(
          "folio:command",
          name,
        ),
      cmd,
    );
  await command("edit");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nUNSAVED DRAFT INCLUDED");
  await command("read");
  await page.locator("#content .diagram svg").waitFor();
  await page.locator("#content .fold").first().click();
  const choose = (destination) =>
    instance.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, destination);
  const written = async (file) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (
        await fs
          .stat(file)
          .then((s) => s.size > 0)
          .catch(() => false)
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error(
      "Export was not written: " + (await page.locator("#toast").textContent()),
    );
  };
  await choose(htmlPath);
  await command("exportHTML");
  await written(htmlPath);
  const html = await fs.readFile(htmlPath, "utf8");
  assert.match(html, /UNSAVED DRAFT INCLUDED/);
  assert.match(html, /FOLDED CONTENT INCLUDED/);
  assert.match(html, /CLOSED DETAILS INCLUDED/);
  assert.match(html, /<details open/);
  assert.match(html, /data:image\/svg\+xml;base64,/);
  assert.match(html, /data:font\/woff2;base64,/);
  assert.match(html, /Literata Variable/);
  assert.match(html, /SIL OPEN FONT LICENSE/);
  assert.doesNotMatch(
    html,
    /folio-asset:|folio-export-image:|class="fold"|id="toolbar"/,
  );
  assert.equal(await fs.readFile(note, "utf8"), source);
  await instance.evaluate(({ app }) => {
    globalThis.__exportLifecycle = {
      registered: 0,
      removed: 0,
      requestsCleared: 0,
    };
    app.on("session-created", (session) => {
      const handle = session.protocol.handle.bind(session.protocol);
      const unhandle = session.protocol.unhandle.bind(session.protocol);
      const requests = session.webRequest.onBeforeRequest.bind(
        session.webRequest,
      );
      session.protocol.handle = (scheme, handler) => {
        const result = handle(scheme, handler);
        if (scheme === "https") globalThis.__exportLifecycle.registered++;
        return result;
      };
      session.protocol.unhandle = (scheme) => {
        const result = unhandle(scheme);
        if (scheme === "https") globalThis.__exportLifecycle.removed++;
        return result;
      };
      session.webRequest.onBeforeRequest = (...args) => {
        const result = requests(...args);
        if (args.at(-1) === null)
          globalThis.__exportLifecycle.requestsCleared++;
        return result;
      };
    });
  });
  await choose(pdfPath);
  await command("exportPDF");
  await written(pdfPath);
  const pdf = await fs.readFile(pdfPath);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 10000);
  assert.equal(await fs.readFile(note, "utf8"), source);
  assert.deepEqual(
    await instance.evaluate(() => globalThis.__exportLifecycle),
    { registered: 1, removed: 1, requestsCleared: 1 },
  );
  const failedPath = path.join(temp, "invalid-image.pdf");
  await choose(failedPath);
  const rejected = await page.evaluate(async () => {
    try {
      await window.folio.exportNote({
        format: "pdf",
        name: "failure.md",
        fileId: null,
        html: '<img src="data:image/png;base64,aGVsbG8=">',
        css: "",
        images: [],
        warnings: [],
      });
      return "unexpected success";
    } catch (error) {
      return error.message;
    }
  });
  assert.match(rejected, /图片解码失败/);
  assert.equal(
    await fs
      .stat(failedPath)
      .then(() => true)
      .catch(() => false),
    false,
  );
  assert.deepEqual(
    await instance.evaluate(() => globalThis.__exportLifecycle),
    { registered: 2, removed: 2, requestsCleared: 2 },
  );
  const artifacts = path.join(project, ".local");
  await fs.mkdir(artifacts, { recursive: true });
  await fs.copyFile(pdfPath, path.join(artifacts, "export-smoke.pdf"));
  await fs.copyFile(htmlPath, path.join(artifacts, "export-smoke.html"));
  await instance.evaluate(async ({ BrowserWindow }, file) => {
    const preview = new BrowserWindow({
      show: false,
      width: 1000,
      height: 1000,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        // Keep the QA-only hidden preview painting even without a desktop surface.
        backgroundThrottling: false,
        offscreen: true,
      },
    });
    await preview.loadFile(file);
  }, htmlPath);
  const standalone = instance.windows().at(-1);
  await standalone.evaluate(() => document.fonts.ready);
  await standalone.waitForFunction(() =>
    [...document.images].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  assert.equal(await standalone.locator(".katex").count(), 1);
  assert.equal(await standalone.locator(".diagram svg").count(), 1);
  assert.equal(
    await standalone.locator("details").evaluate((element) => element.open),
    true,
  );
  assert.equal(await standalone.evaluate(() => typeof require), "undefined");
  assert.equal(
    await standalone
      .locator("mark")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(242, 216, 120)",
  );
  assert.equal(
    await standalone
      .locator('span[style*="--folio-color"]')
      .evaluate((el) => getComputedStyle(el).color),
    "rgb(178, 60, 54)",
  );
  const fonts = await standalone.evaluate(() => ({
    literature: document.fonts.check('16px "Literata Variable"', "Export"),
    mathematics: document.fonts.check("italic 16px KaTeX_Math", "e"),
  }));
  assert.equal(fonts.literature, true);
  assert.equal(fonts.mathematics, true);
  await standalone.screenshot({
    path: path.join(artifacts, "export-smoke-html.png"),
    fullPage: true,
  });
  console.log(
    `Native export passed: PDF ${pdf.length} bytes; standalone HTML ${Buffer.byteLength(html)} bytes; unsaved text, expanded folds/details, embedded image/fonts and Mermaid; source unchanged.`,
  );
} finally {
  if (instance) {
    await instance.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await instance.close().catch(() => {});
  }
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
