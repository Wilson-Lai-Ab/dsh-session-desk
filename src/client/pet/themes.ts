/**
 * Pet theme model + sprite resolution. A theme maps the pet status to a
 * "sprite" (an inline SVG variant or an image), with a pool of idle sprites
 * that are randomly cycled while the pet is idle.
 */
import type { PetThemeId } from '../../shared.ts'
import type { PetKind } from './status.ts'
import { resolveApTheme } from './ap-themes.ts'

export type BusyKind = Exclude<PetKind, 'idle'>

export type Sprite =
  | { type: 'image'; src: string }
  | { type: 'video'; src: string }
  | { type: 'svg'; variant: string }
  | { type: 'ap'; themeId: string }

export interface PetTheme {
  id: PetThemeId
  label: string
  /** Container width/height ratio. 1 = square, 16/9 = widescreen webm. */
  aspect: number
  idlePool: readonly Sprite[]
  busy: Partial<Record<BusyKind, Sprite>>
  /** Optional click-reaction sprites, played once on a click (random pick). */
  reactions?: readonly Sprite[]
}

const FALLBACK_SPRITE: Sprite = { type: 'svg', variant: 'idle' }

export function fallbackSprite(): Sprite {
  return FALLBACK_SPRITE
}

/** Pick an idle sprite from the pool using `random` (expected [0, 1)). */
export function pickIdle(theme: PetTheme, random: () => number): Sprite {
  const pool = theme.idlePool
  if (pool.length === 0) return FALLBACK_SPRITE
  const idx = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))
  return pool[idx]
}

/** Resolve the sprite for a status: busy → its fixed sprite, else a random idle one. */
export function resolveSprite(
  theme: PetTheme,
  kind: PetKind,
  random: () => number = Math.random,
): Sprite {
  if (kind !== 'idle') {
    const busy = theme.busy[kind]
    if (busy !== undefined) return busy
  }
  return pickIdle(theme, random)
}

/** Pick a click-reaction sprite, or null when the theme has none. */
export function pickReaction(theme: PetTheme, random: () => number = Math.random): Sprite | null {
  const pool = theme.reactions
  if (pool === undefined || pool.length === 0) return null
  const idx = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))
  return pool[idx]
}

/** Answer-pet theme (declarative SVG + css + phases) rendered inline. */
export function buildAnswerTheme(themeId: string): PetTheme {
  const ap: Sprite = { type: 'ap', themeId }
  return {
    id: themeId as PetThemeId,
    label: resolveApTheme(themeId).name,
    aspect: resolveApTheme(themeId).aspect,
    idlePool: [ap],
    busy: {
      running: ap,
      error: ap,
      awaiting: ap,
      subagent: ap,
    },
  }
}

/** Custom-image theme: one image for every state (empty pool when no image). */
export function buildCustomTheme(image: string | null): PetTheme {
  const pool: Sprite[] = image === null ? [] : [{ type: 'image', src: image }]
  const single: Partial<Record<BusyKind, Sprite>> =
    image === null ? {} : { running: pool[0], error: pool[0], awaiting: pool[0], subagent: pool[0] }
  return { id: 'custom', label: '自定义图片', aspect: 1, idlePool: pool, busy: single }
}

/** Choose the active theme from the setting id. `customImage` is the resolved petImage URL. */
export function selectTheme(
  id: PetThemeId,
  customImage: string | null,
  dshpet: PetTheme,
  apThemeIds: readonly string[],
): PetTheme {
  if (apThemeIds.includes(id)) return buildAnswerTheme(id)
  if (id === 'dshpet') return dshpet
  if (id === 'custom') return customImage === null ? buildAnswerTheme(apThemeIds[0] ?? 'blue-whale') : buildCustomTheme(customImage)
  return buildAnswerTheme(apThemeIds[0] ?? 'blue-whale')
}
