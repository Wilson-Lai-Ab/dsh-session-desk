/**
 * Settings-namespace contract shared by the host registration and later
 * client work. Node-safe: no DOM, no React.
 */

/** Branded settings namespace owned by this plugin. */
export const SESSION_DESK_NS = 'session-desk'

/** Where the floating history strip can sit relative to the conversation. */
export const HISTORY_POSITIONS = ['off', 'left', 'right'] as const

/** One selectable history-strip side (`off` hides the strip). */
export type HistoryPosition = (typeof HISTORY_POSITIONS)[number]

/** Selectable pet theme: `whale` = animated SVG, `dshpet` = bundled dsh-pet GIFs, `custom` = petImage. */
export const PET_THEME_IDS = ['whale', 'dshpet', 'custom'] as const
export type PetThemeId = (typeof PET_THEME_IDS)[number]

/** Allowed pet size range (CSS px). `petSize` is the pet WIDTH; height follows the theme aspect ratio. */
export const PET_SIZE_MIN = 96
export const PET_SIZE_MAX = 800
export const PET_SIZE_DEFAULT = 462

/** Clamp a configured pet size to [MIN, MAX]. */
export function clampPetSize(value: number): number {
  if (!Number.isFinite(value)) return PET_SIZE_DEFAULT
  return Math.min(PET_SIZE_MAX, Math.max(PET_SIZE_MIN, Math.round(value)))
}

/** Parse a localStorage-cached theme id; null when missing or invalid. */
export function cachedThemeOrNull(raw: string | null | undefined): PetThemeId | null {
  if (typeof raw !== 'string') return null
  return (PET_THEME_IDS as readonly string[]).includes(raw) ? (raw as PetThemeId) : null
}

/** Frosted-glass levels copied from ui-custom neutrals. */
export const GLASS_LEVELS = ['off', 'light', 'frosted', 'mica'] as const
export type GlassLevel = (typeof GLASS_LEVELS)[number]

/** Opt-in corner radius (`inherit` keeps the stock look). */
export const CORNER_RADIUS_LEVELS = ['inherit', 'sm', 'md', 'lg', 'xl'] as const
export type CornerRadius = (typeof CORNER_RADIUS_LEVELS)[number]

/** Opt-in surface shadow (`inherit` keeps the stock look). */
export const SURFACE_SHADOW_LEVELS = ['inherit', 'none', 'soft', 'medium', 'strong'] as const
export type SurfaceShadow = (typeof SURFACE_SHADOW_LEVELS)[number]

/** Opt-in focus glow (`inherit` = stock focus, no added ring). */
export const FOCUS_GLOW_LEVELS = ['inherit', 'on'] as const
export type FocusGlow = (typeof FOCUS_GLOW_LEVELS)[number]

/** Opt-in wallpaper tone overlay (`inherit` = untouched wallpaper). */
export const WALLPAPER_TONE_LEVELS = ['inherit', 'soft', 'dim', 'bright'] as const
export type WallpaperTone = (typeof WALLPAPER_TONE_LEVELS)[number]

/**
 * Runtime-editable session-desk settings. Appearance keys match ui-custom
 * ThemeSection plus the extra knobs Task 5 applies, so that task does not
 * reshape this interface.
 */
export interface SessionDeskSettings {
  sessionsRoot: string
  retentionDays: number
  historyPosition: HistoryPosition
  historyLimit: number
  boardTab: boolean
  petEnabled: boolean
  petImage: string
  petTheme: PetThemeId
  petSize: number
  petX: number
  petY: number
  pinnedTurns: Record<string, number[]>
  preset: string
  wallpaper: string
  wallpaperBlur: number
  glass: GlassLevel
  trashGlass: GlassLevel
  accent: string
  autoAccent: boolean
  surfaceOpacity: number
  sidebarOpacity: number
  chatSurfaceOpacity: number
  inputOpacity: number
  codeBlockOpacity: number
  darkSurfaceOpacity: number
  gradient: string
  darkScrim: number
  fontFamily: string
  codeFontFamily: string
  fontScale: number
  scrollbarAccent: boolean
  vignette: boolean
  cornerRadius: CornerRadius
  surfaceShadow: SurfaceShadow
  focusGlow: FocusGlow
  wallpaperTone: WallpaperTone
  darkAccent: string
  customCss: string
  customVars: Record<string, string>
  myPresets: Record<string, string>
}

/** Neutral defaults: no wallpaper, stock accent, opaque surfaces, 30-day trash. */
export const DEFAULT_SETTINGS: SessionDeskSettings = {
  sessionsRoot: '',
  retentionDays: 30,
  historyPosition: 'right',
  historyLimit: 10,
  boardTab: true,
  petEnabled: true,
  petImage: '',
  petTheme: 'whale',
  petSize: PET_SIZE_DEFAULT,
  petX: -1,
  petY: -1,
  pinnedTurns: {},
  preset: '',
  wallpaper: '',
  wallpaperBlur: 14,
  glass: 'frosted',
  trashGlass: 'frosted',
  accent: '#4176e6',
  autoAccent: false,
  surfaceOpacity: 100,
  sidebarOpacity: 100,
  chatSurfaceOpacity: 100,
  inputOpacity: 100,
  codeBlockOpacity: 100,
  darkSurfaceOpacity: 100,
  gradient: '',
  darkScrim: 0,
  fontFamily: '',
  codeFontFamily: '',
  fontScale: 1,
  scrollbarAccent: false,
  vignette: false,
  cornerRadius: 'inherit',
  surfaceShadow: 'inherit',
  focusGlow: 'inherit',
  wallpaperTone: 'inherit',
  darkAccent: '',
  customCss: '',
  customVars: {},
  myPresets: {},
}
