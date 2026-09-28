import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
  Menu,
  session,
  Tray,
  nativeImage,
  clipboard,
} from "electron";
import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileStore, within, markdownPath } from "./files.mjs";
import { createExporter } from "./export.mjs";
import { createIntegration } from "./integration.mjs";
import { createLinkOpener } from "./links.mjs";
import { createRecentFiles } from "./recent.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)),
  dist = path.resolve(here, "../dist");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "folio",
    // codeCache: V8 keeps compiled bundles between launches instead of reparsing ~1.3 MB.
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      codeCache: true,
    },
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
const integration = createIntegration({
  app,
  shell,
  profile: app.getPath("userData"),
});
const recent = createRecentFiles({
  file: path.join(app.getPath("userData"), "recent.json"),
  // Tests and isolated profiles (FOLIO_DATA_DIR) never touch the user's real
  // taskbar jump list; neither does an unpackaged development run.
  jumpList:
    process.platform === "win32" && app.isPackaged && !profile
      ? (paths) => {
          if (!app.isReady()) return;
          app.setJumpList(
            paths.length
              ? [
                  {
                    type: "custom",
                    name: "最近打开",
                    items: paths.map((p) => ({
                      type: "task",
                      title: path.basename(p),
                      description: p,
                      program: process.execPath,
                      args: `"${p}"`,
                      iconPath: process.execPath,
                      iconIndex: 0,
                    })),
                  },
                ]
              : null,
          );
        }
      : null,
});
let tray,
  desktopWrite = Promise.resolve(),
  pendingDisk = false;
function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function desktopAction(action) {
  desktopWrite = desktopWrite.catch(() => {}).then(action);
  return desktopWrite;
}
function reportDesktopError(error) {
  showWindow();
  dialog.showMessageBox(win, {
    type: "error",
    message: "系统设置未完成",
    detail: error.message,
  });
}
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 Folio Notes", click: showWindow },
      { label: "隐藏到托盘", click: () => send("command", "hide") },
      { type: "separator" },
      {
        label: "关闭窗口后留在后台",
        type: "checkbox",
        checked: integration.closeToTray,
        click: (item) =>
          desktopAction(async () => {
            await integration.setBackground(item.checked);
            updateTray();
            send("desktop-settings", null);
          }).catch(reportDesktopError),
      },
      {
        label: "开机启动",
        type: "checkbox",
        enabled: process.platform === "win32" && app.isPackaged,
        checked: integration.login().openAtLogin,
        click: (item) =>
          desktopAction(async () => {
            integration.setStartup(item.checked);
            updateTray();
            send("desktop-settings", null);
          }).catch(reportDesktopError),
      },
      {
        label: "后台与默认应用设置…",
        click: () => {
          showWindow();
          send("command", "desktopSettings");
        },
      },
      { type: "separator" },
      {
        label: "退出 Folio Notes",
        click: () => {
          if (allowClose || !ready) app.quit();
          else {
            showWindow();
            send("command", "quit");
          }
        },
      },
    ]),
  );
}
function createTray() {
  try {
    tray = new Tray(
      nativeImage.createFromPath(path.join(here, "icons/tray.png")),
    );
    tray.setToolTip("Folio Notes");
    tray.on("click", showWindow);
    tray.on("double-click", showWindow);
    updateTray();
  } catch (error) {
    console.warn("Tray unavailable:", error.message);
    tray = null;
  }
}
let win,
  ready = false,
  pending = [],
  dirty = false,
  savedSession = {},
  sessionWrite = Promise.resolve(),
  allowClose = false;
const watchers = new Map();
// Tab id -> last draft received from the renderer (see the "session" handler).
const draftCache = new Map();
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
// One watcher per folder, reacting only to the open notes it contains. Unrelated
// files (Downloads, our own .folio-*.tmp saves) no longer trigger disk re-reads.
function watchFile(id) {
  const file = files.file(id).path,
    folder = path.dirname(file),
    name = path.basename(file).toLowerCase();
  const existing = watchers.get(folder);
  if (existing) {
    existing.names.set(name, Date.now());
    return;
  }
  try {
    let timer;
    const entry = { names: new Map([[name, Date.now()]]) };
    entry.watcher = watch(folder, (_type, changed) => {
      // Windows reports the entry name; without one, stay conservative and refresh.
      if (changed && !entry.names.has(String(changed).toLowerCase())) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (win?.isVisible()) send("disk", null);
        else pendingDisk = true;
      }, 180);
    });
    entry.watcher.on("error", () => {
      entry.watcher.close();
      watchers.delete(folder);
    });
    watchers.set(folder, entry);
  } catch {
    /* Focus refresh still works on filesystems without watch support. */
  }
}
// Release watchers for notes no open tab references. A just-opened file may not
// be in the renderer's session yet, so keep recent additions for a grace period.
function retainWatchers(fileIds) {
  const open = new Set();
  for (const id of fileIds) {
    try {
      open.add(files.file(id).path.toLowerCase());
    } catch {
      /* Unknown ids are validated by the session handler. */
    }
  }
  const now = Date.now();
  for (const [folder, entry] of watchers) {
    for (const [name, added] of entry.names)
      if (
        !open.has(path.join(folder, name).toLowerCase()) &&
        now - added > 10000
      )
        entry.names.delete(name);
    if (!entry.names.size) {
      entry.watcher.close();
      watchers.delete(folder);
    }
  }
}
// Explicit opens are remembered as recent; restoring last session's tabs is not.
async function openFile(p, { remember = true } = {}) {
  const doc = await files.open(p);
  watchFile(doc.id);
  if (remember)
    recent.add(doc.path).catch((e) => console.warn("Recent list:", e.message));
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
let firstSessionRead = null;
async function readSession() {
  try {
    return JSON.parse(await fs.readFile(sessionFile, "utf8"));
  } catch {
    return {}; /* First run / damaged session. */
  }
}
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
  // Antivirus and sync clients briefly lock files on Windows; retry before failing.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(temp, sessionFile);
      return;
    } catch (error) {
      if (attempt >= 4 || !["EPERM", "EBUSY", "EACCES"].includes(error.code))
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    acceptArgs(argv);
    if (!argv.includes("--background") || argv.some(markdownPath)) showWindow();
  });
  app.on("before-quit", (event) => {
    if (!allowClose && ready && win && !win.isDestroyed()) {
      event.preventDefault();
      showWindow();
      send("command", "quit");
    }
  });
  app
    .whenReady()
    .then(async () => {
      await integration.load();
      recent.refreshJumpList().catch(() => {});
      if (process.platform === "win32")
        app.setAppUserModelId("io.folionotes.desktop");
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
          return new Response(null, {
            status: 403,
            headers: { "Cache-Control": "no-store" },
          });
        }
      });
      // Paint the saved theme's page colour before the renderer loads (no light flash in dark mode).
      firstSessionRead = readSession();
      const dark = (await firstSessionRead).settings?.theme === "dark";
      win = new BrowserWindow({
        width: 1360,
        height: 920,
        minWidth: 480,
        minHeight: 360,
        show: false,
        autoHideMenuBar: false,
        backgroundColor: dark ? "#202523" : "#f6f5f1",
        title: "Folio Notes",
        icon: path.join(here, "icons/folio.png"),
        webPreferences: {
          preload: path.join(here, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          spellcheck: false,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.on("show", () => {
        if (pendingDisk) {
          pendingDisk = false;
          send("disk", null);
        }
      });
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.on("app-command", (_event, command) => {
        if (command === "browser-backward") send("command", "back");
        if (command === "browser-forward") send("command", "forward");
      });
      win.on("close", (event) => {
        if (allowClose || !ready) return;
        event.preventDefault();
        send("command", "close");
      });
      createTray();
      win.once("ready-to-show", () => {
        const backgroundOnly =
          process.argv.includes("--background") &&
          !process.argv.some(markdownPath);
        if (!backgroundOnly || !tray) win.show();
      });
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
      api("openDropped", async (paths) => {
        if (
          !Array.isArray(paths) ||
          paths.length > 100 ||
          paths.some((p) => typeof p !== "string" || !path.isAbsolute(p))
        )
          throw Error("无效拖入文件");
        const documents = [],
          errors = [];
        for (const file of new Set(paths)) {
          if (!markdownPath(file)) {
            errors.push(path.basename(file) + "：不支持的文件类型");
            continue;
          }
          try {
            documents.push(await openFile(file));
          } catch (error) {
            errors.push(path.basename(file) + "：" + error.message);
          }
        }
        return { documents, errors };
      });
      api("copyText", (text) => {
        if (
          typeof text !== "string" ||
          Buffer.byteLength(text, "utf8") > 32 * 1024 * 1024
        )
          throw Error("复制内容过大或格式无效");
        clipboard.writeText(text);
      });
      api("desktopStatus", () =>
        integration
          .status()
          .then((status) => ({ ...status, trayAvailable: Boolean(tray) })),
      );
      api("desktopAction", (action) =>
        desktopAction(async () => {
          if (!action || typeof action !== "object")
            throw Error("无效系统操作");
          switch (action.type) {
            case "background":
              if (!tray && action.value)
                throw Error("托盘不可用，无法隐藏窗口");
              await integration.setBackground(action.value);
              break;
            case "startup":
              integration.setStartup(action.value);
              break;
            case "register":
              await integration.register();
              break;
            case "defaults":
              await integration.defaults();
              break;
            case "startupSettings":
              await integration.startupSettings();
              break;
            default:
              throw Error("无效系统操作");
          }
          updateTray();
          return {
            ...(await integration.status()),
            trayAvailable: Boolean(tray),
          };
        }),
      );
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
      api("pickImage", async (fileId) => {
        const file = files.file(fileId);
        const result = await dialog.showOpenDialog(win, {
          title: "插入图片（复制到笔记旁的 assets 文件夹）",
          defaultPath: path.dirname(file.path),
          properties: ["openFile"],
          filters: [
            {
              name: "图片",
              extensions: [
                "png",
                "jpg",
                "jpeg",
                "gif",
                "webp",
                "bmp",
                "avif",
                "svg",
              ],
            },
          ],
        });
        return result.canceled || !result.filePaths[0]
          ? null
          : files.importImage(fileId, result.filePaths[0]);
      });
      api("insertImages", async (fileId, items) => {
        files.file(fileId);
        if (!Array.isArray(items) || !items.length || items.length > 20)
          throw Error("每次可插入 1–20 张图片");
        const images = [],
          errors = [];
        let total = 0;
        for (const item of items) {
          try {
            if (typeof item?.path === "string" && path.isAbsolute(item.path)) {
              const stat = await fs.stat(item.path);
              total += stat.size;
              if (total > 64 * 1024 * 1024) throw Error("图片合计超过 64 MB");
              images.push(await files.importImage(fileId, item.path));
            } else {
              if (
                !(item?.bytes instanceof Uint8Array) ||
                !item.bytes.length ||
                item.bytes.length > 32 * 1024 * 1024
              )
                throw Error("剪贴板图片无效或超过 32 MB");
              total += item.bytes.length;
              if (total > 64 * 1024 * 1024) throw Error("图片合计超过 64 MB");
              const image = nativeImage.createFromBuffer(
                Buffer.from(item.bytes),
              );
              const size = image.getSize();
              if (image.isEmpty() || size.width * size.height > 40_000_000)
                throw Error("无法读取剪贴板图片，或图片尺寸过大");
              images.push(
                await files.importImageBytes(
                  fileId,
                  image.toPNG(),
                  ".png",
                  "粘贴图片",
                ),
              );
            }
          } catch (error) {
            errors.push(error.message);
          }
        }
        return { images, errors };
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
      api("recentFiles", () => recent.list());
      // Reopen only what this process itself recorded; no arbitrary paths.
      api("openRecent", async (p) => {
        if (typeof p !== "string" || !(await recent.has(p)))
          throw Error("该文件不在最近打开列表中");
        return openFile(p);
      });
      api("clearRecent", () => recent.clear());
      api("reveal", (id) => shell.showItemInFolder(files.file(id).path));
      api("imageInfo", async (id, href) => {
        try {
          return await files.imageInfo(id, href);
        } catch (error) {
          return {
            error:
              error.code === "ENOENT"
                ? "找不到图片文件，请检查路径或同步状态。"
                : error.message,
          };
        }
      });
      api("allowImage", async (id, href) => {
        const info = await files.imageInfo(id, href);
        if (info.authorized) return true;
        const result = await dialog.showMessageBox(win, {
          message: "允许笔记加载此本地图片？",
          detail:
            info.path +
            "\n\n目录授权仅用于图片，不授予其他文件的读取权限。可选择仅在本次运行中加载此图片。",
          buttons: ["取消", "仅本次加载", "记住此图片目录"],
          defaultId: 0,
          cancelId: 0,
        });
        if (![1, 2].includes(result.response)) return false;
        if ((await files.imageInfo(id, href)).path !== info.path)
          throw Error("图片路径已改变，请重试。");
        if (result.response === 1) files.imageFiles.add(info.path);
        else {
          files.imageDirectories.add(path.dirname(info.path));
          savedSession.imageDirectories = [...files.imageDirectories];
          sessionWrite = sessionWrite
            .catch(() => {})
            .then(() => persist(savedSession));
          await sessionWrite;
        }
        return true;
      });
      api(
        "link",
        createLinkOpener({ files, dialog, shell, owner: () => win, openFile }),
      );
      api("session", (value) => {
        if (!value || !Array.isArray(value.tabs))
          throw Error("Invalid session");
        if (value.tabs.length > 100)
          throw Error(
            "最多恢复 100 个标签；请先保存并关闭多余标签。现有恢复数据未改动。",
          );
        // Resolve document paths from native handles; renderer cannot plant arbitrary reopen paths.
        const tabs = value.tabs.map(({ keepDraft, ...t }) => {
          // Unchanged drafts arrive as a reference to the copy received earlier.
          if (keepDraft) {
            const kept = draftCache.get(t.id);
            if (!kept) throw Error("恢复草稿需要重新发送");
            Object.assign(t, kept);
          }
          return { ...t, path: t.fileId ? files.file(t.fileId).path : null };
        });
        draftCache.clear();
        for (const t of tabs)
          if (typeof t.draft === "string")
            draftCache.set(t.id, {
              draft: t.draft,
              base: t.base,
              version: t.version,
            });
        dirty = tabs.some((t) => typeof t.draft === "string");
        retainWatchers(value.tabs.map((t) => t.fileId).filter(Boolean));
        const roots = (value.roots || [])
          .map((id) => files.directories.get(id))
          .filter(Boolean);
        savedSession = {
          ...value,
          tabs,
          roots,
          imageDirectories: [...files.imageDirectories],
        };
        sessionWrite = sessionWrite
          .catch(() => {})
          .then(() => persist(savedSession));
        return sessionWrite;
      });
      api("closeReady", async (intent = "close", flushError = null) => {
        if (!["close", "hide", "quit"].includes(intent))
          throw Error("无效关闭操作");
        // A failed recovery write (full disk, locked file, size limit) must not
        // trap the user in a window that can never close.
        let failure =
          typeof flushError === "string" ? flushError.slice(0, 500) : null;
        try {
          await sessionWrite;
        } catch (error) {
          failure ??= error.message;
        }
        if (
          tray &&
          (intent === "hide" || (intent === "close" && integration.closeToTray))
        ) {
          win.hide();
          return;
        }
        if (failure) {
          showWindow();
          const r = await dialog.showMessageBox(win, {
            type: "error",
            buttons: ["取消", "仍然退出"],
            defaultId: 0,
            cancelId: 0,
            message: "恢复数据未能写入",
            detail: `${failure}\n\n${dirty ? "未保存的草稿不会在下次启动时恢复。建议取消，先保存笔记。" : "下次启动时可能无法恢复标签页和阅读位置。"}`,
          });
          if (r.response !== 1) return;
          allowClose = true;
          app.quit();
          return;
        }
        if (dirty) {
          showWindow();
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
        app.quit();
      });
      api("ready", async () => {
        // The first boot reuses the read started before the window existed; a
        // renderer reload must see what was persisted since.
        const old = await (firstSessionRead || readSession());
        firstSessionRead = null;
        savedSession = old;
        for (const folder of (Array.isArray(old.imageDirectories)
          ? old.imageDirectories
          : []
        ).slice(0, 100)) {
          try {
            if (
              typeof folder === "string" &&
              path.isAbsolute(folder) &&
              (await fs.realpath(folder)) === folder &&
              (await fs.stat(folder)).isDirectory()
            )
              files.imageDirectories.add(folder);
          } catch {
            /* Removed or changed image directories require fresh consent. */
          }
        }
        const restored = [];
        for (const t of (old.tabs || []).slice(0, 100)) {
          try {
            restored.push({
              ...t,
              document: t.path
                ? await openFile(t.path, { remember: false })
                : null,
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
        tray?.destroy();
        for (const entry of watchers.values()) entry.watcher.close();
        watchers.clear();
      });
    })
    .catch((error) => {
      console.error(error);
      dialog.showErrorBox("Folio Notes 启动失败", error.message);
      app.exit(1);
    });
}
