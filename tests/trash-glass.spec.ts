import { describe, expect, it } from 'vitest'
import { TRASH_GLASS_DEFAULT, TRASH_GLASS_LEVELS, trashGlassLevel } from '../src/client/trash/glass.ts'

describe('TRASH_GLASS_LEVELS', () => {
  it('covers every GlassLevel word', () => {
    expect(Object.keys(TRASH_GLASS_LEVELS).sort()).toEqual(['frosted', 'light', 'mica', 'off'])
  })

  it('off is the opaque plate (no blur, near-opaque tint)', () => {
    const off = TRASH_GLASS_LEVELS.off
    expect(off.blur).toBe(0)
    expect(off.alphaC).toBe(1)
    expect(off.saturate).toBe(1)
  })

  it('frosted matches the shipped default look (blur 20, tint 0.62/0.30)', () => {
    const frosted = TRASH_GLASS_LEVELS.frosted
    expect(frosted.blur).toBe(20)
    expect(frosted.alphaC).toBe(0.62)
    expect(frosted.alphaE).toBe(0.3)
    expect(frosted.saturate).toBeGreaterThan(1)
  })

  it('levels are ordered off < light < frosted < mica by blur', () => {
    const blurs = (['off', 'light', 'frosted', 'mica'] as const).map(l => TRASH_GLASS_LEVELS[l].blur)
    expect(blurs).toEqual([...blurs].sort((a, b) => a - b))
  })

  it('trashGlassLevel falls back to frosted for unknown / undefined', () => {
    expect(trashGlassLevel(undefined)).toBe(TRASH_GLASS_LEVELS.frosted)
    expect(trashGlassLevel('bogus' as never)).toBe(TRASH_GLASS_LEVELS.frosted)
    expect(TRASH_GLASS_DEFAULT).toBe('frosted')
  })
})
