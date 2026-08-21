import { describe, expect, it } from 'vitest'
import {
  buildCustomTheme,
  pickReaction,
  resolveSprite,
  selectTheme,
  whaleTheme,
  type PetTheme,
  type Sprite,
} from '../src/client/pet/themes.ts'
import { dshpetTheme } from '../src/client/pet/dshpet-assets.ts'

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

describe('whaleTheme', () => {
  it('uses a single pixel-whale image sprite', () => {
    expect(whaleTheme.idlePool).toEqual([{ type: 'image', src: '/session-desk/assets/pet/whale.png' }])
  })

  it('defines all four busy kinds with the same whale image', () => {
    for (const kind of ['running', 'error', 'awaiting', 'subagent'] as const) {
      const s = whaleTheme.busy[kind]
      expect(s).toEqual({ type: 'image', src: '/session-desk/assets/pet/whale.png' })
    }
  })

  it('has no click reactions', () => {
    expect(whaleTheme.reactions).toBeUndefined()
  })
})

describe('pickReaction', () => {
  it('returns null when the theme has no reactions', () => {
    expect(pickReaction(theme(), zero)).toBeNull()
    expect(pickReaction(whaleTheme, zero)).toBeNull()
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

  it('returns the whale theme by default and for whale id', () => {
    expect(selectTheme('whale', null, dshpet)).toBe(whaleTheme)
    expect(selectTheme('whale', 'https://x/y.gif', dshpet)).toBe(whaleTheme)
  })

  it('returns the dshpet theme for dshpet id', () => {
    expect(selectTheme('dshpet', null, dshpet)).toBe(dshpet)
  })

  it('returns the custom theme when an image is set, whale otherwise', () => {
    expect(selectTheme('custom', 'https://x/y.gif', dshpet).id).toBe('custom')
    expect(selectTheme('custom', null, dshpet)).toBe(whaleTheme)
  })
})

describe('theme aspect ratio', () => {
  it('whale theme matches the pixel whale image (698x514), custom is square', () => {
    expect(whaleTheme.aspect).toBe(698 / 514)
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
