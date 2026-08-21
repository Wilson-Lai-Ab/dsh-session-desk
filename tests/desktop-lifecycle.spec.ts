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