import { describe, expect, it } from 'vitest'
import {
  buildAnswerTheme,
  buildCustomTheme,
  pickReaction,
  resolveSprite,
  selectTheme,
  type PetTheme,
  type Sprite,
} from '../src/client/pet/themes.ts'
import { dshpetTheme } from '../src/client/pet/dshpet-assets.ts'
import { AP_THEME_IDS, apPhaseOf, apThemesCss, resolveApTheme } from '../src/client/pet/ap-themes.ts'

function sprite(type: Sprite['type'], v: string): Sprite {
  if (type === 'image' || type === 'video') return { type, src: v }
  return { type, variant: v }
}

function theme(over: Partial<PetTheme> = {}): PetTheme {
  return {
    id: 'dshpet',
    label: 'x',
    aspect: 1,
    idlePool: [sprite('image', 'i1'), sprite('image', 'i2'), sprite('image', 'i3')],
    busy: {
      running: sprite('image', 'run'),
      error: sprite('image', 'err'),
    },
    ...over,
  }
}

const zero = (): number => 0
const mid = (): number => 0.5
const nearOne = (): number => 0.9999

describe('resolveSprite', () => {
  it('picks a busy sprite for a busy kind', () => {
    expect(resolveSprite(theme(), 'running', zero)).toEqual({ type: 'image', src: 'run' })
    expect(resolveSprite(theme(), 'error', nearOne)).toEqual({ type: 'image', src: 'err' })
  })

  it('picks from the idle pool when idle', () => {
    expect(resolveSprite(theme(), 'idle', zero)).toEqual({ type: 'image', src: 'i1' })
    expect(resolveSprite(theme(), 'idle', nearOne)).toEqual({ type: 'image', src: 'i3' })
  })

  it('falls back to the idle pool when a busy kind is missing', () => {
    // awaiting/subagent not defined in busy
    expect(resolveSprite(theme(), 'awaiting', mid)).toEqual({ type: 'image', src: 'i2' })
  })

  it('returns the fallback sprite when the pool is empty', () => {
    expect(resolveSprite(theme({ idlePool: [] }), 'idle', zero)).toEqual({ type: 'svg', variant: 'idle' })
  })

  it('clamps out-of-range random values', () => {
    expect(resolveSprite(theme(), 'idle', () => 5)).toEqual({ type: 'image', src: 'i3' })
    expect(resolveSprite(theme(), 'idle', () => -1)).toEqual({ type: 'image', src: 'i1' })
  })

  it('returns a video sprite from the idle pool', () => {
    const th = theme({ idlePool: [sprite('video', 'v1'), sprite('video', 'v2')] })
    expect(resolveSprite(th, 'idle', zero)).toEqual({ type: 'video', src: 'v1' })
    expect(resolveSprite(th, 'idle', nearOne)).toEqual({ type: 'video', src: 'v2' })
  })
})

describe('answer-pet themes', () => {
  it('exposes the three built-in theme ids', () => {
    expect(AP_THEME_IDS).toEqual(['blue-whale', 'orange-cat', 'silver-shaded-cat'])
  })

  it('each theme has svg markup, scoped css, and all seven phase metas', () => {
    for (const id of AP_THEME_IDS) {
      const theme = resolveApTheme(id)
      expect(theme.markup).toContain('<svg')
      expect(theme.markup).toContain('ap-pet-svg')
      expect(theme.css).toContain(`data-ap-theme="${id}"`)
      for (const phase of ['idle', 'turn', 'think', 'stream', 'tool', 'done', 'error'] as const) {
        expect(typeof theme.phases[phase].animation).toBe('string')
      }
    }
  })

  it('silver-shaded-cat renders through a served png (not inline base64)', () => {
    const theme = resolveApTheme('silver-shaded-cat')
    expect(theme.markup).toContain('silver-cat-cropped.png')
    expect(theme.markup).not.toContain('data:image/png;base64')
  })

  it('mapped species have sensible aspect ratios', () => {
    expect(resolveApTheme('blue-whale').aspect).toBe(200 / 120)
    expect(resolveApTheme('orange-cat').aspect).toBe(150 / 120)
    expect(resolveApTheme('silver-shaded-cat').aspect).toBe(1201 / 1229)
  })

  it('apThemesCss concatenates every theme scoped to the pet host', () => {
    const css = apThemesCss()
    for (const id of AP_THEME_IDS) {
      expect(css).toContain(`.dsd-pet[data-ap-theme="${id}"]`)
    }
  })
})

describe('apPhaseOf', () => {
  it('maps pet kinds to the driving answer-pet phase', () => {
    expect(apPhaseOf('idle')).toBe('idle')
    expect(apPhaseOf('running')).toBe('stream')
    expect(apPhaseOf('subagent')).toBe('stream')
    expect(apPhaseOf('error')).toBe('error')
    expect(apPhaseOf('awaiting')).toBe('tool')
  })
})

describe('buildAnswerTheme', () => {
  it('uses an ap sprite for every status and the theme aspect', () => {
    const th = buildAnswerTheme('blue-whale')
    expect(th.idlePool).toEqual([{ type: 'ap', themeId: 'blue-whale' }])
    for (const kind of ['running', 'error', 'awaiting', 'subagent'] as const) {
      expect(th.busy[kind]).toEqual({ type: 'ap', themeId: 'blue-whale' })
    }
    expect(th.aspect).toBe(200 / 120)
  })
})

describe('pickReaction', () => {
  it('returns null when the theme has no reactions', () => {
    expect(pickReaction(theme(), zero)).toBeNull()
    expect(pickReaction(buildAnswerTheme('blue-whale'), zero)).toBeNull()
  })

  it('picks a reaction from the pool', () => {
    const th = theme({ reactions: [sprite('video', 'r1'), sprite('video', 'r2')] })
    expect(pickReaction(th, zero)).toEqual({ type: 'video', src: 'r1' })
    expect(pickReaction(th, nearOne)).toEqual({ type: 'video', src: 'r2' })
  })
})

describe('buildCustomTheme', () => {
  it('maps a single image to every state', () => {
    const th = buildCustomTheme('https://x/y.gif')
    expect(th.idlePool).toEqual([{ type: 'image', src: 'https://x/y.gif' }])
    expect(th.busy.running).toEqual({ type: 'image', src: 'https://x/y.gif' })
    expect(th.busy.subagent).toEqual({ type: 'image', src: 'https://x/y.gif' })
  })

  it('uses an empty pool for a null image', () => {
    const th = buildCustomTheme(null)
    expect(th.idlePool).toEqual([])
    expect(resolveSprite(th, 'idle', zero)).toEqual({ type: 'svg', variant: 'idle' })
  })
})

describe('selectTheme', () => {
  const dshpet: PetTheme = theme()
  const apIds = AP_THEME_IDS

  it('returns the answer-pet theme for each ap id', () => {
    for (const id of apIds) {
      expect(selectTheme(id as 'blue-whale', null, dshpet, apIds).busy.running).toEqual({ type: 'ap', themeId: id })
    }
  })

  it('returns the dshpet theme for dshpet id', () => {
    expect(selectTheme('dshpet', null, dshpet, apIds)).toBe(dshpet)
  })

  it('returns the custom theme when an image is set, blue-whale otherwise', () => {
    expect(selectTheme('custom', 'https://x/y.gif', dshpet, apIds).id).toBe('custom')
    expect(selectTheme('custom', null, dshpet, apIds).id).toBe('blue-whale')
  })
})

describe('theme aspect ratio', () => {
  it('ap themes keep their real SVG aspect, custom is square', () => {
    expect(selectTheme('blue-whale', null, theme(), AP_THEME_IDS).aspect).toBe(200 / 120)
    expect(buildCustomTheme('https://x/y.gif').aspect).toBe(1)
  })

  it('dshpet theme is 16:9', () => {
    expect(dshpetTheme.aspect).toBe(16 / 9)
  })

  it('dshpet theme uses webm video sprites', () => {
    expect(dshpetTheme.idlePool.length).toBeGreaterThan(0)
    expect(dshpetTheme.idlePool.every(s => s.type === 'video' && s.src.endsWith('.webm'))).toBe(true)
    for (const kind of ['running', 'error', 'awaiting', 'subagent'] as const) {
      expect(dshpetTheme.busy[kind]?.type).toBe('video')
    }
  })

  it('dshpet theme has three click-reaction videos', () => {
    expect(dshpetTheme.reactions?.length).toBe(3)
    expect(dshpetTheme.reactions?.every(s => s.type === 'video' && s.src.includes('dianji-huiying'))).toBe(true)
  })
})
