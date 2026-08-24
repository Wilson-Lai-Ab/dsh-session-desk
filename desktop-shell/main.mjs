/**
 * Electron desktop main process for the dsh-session-desk pet overlay.
 * Spawned by the host lifecycle (exe main.mjs --base= --token=).
 *
 * A compact always-on-top window (not a full-screen click-through overlay).
 * Full-screen + setIgnoreMouseEvents(true, {forward:true}) on macOS often
 * never delivers hits to the pet, so the user sees it but cannot click it.
 */
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import { clampDesktopWindowPosition } from './window-position.mjs'

function parseArgs(argv) {
  let base = ''
  let token = ''
  for (const arg of argv) {
    if (arg.startsWith('--base=')) base = arg.slice('--base='.length)
    if (arg.startsWith('--token=')) token = arg.slice('--token='.length)
  }
  return { base, token }
}

const WIN_W = 420
const WIN_H = 640

let win = null
let lastIgnore = null
let lastX = null
let lastY = null
let dragOffset = null
let dragTimer = null
let paintActive = false

function applyPaintRate() {
  if (!win) return
  win.webContents.setFrameRate(paintActive || dragOffset !== null ? 15 : 1)
}

function applyPosition(nx, ny) {
  if (!win) return
  if (lastX === nx && lastY === ny) return
  lastX = nx
  lastY = ny
  win.setPosition(nx, ny)
}

function tickDrag() {
  if (!win || dragOffset === null) return
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const next = clampDesktopWindowPosition(
    cursor.x - dragOffset.x,
    cursor.y - dragOffset.y,
    WIN_W,
    WIN_H,
    workArea,
  )
  applyPosition(next.x, next.y)
}

app.whenReady().then(() => {
  const { base, token } = parseArgs(process.argv.slice(2))
  const { workArea } = screen.getPrimaryDisplay()

  win = new BrowserWindow({
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    width: WIN_W,
    height: WIN_H,
    x: workArea.x + workArea.width - WIN_W - 12,
    y: workArea.y + workArea.height - WIN_H - 12,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
    },
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.webContents.setFrameRate(1)
  win.webContents.setBackgroundThrottling(true)
  win.loadURL(`${base}/session-desk/pet-desktop/renderer.html?token=${encodeURIComponent(token)}`)
  win.once('ready-to-show', () => {
    win?.setIgnoreMouseEvents(true, { forward: true })
    win?.show()
  })
  win.on('closed', () => {
    win = null
    app.quit()
  })
})

ipcMain.on('set-ignore-mouse', (_event, ignore) => {
  if (!win) return
  const next = Boolean(ignore)
  if (lastIgnore === next) return
  lastIgnore = next
  win.setIgnoreMouseEvents(next, { forward: true })
})

ipcMain.on('move-window', (_event, x, y) => {
  applyPosition(Math.round(Number(x) || 0), Math.round(Number(y) || 0))
})

ipcMain.on('start-drag', (_event, offsetX, offsetY) => {
  dragOffset = { x: Number(offsetX) || 0, y: Number(offsetY) || 0 }
  applyPaintRate()
  if (dragTimer !== null) return
  dragTimer = setInterval(tickDrag, 8)
})

ipcMain.on('stop-drag', () => {
  dragOffset = null
  if (dragTimer !== null) {
    clearInterval(dragTimer)
    dragTimer = null
  }
  applyPaintRate()
})

ipcMain.on('set-paint-active', (_event, active) => {
  paintActive = Boolean(active)
  applyPaintRate()
})
