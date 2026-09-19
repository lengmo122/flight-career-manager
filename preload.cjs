const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  setWindowMode(mode) {
    if (mode === "login" || mode === "system") ipcRenderer.send("window-mode", mode);
  },
  readPersistentStorage(key) {
    return ipcRenderer.invoke("persistent-storage-read", key);
  },
  writePersistentStorage(key, value) {
    return ipcRenderer.invoke("persistent-storage-write", key, value);
  }
});
