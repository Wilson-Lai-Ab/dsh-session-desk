const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petDesktop', {
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
})