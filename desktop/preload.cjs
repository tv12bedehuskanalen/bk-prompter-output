const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("launcher", {
  status: () => ipcRenderer.invoke("status"),
  setPort: (port) => ipcRenderer.invoke("port", port),
  open: (route) => ipcRenderer.invoke("open", route),
  quit: () => ipcRenderer.invoke("quit"),
  onStatus: (fn) => ipcRenderer.on("status", (event, status) => fn(status)),
});
