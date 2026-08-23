import { describe, expect, it } from 'vitest'
import {
  PET_SIZE_DEFAULT,
  PET_SIZE_MAX,
  PET_SIZE_MIN,
  cachedThemeOrNull,
  clampPetSize,
} from '../src/shared.ts'
import { fitPetSize } from '../src/client/pet/status.ts'
import { cssText } from '../src/client/pet/pet-styles.ts'

describe('clampPetSize', () => {
  it('keeps values inside [MIN, MAX]', () => {
    expect(clampPetSize(160)).toBe(160)
    expect(clampPetSize(PET_SIZE_MIN)).toBe(PET_SIZE_MIN)
    expect(clampPetSize(PET_SIZE_MAX)).toBe(PET_SIZE_MAX)
  })

  it('clamps below MIN and above MAX', () => {
    expect(clampPetSize(0)).toBe(PET_SIZE_MIN)
    expect(clampPetSize(PET_SIZE_MIN - 1)).toBe(PET_SIZE_MIN)
    expect(clampPetSize(PET_SIZE_MAX + 1)).toBe(PET_SIZE_MAX)
    expect(clampPetSize(9999)).toBe(PET_SIZE_MAX)
  })

  it('rounds fractions', () => {
    expect(clampPetSize(160.6)).toBe(161)
    expect(clampPetSize(160.4)).toBe(160)
  })

  it('falls back to the default for non-finite input', () => {
    expect(clampPetSize(Number.NaN)).toBe(PET_SIZE_DEFAULT)
    expect(clampPetSize(Number.POSITIVE_INFINITY)).toBe(PET_SIZE_DEFAULT)
  })

  it('defaults to a compact size that does not cover the composer', () => {
    expect(PET_SIZE_DEFAULT).toBe(160)
  })
})

describe('fitPetSize', () => {
  it('keeps a compact pet unchanged on a desktop viewport', () => {
    expect(fitPetSize(160, 16 / 9, 1280, 720)).toBe(160)
  })

  it('shrinks a configured pet so it fits a VS Code sidebar', () => {
    expect(fitPetSize(462, 16 / 9, 360, 720)).toBeLessThanOrEqual(180)
    expect(fitPetSize(462, 16 / 9, 360, 720)).toBeGreaterThanOrEqual(PET_SIZE_MIN)
  })
})

describe('pet overlay hit-testing', () => {
  it('lets idle callouts pass clicks through to the composer', () => {
    expect(cssText).toMatch(/\.dsd-pet__callout\[data-kind="idle"\][\s\S]{0,180}pointer-events:\s*none/)
  })

  it('shows the idle bubble so rotating copy can broadcast', () => {
    expect(cssText).not.toMatch(/\.dsd-pet__callout\[data-kind="idle"\]:not\(\[data-cards\]\):not\(\[data-celebrating\]\)[\s\S]{0,220}display:\s*none/)
    expect(cssText).toMatch(/\.dsd-pet__callout\[data-kind="idle"\][\s\S]{0,180}pointer-events:\s*none/)
  })

  it('caps the desktop bubble and scrolls extra progress instead of clipping the top', () => {
    expect(cssText).toMatch(/\.dsd-pet-layer\[data-shell\] \.dsd-pet__callout[\s\S]{0,280}max-height:\s*min\(220px/)
    expect(cssText).toMatch(/\.dsd-pet-layer\[data-shell\] \.dsd-pet__callout[\s\S]{0,320}overflow-y:\s*auto/)
  })

  it('stays painted above the app chrome and only hides under true modals', () => {
    expect(cssText).toMatch(/\.dsd-pet-layer \{[^}]*z-index:\s*(?:1[2-9]\d|[2-9]\d{2,})/)
    expect(cssText).toContain('body:has([aria-modal="true"]) .dsd-pet-layer')
    expect(cssText).not.toContain('body:has([role="dialog"]) .dsd-pet-layer')
    expect(cssText).not.toContain('body:has([role="listbox"]) .dsd-pet-layer')
    expect(cssText).not.toContain('body:has([role="menu"]) .dsd-pet-layer')
  })

  it('uses a compact center hit target so sparkles do not steal clicks', () => {
    expect(cssText).toMatch(/\.dsd-pet \{[^}]*pointer-events: none/)
    expect(cssText).toMatch(/\.dsd-pet__hit \{[^}]*pointer-events: auto/)
    expect(cssText).toMatch(/\.dsd-pet__hit \{[\s\S]*?width:\s*52%/)
    expect(cssText).toMatch(/\.dsd-pet__hit \{[\s\S]*?height:\s*72%/)
    expect(cssText).not.toContain('.dsd-pet[data-hover] .dsd-pet__art video')
  })
})

describe('cachedThemeOrNull', () => {
  it('returns a valid theme id', () => {
    expect(cachedThemeOrNull('blue-whale')).toBe('blue-whale')
    expect(cachedThemeOrNull('orange-cat')).toBe('orange-cat')
    expect(cachedThemeOrNull('silver-shaded-cat')).toBe('silver-shaded-cat')
    expect(cachedThemeOrNull('dshpet')).toBe('dshpet')
    expect(cachedThemeOrNull('custom')).toBe('custom')
  })

  it('returns null for invalid or missing values', () => {
    expect(cachedThemeOrNull('invalid')).toBeNull()
    expect(cachedThemeOrNull('')).toBeNull()
    expect(cachedThemeOrNull(null)).toBeNull()
    expect(cachedThemeOrNull(undefined)).toBeNull()
  })
})

describe('desktop shell window', () => {
  it('is tall enough for the bubble and mode menu, with click-through wired up', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../desktop-shell/main.mjs', import.meta.url), 'utf8')
    const width = Number(/WIN_W = (\d+)/.exec(src)?.[1])
    const height = Number(/WIN_H = (\d+)/.exec(src)?.[1])
    expect(width).toBeGreaterThanOrEqual(360)
    expect(height).toBeGreaterThanOrEqual(640)
    expect(src).toContain('setIgnoreMouseEvents(true, { forward: true })')
    expect(src).toContain("ipcMain.on('set-ignore-mouse'")
    expect(src).toContain('if (lastIgnore === next) return')
    expect(src).toContain('if (lastX === nx && lastY === ny) return')
    expect(src).toContain('win.webContents.setFrameRate(1)')
    expect(src).toContain("ipcMain.on('start-drag'")
    expect(src).toContain("ipcMain.on('set-paint-active'")
    expect(src).toContain('setFrameRate(paintActive || dragOffset !== null ? 15 : 1)')
    expect(src).toContain('screen.getCursorScreenPoint()')
  })
})
