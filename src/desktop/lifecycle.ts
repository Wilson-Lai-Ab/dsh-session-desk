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
      const mainJs = fileURLToPath(new URL('./desktop/main.mjs', import.meta.url))
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