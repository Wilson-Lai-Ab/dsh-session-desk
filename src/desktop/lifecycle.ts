import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { detectTarget, ensureElectron } from './electron.ts'

export type DownloadStage = 'idle' | 'downloading' | 'ready' | 'failed'
export interface DownloadState {
  stage: DownloadStage
  pct: number | null
  error?: string
}

export interface DesktopPetController {
  spawn(baseUrl: string, token: string): Promise<void>
  close(): void
  isActive(): boolean
  isReady(): boolean
  markReady(): void
  downloadState(): DownloadState
  onExit(cb: () => void): () => void
}

interface Deps {
  spawn?: typeof nodeSpawn
  getExecutable?: () => Promise<string>
  killOrphans?: () => void | Promise<void>
}

const ORPHAN_PATTERN = 'dsh-session-desk/lib/desktop/main.mjs'

/** SIGTERM leftover overlays without blocking the host event loop. */
function killOrphanOverlays(): Promise<void> {
  if (process.platform === 'win32') return Promise.resolve()
  return new Promise((resolve) => {
    const child = nodeSpawn('pkill', ['-f', ORPHAN_PATTERN], { stdio: 'ignore' })
    const done = (): void => resolve()
    child.on('exit', done)
    child.on('error', done)
  })
}

export function createDesktopPetController(deps?: Deps): DesktopPetController {
  const spawnFn = deps?.spawn ?? nodeSpawn
  const getExecutable = deps?.getExecutable ?? (() => ensureElectron(detectTarget()))
  const killOrphans = deps?.killOrphans ?? killOrphanOverlays
  let child: ChildProcess | null = null
  let active = false
  let ready = false
  const exitCbs = new Set<() => void>()
  let stage: DownloadStage = 'idle'
  let errorMsg: string | undefined
  let pending: Promise<void> | null = null

  // Download Electron (if needed) then launch the desktop shell. Progress
  // advances on a background task; the caller's spawn() resolves when this
  // completes, but the HTTP handler must not await it (it returns 202).
  async function launch(baseUrl: string, token: string): Promise<void> {
    try {
      stage = 'downloading'
      const exe = await getExecutable()
      stage = 'ready'
      await Promise.resolve(killOrphans())
      const mainJs = fileURLToPath(new URL('./desktop/main.mjs', import.meta.url))
      const spawned = spawnFn(exe, [mainJs, `--base=${baseUrl}`, `--token=${token}`], { stdio: 'ignore' })
      child = spawned
      active = true
      spawned.on('exit', (code, signal) => {
        // Ignore a stale exit from an older child: close() may have raced a newer
        // spawn, and a late exit from the old child must not null the new one.
        if (child !== spawned) return
        active = false
        ready = false
        child = null
        // close() already nulls `child` before kill, so a SIGTERM from close is
        // ignored above. A spontaneous non-zero exit (crash / Gatekeeper) is
        // the failure the settings switch must surface.
        if ((typeof code === 'number' && code !== 0) || signal != null) {
          stage = 'failed'
          errorMsg = `electron exited (${code ?? signal})`
        }
        for (const cb of exitCbs) cb()
      })
      spawned.unref?.()
    } catch (error) {
      stage = 'failed'
      errorMsg = error instanceof Error && error.message ? error.message : 'spawn failed'
      active = false
      ready = false
      child = null
      // Surface the failure via downloadState(); do NOT rethrow to the caller —
      // the /spawn HTTP handler returns 202 before this resolves.
    }
  }

  function begin(baseUrl: string, token: string): Promise<void> {
    if (active) return Promise.resolve()
    if (pending) return pending
    // Clear `pending` after the launch settles (success OR failure) so a later
    // /spawn (re-mount, HMR, another tab) starts a fresh attempt instead of
    // returning the settled promise.
    pending = launch(baseUrl, token).finally(() => { pending = null })
    return pending
  }

  return {
    spawn: (baseUrl: string, token: string): Promise<void> => begin(baseUrl, token),
    close(): void {
      const current = child
      child = null
      active = false
      ready = false
      stage = 'idle'
      errorMsg = undefined
      pending = null
      current?.kill('SIGTERM')
      const leftover = current
      const timer = setTimeout(() => leftover?.kill('SIGKILL'), 400)
      if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    },
    isActive(): boolean { return active },
    isReady(): boolean { return ready },
    markReady(): void { if (active) ready = true },
    downloadState(): DownloadState {
      // pct is reserved for a future byte-level download progress; Electron
      // downloads are reported as indeterminate (stage + error only).
      return { stage, pct: null, ...(errorMsg !== undefined ? { error: errorMsg } : {}) }
    },
    onExit(cb: () => void): () => void {
      exitCbs.add(cb)
      return () => exitCbs.delete(cb)
    },
  }
}