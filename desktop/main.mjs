import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
  Menu,
  session,
} from "electron";
import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileStore, within, markdownPath } from "./files.mjs";
import { createExporter } from "./export.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)),
  dist = path.resolve(here, "../dist");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "folio",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: "folio-asset",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const profile = process.env.FOLIO_DATA_DIR;
if (profile && path.isAbsolute(profile)) app.setPath("userData", profile);
const files = new FileStore({
  backups: path.join(app.getPath("userData"), "backups"),
});
let win,
  ready = false,
  pending = [],
  dirty = false,
  savedSession = {},
  sessionWrite = Promise.resolve(),
  allowClose = false;
const watchers = new Map();
const send = (name, data) => {
  if (win && !win.isDestroyed()) win.webContents.send("folio:" + name, data);
};
const allowedImage = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};
function watchFile(id) {
  const folder = path.dirname(files.file(id).path);
  if (watchers.has(folder)) return;
  try {
    let timer;
    const watcher = watch(folder, () => {
      clearTimeout(timer);
      timer = setTimeout(() => send("disk", null), 180);
    });
    watcher.on("error", () => {
      watcher.close();
      watchers.delete(folder);
    });
    watchers.set(folder, watcher);
  } catch {
    /* Focus refresh still works on filesystems without watch support. */
  }
}
async function openFile(p) {
  const doc = await files.open(p);
  watchFile(doc.id);
  return doc;
}
async function acceptArgs(args) {
  for (const arg of args) {
    if (!arg.startsWith("-") && markdownPath(arg)) {
      try {
        const doc = await openFile(path.resolve(arg));
        if (ready) send("open", [doc]);
        else pending.push(doc);
      } catch (e) {
        console.warn("Cannot open argument:", e.message);
      }
    }
  }
}
function api(name, callback) {
  ipcMain.handle("folio:" + name, async (event, ...args) => {
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      !event.senderFrame.url.startsWith("folio://app/")
    )
      throw Error("Untrusted sender");
    return callback(...args);
  });
}
const sessionFile = path.join(app.getPath("userData"), "session.json");
async function persist(value) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 64 * 1024 * 1024) throw Error("恢复数据过大");
  await fs.mkdir(path.dirname(sessionFile), { recursive: true });
  const temp = sessionFile + ".tmp";
  const handle = await fs.open(temp, "w");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, sessionFile);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    acceptArgs(argv);
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler(
        (_wc, _permission, done) => done(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      // No external HTTP requests from notes, including tracking images. Links open only after confirmation.
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ["http://*/*", "https://*/*"] },
        (_details, done) => done({ cancel: true }),
      );
      protocol.handle("folio", async (request) => {
        try {
          const url = new URL(request.url);
          if (url.host !== "app") return new Response(null, { status: 403 });
          const file = path.resolve(
            dist,
            "." +
              decodeURIComponent(
                url.pathname === "/" ? "/index.html" : url.pathname,
              ),
          );
          if (!within(dist, file)) return new Response(null, { status: 403 });
          const type =
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".woff2": "font/woff2",
              ".woff": "font/woff",
              ".ttf": "font/ttf",
            }[path.extname(file)] || "application/octet-stream";
          return new Response(await fs.readFile(file), {
            headers: {
              "content-type": type,
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch {
          return new Response(null, { status: 404 });
        }
      });
      protocol.handle("folio-asset", async (request) => {
        try {
          const url = new URL(request.url),
            id = url.hostname;
          const file = await files.asset(
            id,
            url.searchParams.get("path") || "",
          );
          const stat = await fs.stat(file);
          if (stat.size > 64 * 1024 * 1024) throw Error("Image too large");
          return new Response(await fs.readFile(file), {
            headers: {
              "content-type": allowedImage[path.extname(file).toLowerCase()],
              "Content-Security-Policy":
                "default-src 'none'; style-src 'unsafe-inline'; sandbox",
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch {
          return new Response(null, { status: 403 });
        }
      });
      win = new BrowserWindow({
        width: 1360,
        height: 920,
        minWidth: 480,
        minHeight: 360,
        show: false,
        autoHideMenuBar: false,
        backgroundColor: "#f6f5f1",
        title: "Folio Notes",
        webPreferences: {
          preload: path.join(here, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          spellcheck: false,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.on("close", (event) => {
        if (allowClose || !ready) return;
        event.preventDefault();
        send("command", "close");
      });
      win.once("ready-to-show", () => win.show());
      win.webContents.on("render-process-gone", () => {
        allowClose = true;
      });
      const command = (cmd) => () => send("command", cmd);
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "文件",
            submenu: [
              {
                label: "打开文件…",
                accelerator: "CmdOrCtrl+O",
                click: command("open"),
              },
              {
                label: "打开文件夹…",
                accelerator: "CmdOrCtrl+Shift+O",
                click: command("folder"),
              },
              {
                label: "新笔记",
                accelerator: "CmdOrCtrl+N",
                click: command("new"),
              },
              {
                label: "保存",
                accelerator: "CmdOrCtrl+S",
                click: command("save"),
              },
              {
                label: "另存为…",
                accelerator: "CmdOrCtrl+Shift+S",
                click: command("saveAs"),
              },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          {
            label: "编辑",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          {
            label: "查看",
            submenu: [
              {
                label: "刷新当前笔记",
                accelerator: "CmdOrCtrl+R",
                click: command("refresh"),
              },
              {
                label: "阅读",
                accelerator: "CmdOrCtrl+1",
                click: command("read"),
              },
              {
                label: "编辑",
                accelerator: "CmdOrCtrl+2",
                click: command("edit"),
              },
              {
                label: "源码",
                accelerator: "CmdOrCtrl+3",
                click: command("source"),
              },
              { role: "togglefullscreen" },
            ],
          },
        ]),
      );
      // Keep native accelerators, but not the menu strip (including on Alt).
      // Auto-hide would let Alt reveal the strip again, so it stays disabled.
      if (process.platform !== "darwin") win.setMenuBarVisibility(false);
      api(
        "exportNote",
        createExporter({
          BrowserWindow,
          dialog,
          owner: () => win,
          files,
          dist,
          noticesPath: app.isPackaged
            ? path.join(
                path.dirname(process.execPath),
                "THIRD-PARTY-NOTICES.txt",
              )
            : path.join(dist, "../THIRD-PARTY-NOTICES.txt"),
        }),
      );
      api("pickFiles", async () => {
        const result = await dialog.showOpenDialog(win, {
          properties: ["openFile", "multiSelections"],
          filters: [
            {
              name: "Markdown / Text",
              extensions: ["md", "markdown", "mdown", "mkd", "txt"],
            },
          ],
        });
        return Promise.all(result.filePaths.map(openFile));
      });
      api("pickFolder", async (fileId = null) => {
        const r = await dialog.showOpenDialog(win, {
          ...(fileId
            ? { defaultPath: path.dirname(files.file(fileId).path) }
            : {}),
          properties: ["openDirectory"],
        });
        return r.filePaths[0] ? files.directory(r.filePaths[0]) : null;
      });
      api("list", (id) => files.list(id));
      api("currentFolder", (id) => files.currentFolder(id));
      api("search", (ids, query) => {
        if (
          !Array.isArray(ids) ||
          ids.length > 10 ||
          typeof query !== "string" ||
          query.length > 200
        )
          throw Error("无效搜索");
        return files.search(ids, query);
      });
      api("openChild", async (id, name) => {
        const doc = await files.openChild(id, name);
        watchFile(doc.id);
        return doc;
      });
      api("read", (id, version) => files.read(id, version));
      api("preview", (id, href) => files.preview(id, href));
      api("save", (id, text, version) => files.save(id, text, version));
      api("saveAs", async (text, name, excludedIds = []) => {
        if (
          typeof text !== "string" ||
          Buffer.byteLength(text) > 32 * 1024 * 1024
        )
          throw Error("文档过大");
        if (!Array.isArray(excludedIds) || excludedIds.length > 100)
          throw Error("无效的已打开标签列表");
        const excludedPaths = excludedIds.map((id) => files.file(id).path);
        const result = await dialog.showSaveDialog(win, {
          defaultPath: path.basename(String(name || "Untitled.md")),
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (!result.filePath) return null;
        let destination;
        try {
          destination = await fs.realpath(result.filePath);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        if (destination && excludedPaths.includes(destination))
          throw Error(
            "目标已在其他标签页打开，请切换到该标签页保存，或选择其他文件名。",
          );
        // Capture the chosen destination baseline; save() checks again before committing.
        try {
          await fs.writeFile(result.filePath, "", { flag: "wx" });
        } catch (e) {
          if (e.code !== "EEXIST") throw e;
        }
        const target = await openFile(result.filePath),
          saved = await files.save(target.id, text, target.version);
        if (saved.conflict) throw Error("目标文件在保存前发生变化");
        return { ...target, text, version: saved.version };
      });
      api("reveal", (id) => shell.showItemInFolder(files.file(id).path));
      api("link", async (id, href) => {
        if (typeof href !== "string") throw Error("无效链接");
        if (/^https?:\/\//i.test(href)) {
          const u = new URL(href);
          const r = await dialog.showMessageBox(win, {
            message: "在系统浏览器打开外部链接？",
            detail: u.href,
            buttons: ["取消", "打开"],
            defaultId: 0,
            cancelId: 0,
          });
          if (r.response === 1) await shell.openExternal(u.href);
          return null;
        }
        const { path: p, authorized } = await files.linkTarget(id, href);
        if (!authorized) {
          const r = await dialog.showMessageBox(win, {
            message: "打开当前笔记文件夹之外的文件？",
            detail: p,
            buttons: ["取消", "打开"],
            defaultId: 0,
            cancelId: 0,
          });
          if (r.response !== 1) return null;
        }
        return openFile(p);
      });
      api("session", (value) => {
        if (!value || !Array.isArray(value.tabs))
          throw Error("Invalid session");
        if (value.tabs.length > 100)
          throw Error(
            "最多恢复 100 个标签；请先保存并关闭多余标签。现有恢复数据未改动。",
          );
        // Resolve document paths from native handles; renderer cannot plant arbitrary reopen paths.
        const tabs = value.tabs.map((t) => ({
          ...t,
          path: t.fileId ? files.file(t.fileId).path : null,
        }));
        dirty = tabs.some((t) => typeof t.draft === "string");
        const roots = (value.roots || [])
          .map((id) => files.directories.get(id))
          .filter(Boolean);
        savedSession = { ...value, tabs, roots };
        sessionWrite = sessionWrite
          .catch(() => {})
          .then(() => persist(savedSession));
        return sessionWrite;
      });
      api("closeReady", async () => {
        await sessionWrite;
        if (dirty) {
          const r = await dialog.showMessageBox(win, {
            type: "warning",
            buttons: ["取消", "退出并保留恢复草稿"],
            defaultId: 0,
            cancelId: 0,
            message: "有未保存的笔记",
            detail: "恢复草稿已写入本机，下次启动时恢复；原文件不会自动覆盖。",
          });
          if (r.response !== 1) return;
        }
        allowClose = true;
        win.close();
      });
      api("ready", async () => {
        let old = {};
        try {
          old = JSON.parse(await fs.readFile(sessionFile, "utf8"));
        } catch {
          /* First run / damaged session. */
        }
        const restored = [];
        for (const t of (old.tabs || []).slice(0, 100)) {
          try {
            restored.push({
              ...t,
              document: t.path ? await openFile(t.path) : null,
            });
          } catch {
            if (typeof t.draft === "string")
              restored.push({ ...t, path: null, document: null });
          }
        }
        const roots = [];
        for (const p of (old.roots || []).slice(0, 10)) {
          try {
            roots.push(await files.directory(p));
          } catch {}
        }
        ready = true;
        const incoming = pending;
        pending = [];
        return {
          restored,
          incoming,
          roots,
          settings: old.settings || {},
          active: old.active,
        };
      });
      await acceptArgs(process.argv.slice(app.isPackaged ? 1 : 2));
      await win.loadURL("folio://app/");
      app.on("window-all-closed", () => app.quit());
      app.on("will-quit", () => {
        for (const watcher of watchers.values()) watcher.close();
        watchers.clear();
      });
    })
    .catch((error) => {
      console.error(error);
      dialog.showErrorBox("Folio Notes 启动失败", error.message);
      app.exit(1);
    });
}
