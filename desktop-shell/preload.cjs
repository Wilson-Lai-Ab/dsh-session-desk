const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petDesktop', {
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  moveWindow: (x, y) => ipcRenderer.send('move-window', x, y),
  startDrag: (offsetX, offsetY) => ipcRenderer.send('start-drag', offsetX, offsetY),
  stopDrag: () => ipcRenderer.send('stop-drag'),
  setPaintActive: (active) => ipcRenderer.send('set-paint-active', active),
})