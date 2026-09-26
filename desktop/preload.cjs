const { contextBridge, ipcRenderer } = require("electron");
const invoke =
  (name) =>
  (...args) =>
    ipcRenderer.invoke("folio:" + name, ...args);
const api = {};
for (const name of [
  "ready",
  "pickFiles",
  "pickFolder",
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
  "exportNote",
])
  api[name] = invoke(name);
api.on = (name, callback) => {
  if (!["open", "disk", "command"].includes(name)) throw Error("Invalid event");
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on("folio:" + name, handler);
  return () => ipcRenderer.removeListener("folio:" + name, handler);
};
contextBridge.exposeInMainWorld("folio", api);
