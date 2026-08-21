/**
 * Frosted-glass levels for the trash drop target, keyed by the shared
 * GlassLevel word list ('off' | 'light' | 'frosted' | 'mica'). Each level maps
 * to the backdrop-filter and tint parameters the drop-target core consumes via
 * CSS custom properties:
 *
 *   blur    - backdrop blur radius (px); 0 = no blur
 *   alphaC  - centre tint opacity (0..1) of the glass plate
 *   alphaE  - edge tint opacity (0..1); kept ~42% of alphaC like the stock look
 *   saturate - backdrop saturation multiplier
 *
 * 'off' is the opaque plate (blur 0, near-opaque tint) — the pre-glass look.
 */
import type { GlassLevel } from '../../shared.ts'

export interface TrashGlassLevel {
  blur: number
  alphaC: number
  alphaE: number
  saturate: number
}

export const TRASH_GLASS_LEVELS: Readonly<Record<GlassLevel, TrashGlassLevel>> = {
  off: { blur: 0, alphaC: 1, alphaE: 0.9, saturate: 1 },
  light: { blur: 8, alphaC: 0.3, alphaE: 0.12, saturate: 1.25 },
  frosted: { blur: 20, alphaC: 0.62, alphaE: 0.3, saturate: 1.5 },
  mica: { blur: 28, alphaC: 0.68, alphaE: 0.34, saturate: 1.7 },
}

export const TRASH_GLASS_DEFAULT: GlassLevel = 'frosted'

export function trashGlassLevel(level: GlassLevel | undefined): TrashGlassLevel {
  return TRASH_GLASS_LEVELS[level ?? TRASH_GLASS_DEFAULT] ?? TRASH_GLASS_LEVELS.frosted
}
