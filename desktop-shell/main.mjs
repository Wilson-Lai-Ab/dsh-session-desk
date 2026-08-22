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

function parseArgs(argv) {
  let base = ''
  let token = ''
  for (const arg of argv) {
    if (arg.startsWith('--base=')) base = arg.slice('--base='.length)
    if (arg.startsWith('--token=')) token = arg.slice('--token='.length)
  }
  return { base, token }
}

const WIN_W = 520
const WIN_H = 640

let win = null

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
  win.loadURL(`${base}/session-desk/pet-desktop/renderer.html?token=${encodeURIComponent(token)}`)
  win.once('ready-to-show', () => { win?.show() })
  win.on('closed', () => {
    win = null
    app.quit()
  })
})

ipcMain.on('move-window', (_event, x, y) => {
  if (!win) return
  win.setPosition(Math.round(Number(x) || 0), Math.round(Number(y) || 0))
})
