# Desktop Pet (Electron Overlay) Implementation Plan

> **For agentic workers:** Pick the execution skill from using-superpowers
> Execution Routing (S = this session, no SDD; M = executing-plans;
> L = subagent-driven-development). Do not default to SDD. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Class:** L — three coupled-but-independently-buildable subsystems: host desktop backend (Electron download + process lifecycle + HTTP), a new standalone Electron shell app, and browser-client coordination.

**Goal:** Let the pet run as a frameless, transparent, always-on-top desktop window (Windows/macOS/Linux), with a 「桌面 / 浏览器」 mode switch — 「桌面」 floats the pet above everything (browser pet hidden), 「浏览器」 keeps it only in the browser.

**Architecture:** The host (Node) downloads a pinned Electron on first use, spawns the desktop shell, and exposes loopback HTTP endpoints (`/session-desk/pet-desktop/*`). The Electron shell reuses the existing `PetOverlay` React component, polling `/snapshot` for session+settings state. The browser client polls `/status` to hide its own pet while the desktop pet is active.

**Tech Stack:** TypeScript, esbuild (existing `build.mjs`), React 18 (`useSyncExternalStore`), Electron (pinned, downloaded on demand), `node:child_process` / `node:fs` / `node:http` helpers already in `src/http.ts`, vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-desktop-pet-design.md`

## Global Constraints

- Pinned Electron version: `31.7.7`; downloaded on first use to `~/.dsh-session-desk/electron/<version>/`, cached for offline reuse.
- Three platforms: macOS (`darwin`), Windows (`win32`), Linux (`linux`); arm64 and x64 both supported for download URLs.
- Endpoints are loopback-only (`validateLoopbackHost`); mutation endpoints also pass `mutationAllowed` (existing CSRF gate). Shell-facing endpoints require a random token.
- Mode labels are exactly 「桌面」 (`pet.mode.desktop`) and 「浏览器」 (`pet.mode.browser`); new setting `petDesktop` defaults to `false` (browser mode, backward compatible).
- Do not introduce WebSocket or any new npm runtime dependency; reuse `@deepseek-ai/dsh-settings`, existing `react`/`react-dom`.
- The desktop shell renders the SAME `PetOverlay` component; do not fork its internals.

---

## File Structure

**Host (new `src/desktop/`):**
- `src/desktop/electron.ts` — `detectTarget()` (platform/arch → download URL + exe path) and `ensureElectron(target)` (download + cache + verify).
- `src/desktop/lifecycle.ts` — `createDesktopPetController()`: spawn/kill the Electron child, track `active`, emit exit events.
- `src/desktop/http.ts` — `createDesktopPetHandler(opts)` and `PET_DESKTOP_PREFIX`; the 6 endpoints + shell-asset serving.

**Desktop shell (new `desktop-shell/`):**
- `desktop-shell/main.mjs` — Electron main process: transparent/always-on-top/click-through window.
- `desktop-shell/renderer.html` — minimal HTML entry, loads the bundled renderer.
- `desktop-shell/renderer.tsx` — React entry: polls `/snapshot`, shims `useSessions`/`useScope`, renders `PetOverlay`.

**Browser client (existing, modified):**
- `src/client/pet/PetOverlay.tsx` — add 「桌面 / 浏览器」 selector + desktop-active visibility gate.
- `src/client/locales.ts` — add `pet.mode.desktop` / `pet.mode.browser` / `pet.desktop.*` copy.

**Shared/host wiring (modified):**
- `src/shared.ts` — add `petDesktop: boolean` to `SessionDeskSettings` + `DEFAULT_SETTINGS`.
- `src/index.ts` — add `petDesktop` to `SessionDeskSettingsSchema` + register the desktop handler.

**Build (modified):**
- `build.mjs` — add a second bundle entry for `desktop-shell/renderer.tsx` → `lib/desktop-renderer.js`.

**Tests:**
- `tests/desktop-electron.spec.ts`
- `tests/desktop-lifecycle.spec.ts`
- `tests/desktop-http.spec.ts`

---

### Task 1: Electron download manager (host)

**Files:**
- Create: `src/desktop/electron.ts`
- Test: `tests/desktop-electron.spec.ts`

**Interfaces:**
- Produces: `detectTarget(): ElectronTarget`; `ensureElectron(target: ElectronTarget): Promise<string>`
- `ElectronTarget = { platform: 'darwin'|'win32'|'linux'; arch: string; version: string; downloadUrl: string; exePath: string }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/desktop-electron.spec.ts
import { describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { detectTarget, ensureElectron, ELECTRON_VERSION } from '../src/desktop/electron.ts'

const PLATFORMS = [
  ['darwin', 'arm64', 'darwin-arm64', 'Electron.app/Contents/MacOS/Electron'],
  ['darwin', 'x64', 'darwin-x64', 'Electron.app/Contents/MacOS/Electron'],
  ['win32', 'x64', 'win32-x64', 'electron.exe'],
  ['linux', 'x64', 'linux-x64', 'electron'],
] as const

describe('detectTarget', () => {
  for (const [platform, arch, tag, rel] of PLATFORMS) {
    it(`maps ${platform}/${arch}`, () => {
      const t = detectTarget(platform as NodeJS.Platform, arch)
      expect(t.platform).toBe(platform)
      expect(t.downloadUrl).toContain(`electron-v${ELECTRON_VERSION}-${tag}.zip`)
      expect(t.exePath.endsWith(rel)).toBe(true)
    })
  }

  it('throws on an unsupported platform', () => {
    expect(() => detectTarget('freebsd' as NodeJS.Platform)).toThrow(/unsupported/i)
  })
})

describe('ensureElectron', () => {
  it('reuses an existing cached executable without downloading', async () => {
    const t = { version: ELECTRON_VERSION, exePath: '/tmp/fake-cache/electron/electron' } as ReturnType<typeof detectTarget>
    const fetchSpy = vi.fn()
    const extractSpy = vi.fn()
    const result = await ensureElectron(t, { fetch: fetchSpy, extractZip: extractSpy } as never)
    expect(result).toBe(t.exePath)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(extractSpy).not.toHaveBeenCalled()
  })

  it('downloads and extracts when the executable is missing', async () => {
    const dir = `/tmp/dsh-pet-test-${Date.now()}`
    const t = { version: ELECTRON_VERSION, downloadUrl: 'https://example.com/e.zip', exePath: `${dir}/electron` } as ReturnType<typeof detectTarget>
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })
    const extractSpy = vi.fn(() => { writeFileSync(`${dir}/electron`, 'x') })
    const result = await ensureElectron(t, { fetch: fetchSpy, extractZip: extractSpy } as never)
    expect(result).toBe(t.exePath)
    expect(fetchSpy).toHaveBeenCalledWith(t.downloadUrl)
    expect(extractSpy).toHaveBeenCalled()
  })

  it('throws when extraction does not produce the executable', async () => {
    const dir = `/tmp/dsh-pet-test-${Date.now()}`
    const t = { version: ELECTRON_VERSION, downloadUrl: 'https://example.com/e.zip', exePath: `${dir}/electron` } as ReturnType<typeof detectTarget>
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })
    const extractSpy = vi.fn(() => {}) // writes nothing
    await expect(ensureElectron(t, { fetch: fetchSpy, extractZip: extractSpy } as never)).rejects.toThrow(/extract/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/desktop-electron.spec.ts`
Expected: FAIL — `Cannot find module '../src/desktop/electron.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/desktop/electron.ts
import { existsSync, mkdirSync, writeFile } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'

export const ELECTRON_VERSION = '31.7.7'

export interface ElectronTarget {
  platform: 'darwin' | 'win32' | 'linux'
  arch: string
  version: string
  downloadUrl: string
  exePath: string
}

function mapTarget(platform: NodeJS.Platform, arch: string): { tag: string; rel: string } {
  const a = arch === 'arm64' ? 'arm64' : 'x64'
  if (platform === 'darwin') return { tag: `darwin-${a}`, rel: 'Electron.app/Contents/MacOS/Electron' }
  if (platform === 'win32') return { tag: `win32-${a}`, rel: 'electron.exe' }
  if (platform === 'linux') return { tag: `linux-${a}`, rel: 'electron' }
  throw new Error(`unsupported platform: ${platform}`)
}

export function detectTarget(platform: NodeJS.Platform = process.platform, arch: string = process.arch): ElectronTarget {
  const { tag, rel } = mapTarget(platform, arch)
  const root = join(homedir(), '.dsh-session-desk', 'electron', ELECTRON_VERSION)
  return {
    platform: platform as ElectronTarget['platform'],
    arch,
    version: ELECTRON_VERSION,
    downloadUrl: `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-${tag}.zip`,
    exePath: join(root, rel),
  }
}

function extractZip(zipPath: string, destDir: string): void {
  const r = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${destDir}'`])
    : spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir])
  if (r.status !== 0) throw new Error(`extract failed (${process.platform})`)
}

export async function ensureElectron(
  target: ElectronTarget,
  deps?: { fetch?: typeof fetch; extractZip?: (zip: string, dest: string) => void },
): Promise<string> {
  if (existsSync(target.exePath)) return target.exePath
  const fetchFn = deps?.fetch ?? globalThis.fetch
  const res = await fetchFn(target.downloadUrl)
  if (!res.ok) throw new Error(`electron download failed: ${res.status}`)
  const destDir = dirname(target.exePath)
  mkdirSync(destDir, { recursive: true })
  const zipPath = `${target.exePath}.zip`
  await writeFile(zipPath, Buffer.from(await res.arrayBuffer()))
  const extract = deps?.extractZip ?? extractZip
  extract(zipPath, destDir)
  if (!existsSync(target.exePath)) throw new Error('electron extract failed: executable not found')
  return target.exePath
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/desktop-electron.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/electron.ts tests/desktop-electron.spec.ts
git commit -m "feat(desktop): electron download manager (detectTarget + ensureElectron)"
```

---

### Task 2: Host lifecycle + HTTP endpoints

**Files:**
- Create: `src/desktop/lifecycle.ts`, `src/desktop/http.ts`
- Modify: `src/index.ts`
- Test: `tests/desktop-lifecycle.spec.ts`, `tests/desktop-http.spec.ts`

**Interfaces:**
- Consumes: `detectTarget`, `ensureElectron` (Task 1); `validateLoopbackHost`, `writeJson`, `readJsonBody`, `mutationAllowed`, `asRecord`, `header`, `routeOf`, `DeskHttpRequest`, `DeskHttpResponse` (from `src/http.ts`); `listedSessions` (from `src/http.ts`, may need exporting).
- Produces: `createDesktopPetController(): DesktopPetController`; `createDesktopPetHandler(opts: DesktopPetHandlerOptions)`; `PET_DESKTOP_PREFIX`.
- `DesktopPetController = { spawn(baseUrl: string, token: string): Promise<void>; close(): void; isActive(): boolean; onExit(cb: () => void): () => void }`
- `DesktopPetHandlerOptions = { sessions: object; controller: DesktopPetController; getPetSettings(): Partial<SessionDeskSettings>; token: string; pendingOpen: { id: string; at: number } | null }`

- [ ] **Step 1: Write the failing lifecycle test**

```ts
// tests/desktop-lifecycle.spec.ts
import { describe, expect, it, vi } from 'vitest'
import { createDesktopPetController } from '../src/desktop/lifecycle.ts'

describe('DesktopPetController', () => {
  it('spawn marks active, close marks inactive, exit fires callback', async () => {
    const controller = createDesktopPetController({
      getExecutable: async () => '/fake/electron',
      spawn: vi.fn().mockReturnValue({ kill: vi.fn(), on: vi.fn(), unref: vi.fn() }),
    } as never)
    expect(controller.isActive()).toBe(false)
    await controller.spawn('http://127.0.0.1:3080', 'tok')
    expect(controller.isActive()).toBe(true)
    controller.close()
    expect(controller.isActive()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/desktop-lifecycle.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write lifecycle implementation**

```ts
// src/desktop/lifecycle.ts
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { detectTarget, ensureElectron } from './electron.ts'

export interface DesktopPetController {
  spawn(baseUrl: string, token: string): Promise<void>
  close(): void
  isActive(): boolean
  onExit(cb: () => void): () => void
}

interface Deps {
  spawn?: typeof nodeSpawn
  getExecutable?: () => Promise<string>
}

export function createDesktopPetController(deps?: Deps): DesktopPetController {
  const spawnFn = deps?.spawn ?? nodeSpawn
  const getExecutable = deps?.getExecutable ?? (() => ensureElectron(detectTarget()))
  let child: ChildProcess | null = null
  let active = false
  const exitCbs = new Set<() => void>()

  return {
    async spawn(baseUrl: string, token: string): Promise<void> {
      const exe = await getExecutable()
      const mainJs = fileURLToPath(new URL('../../desktop-shell/main.mjs', import.meta.url))
      child = spawnFn(exe, [mainJs, `--base=${baseUrl}`, `--token=${token}`], { stdio: 'ignore' })
      active = true
      child.on('exit', () => {
        active = false
        child = null
        for (const cb of exitCbs) cb()
      })
      child.unref?.()
    },
    close(): void {
      if (child !== null) child.kill()
      active = false
      child = null
    },
    isActive(): boolean { return active },
    onExit(cb: () => void): () => void {
      exitCbs.add(cb)
      return () => exitCbs.delete(cb)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/desktop-lifecycle.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing HTTP endpoint test**

```ts
// tests/desktop-http.spec.ts
import { describe, expect, it } from 'vitest'
import { createDesktopPetHandler, PET_DESKTOP_PREFIX } from '../src/desktop/http.ts'
import { createDesktopPetController } from '../src/desktop/lifecycle.ts'

function handlerWith(overrides = {}) {
  const state = { pendingOpen: null as { id: string; at: number } | null }
  const controller = { ...createDesktopPetController(), spawn: async () => {} }
  const handler = createDesktopPetHandler({
    sessions: {},
    controller,
    getPetSettings: () => ({ petImage: 'x.png' }),
    token: 'tok',
    ...overrides,
    pendingOpen: state.pendingOpen,
  } as never)
  return { handler, state, controller }
}

function call(handler: (req: never, res: never) => Promise<void>, method: string, path: string, body?: unknown) {
  const chunks: string[] = []
  const res = {
    writeHead: (s: number, h?: object) => { (res as never).status = s },
    end: (b?: string) => { if (b) chunks.push(String(b)) },
    setHeader: () => {},
  }
  return handler({ method, url: path, headers: { host: '127.0.0.1:3080' }, on: () => {} } as never, res as never)
    .then(() => ({ status: (res as never).status, body: chunks.length ? JSON.parse(chunks.join('')) : null }))
}

describe('desktop-pet endpoints', () => {
  it('GET /status returns active', async () => {
    const { handler, controller } = handlerWith()
    controller.spawn('http://x', 'tok').catch(() => {})
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/status`)
    expect(r.status).toBe(200)
    expect(r.body.active).toBe(true)
  })

  it('rejects a non-loopback host', async () => {
    const { handler } = handlerWith()
    const chunks: string[] = []
    const res = { writeHead: (s: number) => { (res as never).status = s }, end: (b: string) => chunks.push(b) }
    await handler({ method: 'GET', url: `${PET_DESKTOP_PREFIX}/status`, headers: { host: 'evil.example.com' } } as never, res as never)
    expect((res as never).status).toBe(403)
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/desktop-http.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Write the HTTP handler**

```ts
// src/desktop/http.ts
import { header, routeOf, writeJson, readJsonBody, mutationAllowed, asRecord, validateLoopbackHost, listedSessions, type DeskHttpRequest, type DeskHttpResponse } from '../http.ts'
import type { SessionDeskSettings } from '../shared.ts'
import type { DesktopPetController } from './lifecycle.ts'

export const PET_DESKTOP_PREFIX = '/session-desk/pet-desktop'

export interface DesktopPetHandlerOptions {
  sessions: object
  controller: DesktopPetController
  getPetSettings: () => Partial<SessionDeskSettings>
  token: string
  pendingOpen: { id: string; at: number } | null
  getShellAssetsDir: () => string
}

export function createDesktopPetHandler(opts: DesktopPetHandlerOptions) {
  return async (req: DeskHttpRequest, res: DeskHttpResponse): Promise<void> => {
    if (!validateLoopbackHost(header(req, 'host'))) { writeJson(res, 403, { ok: false, error: 'forbidden host' }); return }
    const method = (req.method ?? 'GET').toUpperCase()
    const path = routeOf(req.url)
    const token = new URL(req.url ?? '', 'http://x').searchParams.get('token') ?? header(req, 'x-pet-token') ?? ''

    if (method === 'GET' && path === `${PET_DESKTOP_PREFIX}/status`) {
      writeJson(res, 200, { ok: true, active: opts.controller.isActive(), pendingOpen: opts.pendingOpen })
      return
    }
    if (method === 'GET' && path === `${PET_DESKTOP_PREFIX}/snapshot`) {
      if (token !== opts.token) { writeJson(res, 403, { ok: false, error: 'bad token' }); return }
      writeJson(res, 200, { ok: true, sessions: { items: listedSessions(opts.sessions) }, settings: opts.getPetSettings() })
      return
    }
    if (method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
    const gate = mutationAllowed(req)
    if (!gate.ok) { writeJson(res, gate.status, { ok: false, error: gate.error }); return }
    const body = asRecord(await readJsonBody(req))

    if (path === `${PET_DESKTOP_PREFIX}/spawn`) {
      const host = header(req, 'host') ?? '127.0.0.1:3080'
      await opts.controller.spawn(`http://${host}`, opts.token)
      writeJson(res, 200, { ok: true, active: true })
      return
    }
    if (path === `${PET_DESKTOP_PREFIX}/close`) {
      opts.controller.close()
      writeJson(res, 200, { ok: true, active: false })
      return
    }
    if (path === `${PET_DESKTOP_PREFIX}/open`) {
      const id = typeof body.id === 'string' ? body.id : ''
      if (id === '') { writeJson(res, 400, { ok: false, error: 'missing id' }); return }
      opts.pendingOpen = { id, at: Date.now() }
      writeJson(res, 200, { ok: true })
      return
    }
    if (path === `${PET_DESKTOP_PREFIX}/ack-open`) {
      const at = typeof body.at === 'number' ? body.at : 0
      if (opts.pendingOpen?.at === at) opts.pendingOpen = null
      writeJson(res, 200, { ok: true })
      return
    }
    writeJson(res, 404, { ok: false, error: 'not found' })
  }
}
```

- [ ] **Step 8: Export `listedSessions` from `src/http.ts`**

Add `export` to the existing `listedSessions` declaration (`export function listedSessions(sessions: object): unknown[]`), so the desktop handler reuses the same session source.

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/desktop-lifecycle.spec.ts tests/desktop-http.spec.ts`
Expected: PASS.

- [ ] **Step 10: Wire into the host (`src/index.ts`)**

In the host `apply` where `createSessionDeskHandler` is registered, add:

```ts
import { createDesktopPetController } from './desktop/lifecycle.ts'
import { createDesktopPetHandler, PET_DESKTOP_PREFIX } from './desktop/http.ts'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

// inside apply(), near the sessions handler registration:
const petController = createDesktopPetController()
const petToken = randomUUID()
const petState: { pendingOpen: { id: string; at: number } | null } = { pendingOpen: null }
const unregisterPet = webHost.webServer.register({
  kind: 'prefix',
  path: PET_DESKTOP_PREFIX,
  handler: createDesktopPetHandler({
    sessions: webHost.sessions ?? {},
    controller: petController,
    getPetSettings: () => ({
      petImage: settingsValue.petImage,
      petTheme: settingsValue.petTheme,
      petSize: settingsValue.petSize,
      petX: settingsValue.petX,
      petY: settingsValue.petY,
    }),
    token: petToken,
    pendingOpen: petState.pendingOpen,
    getShellAssetsDir: () => fileURLToPath(new URL('./assets/desktop-shell/', import.meta.url)),
  }),
})
// add unregisterPet() to the existing disposer return
```

> The exact `settingsValue` read follows the existing settings access pattern in `index.ts` (the settings namespace snapshot). Adapt the getter to the in-scope settings object already used there; do not introduce a new settings read path.

- [ ] **Step 11: Commit**

```bash
git add src/desktop/lifecycle.ts src/desktop/http.ts src/http.ts src/index.ts tests/desktop-lifecycle.spec.ts tests/desktop-http.spec.ts
git commit -m "feat(desktop): host lifecycle + pet-desktop HTTP endpoints"
```

---

### Task 3: Electron desktop shell + build

**Files:**
- Create: `desktop-shell/main.mjs`, `desktop-shell/renderer.html`, `desktop-shell/renderer.tsx`
- Modify: `build.mjs`
- Test: none (manual smoke; the shell is a native-window artifact verified by running it)

**Interfaces:**
- Consumes: `PET_DESKTOP_PREFIX` + `/snapshot` + `/open` + `/close` (Task 2); `PetOverlay` (from `src/client/pet/PetOverlay.tsx`); `SessionDeskSettings`, `DEFAULT_SETTINGS` (from `src/shared.ts`).
- Produces: `lib/desktop-renderer.js` (the shell renderer bundle); `desktop-shell/main.mjs` (spawned by the host).

- [ ] **Step 1: Write the Electron main process**

```js
// desktop-shell/main.mjs
import { app, BrowserWindow, ipcMain } from 'electron'

const [baseUrl, token] = process.argv.slice(2).reduce((acc, arg) => {
  if (arg.startsWith('--base=')) acc[0] = arg.slice('--base='.length)
  if (arg.startsWith('--token=')) acc[1] = arg.slice('--token='.length)
  return acc
}, ['', ''])

let win = null
app.whenReady().then(() => {
  win = new BrowserWindow({
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    width: 220,
    height: 220,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setIgnoreMouseEvents(true, { forward: true })
  win.loadURL(`${baseUrl}/session-desk/pet-desktop/renderer.html?token=${encodeURIComponent(token)}`)
  win.on('closed', () => { win = null; app.quit() })
})

// Toggle click-through: renderer asks for an interactive region.
ipcMain.on('set-ignore-mouse', (_e, ignore) => {
  if (win) win.setIgnoreMouseEvents(ignore, { forward: true })
})
```

- [ ] **Step 2: Write the HTML entry**

```html
<!-- desktop-shell/renderer.html -->
<!doctype html>
<meta charset="utf-8" />
<style>html,body{margin:0;background:transparent;overflow:hidden}</style>
<div id="root"></div>
<script type="module" src="./renderer.js"></script>
```

- [ ] **Step 3: Write the renderer**

```tsx
// desktop-shell/renderer.tsx
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { PetOverlay, type PetOverlayProps } from '../src/client/pet/PetOverlay.tsx'
import { DEFAULT_SETTINGS, type SessionDeskSettings } from '../src/shared.ts'

const token = new URLSearchParams(location.search).get('token') ?? ''
const PREFIX = '/session-desk/pet-desktop'

let snapshot: { sessions: { items: unknown[] }; settings: Partial<SessionDeskSettings> } | null = null
const listeners = new Set<() => void>()
function setSnapshot(next: typeof snapshot) { snapshot = next; for (const l of listeners) l() }
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l) }

async function poll(): Promise<void> {
  try {
    const res = await fetch(`${PREFIX}/snapshot?token=${encodeURIComponent(token)}`)
    if (res.ok) setSnapshot(await res.json())
  } catch { /* keep last known */ }
}
void poll()
const timer = setInterval(poll, 1000)

function useSessions<T>(select: (s: { items: unknown[] }) => T): T {
  const s = useSyncExternalStore(subscribe, () => snapshot?.sessions ?? { items: [] })
  return select(s)
}
function useScope<T>(select: (s: { value?: Partial<SessionDeskSettings> }) => T): T {
  const s = useSyncExternalStore(subscribe, () => ({ value: { ...DEFAULT_SETTINGS, ...snapshot?.settings } }))
  return select(s)
}
const update: PetOverlayProps['update'] = () => Promise.resolve()
const openSession = (id: string): void => { void fetch(`${PREFIX}/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }) }

function Root() {
  return (
    <PetOverlay
      t={(k) => k}
      useSessions={useSessions as never}
      useScope={useScope as never}
      sessions={{ open: openSession }}
      update={update}
    />
  )
}
createRoot(document.getElementById('root')!).render(<Root />)
```

- [ ] **Step 4: Add the second bundle entry to `build.mjs`**

Append an esbuild entry (mirroring the existing client bundle config) for `desktop-shell/renderer.tsx` → `lib/desktop-renderer.js`, with the same externalization of `react`/`react-dom` the client bundle uses. Keep `desktop-shell/main.mjs` unbundled (Electron loads it directly).

- [ ] **Step 5: Serve the shell assets from the host**

In `src/desktop/http.ts`, add a static route under the `PET_DESKTOP_PREFIX` that serves two paths (reusing the `createPetAssetHandler` pattern — read file, set `content-type`, cache header):
- `${PET_DESKTOP_PREFIX}/renderer.html` → `desktop-shell/renderer.html`
- `${PET_DESKTOP_PREFIX}/renderer.js` → `lib/desktop-renderer.js`

The shell then loads `${base}${PET_DESKTOP_PREFIX}/renderer.html` (whose relative `./renderer.js` resolves to `${PET_DESKTOP_PREFIX}/renderer.js`). Update `main.mjs` Step 1's `loadURL` accordingly, and `desktop-shell/renderer.tsx`'s `PREFIX` to match.

- [ ] **Step 6: Build and smoke test**

Run: `node build.mjs` then start the DSH GUI and click 「桌面」; confirm the transparent always-on-top window renders the pet and click-through works over empty regions.

- [ ] **Step 7: Commit**

```bash
git add desktop-shell/ src/desktop/http.ts build.mjs
git commit -m "feat(desktop): electron shell (transparent overlay + PetOverlay renderer)"
```

---

### Task 4: Browser client — mode selector + visibility

**Files:**
- Modify: `src/shared.ts`, `src/index.ts`, `src/client/pet/PetOverlay.tsx`, `src/client/locales.ts`
- Test: `tests/pet-status.spec.ts` (add a `petDesktop` default assertion if one exists for settings)

**Interfaces:**
- Consumes: `PET_DESKTOP_PREFIX` (Task 2); `SessionDeskSettings` (shared).
- Produces: a 「桌面 / 浏览器」 selector in `PetOverlay`; browser-pet hide when `petDesktop && active`.

- [ ] **Step 1: Add `petDesktop` to settings**

In `src/shared.ts`, add `petDesktop: boolean` to `SessionDeskSettings` (after `petEnabled`) and `petDesktop: false` to `DEFAULT_SETTINGS`. In `src/index.ts`, add `petDesktop: z.boolean().default(DEFAULT_SETTINGS.petDesktop)` to `SessionDeskSettingsSchema`.

- [ ] **Step 2: Add locale copy**

In `src/client/locales.ts`, add (zh + en):

```ts
'pet.mode.desktop': '桌面',
'pet.mode.browser': '浏览器',
'pet.mode.desktop': 'Desktop',
'pet.mode.browser': 'Browser',
```

- [ ] **Step 3: Add the selector + visibility gate to `PetOverlay`**

In `PetOverlay`, read `petDesktop` from the settings snapshot (already available via `useScope`/`settings`). Add a small two-option row in the bubble:

```tsx
<button type="button" className="dsd-pet__callout__item" onClick={() => { void props.update?.({ petDesktop: true }) }}>
  {props.t?.('pet.mode.desktop') ?? '桌面'}
</button>
<button type="button" className="dsd-pet__callout__item" onClick={() => { void props.update?.({ petDesktop: false }) }}>
  {props.t?.('pet.mode.browser') ?? '浏览器'}
</button>
```

And add a visibility gate: a `desktopActive` state polled via `fetch(PET_DESKTOP_PREFIX + '/status')` every 1s while `petDesktop` is true; when `petDesktop && desktopActive`, render `null` from `PetOverlay` (the browser pet disappears). Reset the poll when `petDesktop` flips false.

- [ ] **Step 4: Consume `pendingOpen` in the browser poll**

In the same status poll, when `status.pendingOpen` is present, call `props.sessions?.open?.(status.pendingOpen.id)` and `fetch(PET_DESKTOP_PREFIX + '/ack-open', { method: 'POST', ... body: { at: status.pendingOpen.at } })`.

- [ ] **Step 5: Build + typecheck + tests**

Run: `node build.mjs && npx tsc --noEmit && npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared.ts src/index.ts src/client/pet/PetOverlay.tsx src/client/locales.ts
git commit -m "feat(desktop): browser mode selector + visibility gate"
```

---

## Self-Review Notes (spec coverage)

- Spec §3.1 download → Task 1. §3.2 lifecycle → Task 2. §3.3 endpoints → Task 2. §3.4 open → Task 4 (pendingOpen consume).
- Spec §4 shell → Task 3. §5.1/5.2 mode + §5.3 visibility → Task 4. §0 `petDesktop` default false → Task 4 Step 1.
- Spec §8 error handling: non-loopback 403 (Task 2 test), bad token 403 (Task 2 handler), exit reset (Task 1 lifecycle test), missing id 400 (Task 2 handler).
