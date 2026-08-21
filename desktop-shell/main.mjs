/**
 * Electron desktop main process for the dsh-session-desk pet overlay.
 * Spawned by the host lifecycle (exe main.mjs --base= --token=).
 *
 * The window is a transparent, frameless, always-on-top overlay sized to the
 * primary display's work area, positioned at the origin (the callout bubble
 * must not be clipped to a tiny 220x220 box). Mouse input is click-through by
 * default (forwarded to whatever the OS is showing); the renderer toggles
 * interaction on when the cursor is over the pet or its callout bubble.
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

let win = null

app.whenReady().then(() => {
  const { base, token } = parseArgs(process.argv.slice(2))
  const { workAreaSize } = screen.getPrimaryDisplay()

  win = new BrowserWindow({
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    width: workAreaSize.width,
    height: workAreaSize.height,
    x: 0,
    y: 0,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
    },
  })
  win.setAlwaysOnTop(true, 'floating')
  // Click-through by default; the renderer flips it off over the pet / bubble.
  win.setIgnoreMouseEvents(true, { forward: true })
  win.loadURL(`${base}/session-desk/pet-desktop/renderer.html?token=${encodeURIComponent(token)}`)
  win.on('closed', () => {
    win = null
    app.quit()
  })
})

// The renderer asks for an interactive region (pet / callout) or a pass-through.
ipcMain.on('set-ignore-mouse', (_event, ignore) => {
  if (win) win.setIgnoreMouseEvents(Boolean(ignore), { forward: true })
})