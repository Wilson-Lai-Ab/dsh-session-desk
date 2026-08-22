import { describe, expect, it, vi } from 'vitest'
import { createDesktopPetController } from '../src/desktop/lifecycle.ts'

/** Builds a fake child that records its exit callback so tests can fire it later. */
function fakeChild(slot: { exit: ((code?: number, signal?: string) => void) | null }) {
  const child = {
    kill: vi.fn(),
    on: vi.fn((event: string, cb: (code?: number, signal?: string) => void) => {
      if (event === 'exit') slot.exit = cb
    }),
    unref: vi.fn(),
  }
  return child
}

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

  it('a stale exit after re-spawn does not clear the new child', async () => {
    const first: { exit: (() => void) | null } = { exit: null }
    const second: { exit: (() => void) | null } = { exit: null }
    const spawn = vi
      .fn()
      .mockReturnValueOnce(fakeChild(first))
      .mockReturnValueOnce(fakeChild(second))
    const exitCbs: Array<() => void> = []
    const controller = createDesktopPetController({
      getExecutable: async () => '/fake/electron',
      spawn,
    } as never)

    await controller.spawn('http://127.0.0.1:3080', 'tok')
    expect(controller.isActive()).toBe(true)

    // A stale exit arrives *after* close + re-spawn: it must not null the new child.
    controller.close()
    await controller.spawn('http://127.0.0.1:3080', 'tok')
    expect(controller.isActive()).toBe(true)

    // Verify a callback was registered on the first child and that its late fire
    // leaves the current (second) child active.
    expect(first.exit).not.toBeNull()
    first.exit!()
    expect(controller.isActive()).toBe(true)

    // Firing the current child's exit does deactivate.
    controller.onExit(() => exitCbs.push(1))
    second.exit!()
    expect(controller.isActive()).toBe(false)
    expect(exitCbs).toHaveLength(1)
  })
})

describe('DesktopPetController background download', () => {
  it('spawn returns before the Electron download completes; downloadState tracks downloading→ready', async () => {
    const gate: { release: (() => void) | null } = { release: null }
    let letExeRelease: (() => void) | null = null
    const controllerDeps = {
      getExecutable: async () => {
        await new Promise<void>(r => { letExeRelease = r })
        return '/fake/electron'
      },
      spawn: () => ({ kill: vi.fn(), on: vi.fn(), unref: vi.fn(), stdout: null }),
    } as never
    const controller = createDesktopPetController(controllerDeps)

    const p = controller.spawn('http://127.0.0.1:3080', 'tok')
    // 未等下载完成即观察到 downloading（spawn 已非阻塞启动后台）
    expect(controller.downloadState().stage).toBe('downloading')
    // 放行下载
    gate.release = letExeRelease
    if (letExeRelease) letExeRelease()
    await p
    expect(controller.downloadState().stage).toBe('ready')
    expect(controller.isActive()).toBe(true)
  })

  it('on executable failure, downloadState=stage:failed and spawn resolves without throwing', async () => {
    const controller = createDesktopPetController({
      getExecutable: async () => { throw new Error('no electron binary') },
      spawn: vi.fn(),
    } as never)
    const p = controller.spawn('http://h', 't')
    await expect(p).resolves.toBeUndefined()
    const st = controller.downloadState()
    expect(st.stage).toBe('failed')
    expect(st.error).toContain('electron')
    expect(controller.isActive()).toBe(false)
  })

  it('concurrent spawn calls share one download (dedup via pending)', async () => {
    const spawn = vi.fn().mockReturnValue({ kill: vi.fn(), on: vi.fn(), unref: vi.fn() })
    const execCalls: unknown[] = []
    const controller = createDesktopPetController({
      getExecutable: async () => { execCalls.push(1); return '/fake/electron' },
      spawn,
    } as never)

    const p1 = controller.spawn('http://127.0.0.1:3080', 'tok')
    const p2 = controller.spawn('http://127.0.0.1:3080', 'tok')
    await Promise.all([p1, p2])
    expect(execCalls).toHaveLength(1) // getExecutable ran exactly once
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(controller.isActive()).toBe(true)
  })

  it('spawn kills leftover overlay processes before launching', async () => {
    const killOrphans = vi.fn()
    const spawn = vi.fn().mockReturnValue({ kill: vi.fn(), on: vi.fn(), unref: vi.fn() })
    const controller = createDesktopPetController({
      getExecutable: async () => '/fake/electron',
      spawn,
      killOrphans,
    } as never)
    await controller.spawn('http://127.0.0.1:3080', 'tok')
    expect(killOrphans).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalled()
  })

  it('spawn while already active does not launch a second child', async () => {
    const spawn = vi.fn().mockReturnValue({ kill: vi.fn(), on: vi.fn(), unref: vi.fn() })
    const controller = createDesktopPetController({
      getExecutable: async () => '/fake/electron',
      spawn,
    } as never)
    await controller.spawn('http://127.0.0.1:3080', 'tok')
    await controller.spawn('http://127.0.0.1:3080', 'tok')
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(controller.isActive()).toBe(true)
  })

  it('marks failed when the child exits immediately after launch', async () => {
    const slot: { exit: ((code?: number) => void) | null } = { exit: null }
    const controller = createDesktopPetController({
      getExecutable: async () => '/fake/electron',
      spawn: vi.fn().mockReturnValue(fakeChild(slot)),
    } as never)
    await controller.spawn('http://127.0.0.1:3080', 'tok')
    expect(controller.isActive()).toBe(true)
    expect(slot.exit).not.toBeNull()
    slot.exit!(1)
    expect(controller.isActive()).toBe(false)
    expect(controller.downloadState().stage).toBe('failed')
    expect(controller.downloadState().error).toMatch(/exited/i)
  })

  it('after close, a new spawn starts a fresh download (pending cleared)', async () => {
    const spawn = vi.fn().mockReturnValue({ kill: vi.fn(), on: vi.fn(), unref: vi.fn() })
    const execCalls: unknown[] = []
    const controller = createDesktopPetController({
      getExecutable: async () => { execCalls.push(1); return '/fake/electron' },
      spawn,
    } as never)

    await controller.spawn('http://h', 't')
    expect(controller.isActive()).toBe(true)
    controller.close()
    expect(controller.downloadState().stage).toBe('idle')
    expect(controller.isActive()).toBe(false)

    // close() cleared `pending`; a fresh spawn must run the download again.
    const p = controller.spawn('http://h', 't')
    expect(controller.downloadState().stage).toBe('downloading')
    await p
    expect(execCalls).toHaveLength(2)
    expect(controller.isActive()).toBe(true)
  })
})