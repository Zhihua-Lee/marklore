const { contextBridge, ipcRenderer, webUtils } = require("electron");
const invoke =
  (name) =>
  (...args) =>
    ipcRenderer.invoke("folio:" + name, ...args);
const api = {};
for (const name of [
  "ready",
  "pickFiles",
  "pickFolder",
  "pickImage",
  "imageInfo",
  "allowImage",
  "currentFolder",
  "list",
  "search",
  "openChild",
  "read",
  "preview",
  "save",
  "saveAs",
  "link",
  "reveal",
  "session",
  "closeReady",
  "desktopStatus",
  "desktopAction",
  "exportNote",
  "copyText",
  "recentFiles",
  "openRecent",
  "clearRecent",
  "windowState",
  "windowAction",
])
  api[name] = invoke(name);
api.on = (name, callback) => {
  if (!["open", "disk", "command", "desktop-settings", "window"].includes(name))
    throw Error("Invalid event");
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on("folio:" + name, handler);
  return () => ipcRenderer.removeListener("folio:" + name, handler);
};
api.openDroppedFiles = (files) => {
  if (!Array.isArray(files) || files.length > 100)
    throw Error("每次最多拖入 100 个文件");
  const paths = files.map((file) => webUtils.getPathForFile(file));
  if (paths.some((path) => !path)) throw Error("请拖入磁盘上的真实文件");
  return ipcRenderer.invoke("folio:openDropped", paths);
};
api.insertImages = async (id, files) => {
  if (!Array.isArray(files) || files.length < 1 || files.length > 20)
    throw Error("每次可插入 1–20 张图片");
  const items = [];
  let total = 0;
  for (const file of files) {
    if (
      !(file instanceof File) ||
      file.size > 32 * 1024 * 1024 ||
      (total += file.size) > 64 * 1024 * 1024
    )
      throw Error("单张图片上限 32 MB，每次合计上限 64 MB");
    const path = webUtils.getPathForFile(file);
    items.push(
      path
        ? { path }
        : { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    );
  }
  return ipcRenderer.invoke("folio:insertImages", id, items);
};
contextBridge.exposeInMainWorld("folio", api);
