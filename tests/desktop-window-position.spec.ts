import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { clampDesktopWindowPosition, initialDesktopWindowPosition, parseWindowOriginArgs } from '../desktop-shell/window-position.mjs'

const work = { x: 0, y: 25, width: 1440, height: 875 }

describe('clampDesktopWindowPosition', () => {
  it('lets the window hang above the menu bar so the pet can reach the top of the screen', () => {
    // Sprite sits ~384px from the window top; to put it at workArea.y the
    // window origin must go negative.
    expect(clampDesktopWindowPosition(1000, 25 - 384, 420, 640, work)).toEqual({
      x: 1000,
      y: 25 - 384,
    })
  })

  it('still keeps a sliver of the window on-screen', () => {
    expect(clampDesktopWindowPosition(-9999, -9999, 420, 640, work)).toEqual({
      x: 0 - 420 + 64,
      y: 25 - 640 + 64,
    })
  })
})

describe('initialDesktopWindowPosition', () => {
  it('uses the spawn origin so the overlay does not jump to the work-area corner', () => {
    expect(initialDesktopWindowPosition({ x: 340, y: 264 }, 420, 640, work)).toEqual({
      x: 340,
      y: 264,
    })
  })

  it('falls back to the work-area corner when spawn did not send an origin', () => {
    expect(initialDesktopWindowPosition(null, 420, 640, work)).toEqual({
      x: 0 + 1440 - 420 - 12,
      y: 25 + 875 - 640 - 12,
    })
  })
})

describe('parseWindowOriginArgs', () => {
  it('reads --x/--y from the electron argv', () => {
    expect(parseWindowOriginArgs(['--base=http://x', '--token=t', '--x=340', '--y=264'])).toEqual({
      x: 340,
      y: 264,
    })
  })

  it('returns null when spawn omitted a window origin', () => {
    expect(parseWindowOriginArgs(['--base=http://x', '--token=t'])).toBeNull()
  })
})

describe('desktop shell uses the off-screen clamp while dragging', () => {
  it('calls clampDesktopWindowPosition from tickDrag', () => {
    const src = readFileSync(new URL('../desktop-shell/main.mjs', import.meta.url), 'utf8')
    expect(src).toContain("from './window-position.mjs'")
    expect(src).toContain('clampDesktopWindowPosition')
    expect(src).toContain('initialDesktopWindowPosition')
    expect(src).toContain('parseWindowOriginArgs')
  })
})
