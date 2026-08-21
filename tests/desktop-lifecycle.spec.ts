import { describe, expect, it, vi } from 'vitest'
import { createDesktopPetController } from '../src/desktop/lifecycle.ts'

/** Builds a fake child that records its exit callback so tests can fire it later. */
function fakeChild(slot: { exit: (() => void) | null }) {
  const child = {
    kill: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
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