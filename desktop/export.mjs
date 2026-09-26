import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

const limit = 96 * 1024 * 1024;
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const digest = (value) => createHash("sha256").update(value).digest("hex");
const imageTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};
async function boundedPrint(render) {
  let timer;
  try {
    return await Promise.race([
      render(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(Error("导出排版超过 30 秒，请缩小笔记后重试")),
          30000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function buildExportDocument(
  payload,
  files,
  dist,
  noticesPath = path.join(dist, "../THIRD-PARTY-NOTICES.txt"),
) {
  if (
    !payload ||
    !["pdf", "html"].includes(payload.format) ||
    typeof payload.html !== "string" ||
    typeof payload.css !== "string" ||
    Buffer.byteLength(payload.html) > 32 * 1024 * 1024 ||
    Buffer.byteLength(payload.css) > 1024 * 1024 ||
    !Array.isArray(payload.images) ||
    payload.images.length > 500
  )
    throw Error("无效或过大的导出内容");
  if (payload.fileId) files.file(payload.fileId);
  let html = payload.html,
    css = payload.css;
  if (/<\/style/i.test(css) || /@import\b/i.test(css))
    throw Error("不支持的导出样式");
  const assetNames = await fs.readdir(path.join(dist, "assets"));
  const fontFaces = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)];
  for (const [face] of fontFaces) {
    const font = face.match(
      /url\(\s*(?:["'])?(?:\.\/)?(?:fonts|files)\/((?:KaTeX_[A-Za-z0-9]+-[A-Za-z]+|literata-[a-z-]+|jetbrains-mono-[a-z-]+))\.woff2(?:["'])?\)/,
    )?.[1];
    if (!font) throw Error("导出字体资源缺失");
    const bundled = assetNames.find(
      (name) => name.startsWith(font + "-") && name.endsWith(".woff2"),
    );
    if (!bundled) throw Error("缺少离线数学字体：" + font);
    const bytes = await fs.readFile(path.join(dist, "assets", bundled));
    const embedded = face.replace(
      /src:[^;}]+/,
      `src:url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2")`,
    );
    css = css.replace(face, embedded);
  }
  // No resource URL other than the embedded fonts is allowed in the export CSS.
  if (/url\((?!["']?data:font\/woff2;base64,)/i.test(css))
    throw Error("导出样式包含非离线资源");
  for (const image of payload.images) {
    if (
      !payload.fileId ||
      !image ||
      !/^[a-f0-9-]{36}$/.test(image.key) ||
      typeof image.path !== "string" ||
      image.path.length > 8192
    )
      throw Error("无效导出图片");
    const file = await files.asset(payload.fileId, image.path);
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024)
      throw Error("单张导出图片上限为 20 MB");
    const bytes = await fs.readFile(file);
    if (bytes.length > 20 * 1024 * 1024) throw Error("导出图片过大");
    const source = `src="folio-export-image:${image.key}"`;
    if (!html.includes(source)) throw Error("导出图片引用无效");
    html = html.replaceAll(
      source,
      `src="data:${imageTypes[path.extname(file).toLowerCase()]};base64,${bytes.toString("base64")}"`,
    );
    if (Buffer.byteLength(html) > limit)
      throw Error("导出内容过大（上限 96 MB）");
  }
  if (/folio-(?:asset|export-image):/i.test(html))
    throw Error("存在未嵌入的图片");
  const title = String(payload.name || "Untitled").slice(0, 500);
  const notices = await fs.readFile(noticesPath, "utf8");
  // The first policy cannot be weakened by note markup. No scripts, connections,
  // frames, forms or filesystem resources exist in this standalone document.
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><style>${css}</style></head><body><article>${html}</article><template id="folio-resource-licenses">${escape(notices)}</template></body></html>`;
}

async function destinationSnapshot(destination, files) {
  const extension = path.extname(destination).toLowerCase();
  if (![".pdf", ".html", ".htm"].includes(extension))
    throw Error("导出目标必须使用 .pdf 或 .html 扩展名");
  const parent = await fs.realpath(path.dirname(destination));
  const actual = path.join(parent, path.basename(destination));
  for (const source of files.files.values())
    if (source.path.toLowerCase() === actual.toLowerCase())
      throw Error("不能覆盖已打开的笔记");
  try {
    const stat = await fs.lstat(actual);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
      throw Error("导出目标不是可替换的普通文件");
    return { actual, hash: digest(await fs.readFile(actual)) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { actual, hash: null };
  }
}

export function createExporter({
  BrowserWindow,
  dialog,
  owner,
  files,
  dist,
  noticesPath,
}) {
  let exporting = false;
  return async (payload) => {
    if (exporting) throw Error("正在导出，请稍候");
    exporting = true;
    let printer,
      temp,
      printSession,
      printProtocolRegistered = false;
    try {
      const document = await buildExportDocument(
        payload,
        files,
        dist,
        noticesPath,
      );
      const extension = payload.format === "pdf" ? "pdf" : "html";
      const name =
        path
          .basename(String(payload.name || "Untitled.md"))
          .replace(/\.[^.]*$/, "") +
        "." +
        extension;
      const choice = await dialog.showSaveDialog(owner(), {
        title: extension === "pdf" ? "导出 PDF" : "导出独立 HTML",
        defaultPath: name,
        filters: [
          {
            name: extension === "pdf" ? "PDF" : "HTML",
            extensions: [extension],
          },
        ],
      });
      if (choice.canceled || !choice.filePath) return { canceled: true };
      if (path.extname(choice.filePath).toLowerCase() !== "." + extension)
        throw Error("请选择 ." + extension + " 导出文件");
      const destination = await destinationSnapshot(choice.filePath, files);
      let bytes = Buffer.from(document, "utf8");
      if (payload.format === "pdf") {
        printer = new BrowserWindow({
          show: false,
          width: 794,
          height: 1123,
          webPreferences: {
            sandbox: true,
            nodeIntegration: false,
            contextIsolation: true,
            spellcheck: false,
            partition: "folio-export-" + randomUUID(),
          },
        });
        printSession = printer.webContents.session;
        const printURL = "https://folio-export.invalid/" + randomUUID();
        // Serve only this in-memory document in its private partition. A data:
        // navigation has Chromium URL-length limits once fonts are embedded.
        printSession.protocol.handle("https", (request) =>
          request.url === printURL
            ? new Response(document, {
                headers: {
                  "content-type": "text/html; charset=utf-8",
                  "X-Content-Type-Options": "nosniff",
                },
              })
            : new Response(null, { status: 403 }),
        );
        printProtocolRegistered = true;
        printSession.setPermissionRequestHandler((_wc, _permission, done) =>
          done(false),
        );
        printSession.setPermissionCheckHandler(() => false);
        printSession.webRequest.onBeforeRequest((details, done) =>
          done({
            cancel:
              details.url !== printURL && !details.url.startsWith("data:"),
          }),
        );
        printer.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        printer.webContents.on("will-navigate", (event) =>
          event.preventDefault(),
        );
        bytes = await boundedPrint(async () => {
          await printer.loadURL(printURL);
          await printer.webContents.executeJavaScript(
            `(async()=>{await document.fonts.ready; await Promise.all([...document.images].map(image=>image.decode().catch(()=>{throw Error("导出图片解码失败")}))); return true})()`,
          );
          return printer.webContents.printToPDF({
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: false,
            generateTaggedPDF: true,
          });
        });
      }
      if (bytes.length > limit) throw Error("导出结果过大（上限 96 MB）");
      const beforeWrite = await destinationSnapshot(choice.filePath, files);
      if (
        beforeWrite.actual !== destination.actual ||
        beforeWrite.hash !== destination.hash
      )
        throw Error("目标文件在导出期间改变，请另选文件名");
      temp = path.join(
        path.dirname(destination.actual),
        ".folio-export-" + randomUUID() + ".tmp",
      );
      const handle = await fs.open(temp, "wx");
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const beforeReplace = await destinationSnapshot(choice.filePath, files);
      if (
        beforeReplace.actual !== destination.actual ||
        beforeReplace.hash !== destination.hash
      )
        throw Error("目标文件在导出期间改变，请另选文件名");
      await fs.rename(temp, destination.actual);
      temp = null;
      return {
        path: choice.filePath,
        format: payload.format,
        warnings: Array.isArray(payload.warnings)
          ? payload.warnings
              .filter((item) => typeof item === "string")
              .slice(0, 500)
          : [],
      };
    } finally {
      if (printer && !printer.isDestroyed()) printer.destroy();
      // Electron sessions outlive their windows. Release both callbacks that
      // otherwise retain the complete embedded document through this scope.
      if (printProtocolRegistered) printSession.protocol.unhandle("https");
      if (printSession) printSession.webRequest.onBeforeRequest(null);
      if (temp) await fs.unlink(temp).catch(() => {});
      exporting = false;
    }
  };
}
