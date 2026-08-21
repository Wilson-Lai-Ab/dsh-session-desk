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
  downloadState(): DownloadState
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
      const mainJs = fileURLToPath(new URL('./desktop/main.mjs', import.meta.url))
      const spawned = spawnFn(exe, [mainJs, `--base=${baseUrl}`, `--token=${token}`], { stdio: 'ignore' })
      child = spawned
      active = true
      spawned.on('exit', () => {
        // Ignore a stale exit from an older child: close() may have raced a newer
        // spawn, and a late exit from the old child must not null the new one.
        if (child !== spawned) return
        active = false
        child = null
        for (const cb of exitCbs) cb()
      })
      spawned.unref?.()
    } catch (error) {
      stage = 'failed'
      errorMsg = error instanceof Error && error.message ? error.message : 'spawn failed'
      active = false
      child = null
      // Surface the failure via downloadState(); do NOT rethrow to the caller —
      // the /spawn HTTP handler returns 202 before this resolves.
    }
  }

  function begin(baseUrl: string, token: string): Promise<void> {
    if (pending) return pending
    pending = launch(baseUrl, token)
    return pending
  }

  return {
    spawn: (baseUrl: string, token: string): Promise<void> => begin(baseUrl, token),
    close(): void {
      if (child !== null) child.kill()
      active = false
      child = null
      stage = 'idle'
      errorMsg = undefined
      pending = null
    },
    isActive(): boolean { return active },
    downloadState(): DownloadState {
      return { stage, pct: null, ...(errorMsg !== undefined ? { error: errorMsg } : {}) }
    },
    onExit(cb: () => void): () => void {
      exitCbs.add(cb)
      return () => exitCbs.delete(cb)
    },
  }
}