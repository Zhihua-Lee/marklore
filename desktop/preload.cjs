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
])
  api[name] = invoke(name);
api.on = (name, callback) => {
  if (!["open", "disk", "command", "desktop-settings"].includes(name))
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
contextBridge.exposeInMainWorld("folio", api);
