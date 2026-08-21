/**
 * Theme config model + normalization. DOM-free so it is unit-testable.
 * Shortcuts, marketplace, markdown, usage, and the features whitelist are
 * not part of session-desk appearance.
 */
import type { CornerRadius, FocusGlow, GlassLevel, SurfaceShadow, WallpaperTone } from '../../shared.ts'

export type { CornerRadius, FocusGlow, GlassLevel, SurfaceShadow, WallpaperTone }

/** Every appearance knob the applier understands. */
export interface CustomThemeConfig {
  preset: string
  wallpaper: string
  wallpaperBlur: number
  glass: GlassLevel
  accent: string
  autoAccent: boolean
  surfaceOpacity: number
  sidebarOpacity: number
  chatSurfaceOpacity: number
  inputOpacity: number
  codeBlockOpacity: number
  darkSurfaceOpacity?: number
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
}

/** Valid corner-radius values (in UI order). */
export const CORNER_RADIUS_LEVELS: readonly CornerRadius[] = ['inherit', 'sm', 'md', 'lg', 'xl']
/** Valid surface-shadow values (in UI order). */
export const SURFACE_SHADOW_LEVELS: readonly SurfaceShadow[] = ['inherit', 'none', 'soft', 'medium', 'strong']
/** Valid focus-glow values. */
export const FOCUS_GLOW_LEVELS: readonly FocusGlow[] = ['inherit', 'on']
/** Valid wallpaper-tone values (in UI order). */
export const WALLPAPER_TONE_LEVELS: readonly WallpaperTone[] = ['inherit', 'soft', 'dim', 'bright']

const isOneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? value as T : fallback

export const isCornerRadius = (value: unknown): value is CornerRadius =>
  typeof value === 'string' && (CORNER_RADIUS_LEVELS as readonly string[]).includes(value)
export const isSurfaceShadow = (value: unknown): value is SurfaceShadow =>
  typeof value === 'string' && (SURFACE_SHADOW_LEVELS as readonly string[]).includes(value)
export const isFocusGlow = (value: unknown): value is FocusGlow =>
  typeof value === 'string' && (FOCUS_GLOW_LEVELS as readonly string[]).includes(value)
export const isWallpaperTone = (value: unknown): value is WallpaperTone =>
  typeof value === 'string' && (WALLPAPER_TONE_LEVELS as readonly string[]).includes(value)

/** Blur radius + saturation per glass level. */
export const GLASS_LEVELS: Readonly<Record<GlassLevel, { blur: number; saturate: number }>> = {
  off: { blur: 0, saturate: 1 },
  light: { blur: 6, saturate: 1.15 },
  frosted: { blur: 14, saturate: 1.25 },
  mica: { blur: 22, saturate: 1.1 },
}

const isGlassLevel = (value: unknown): value is GlassLevel =>
  typeof value === 'string' && Object.hasOwn(GLASS_LEVELS, value)

/**
 * Resolve blur from an explicit wallpaperBlur, else the glass level default.
 */
export function resolveGlass(raw: Partial<CustomThemeConfig> | undefined): { blur: number; saturate: number } {
  const level = isGlassLevel(raw?.glass) ? raw.glass : DEFAULTS.glass
  const base = GLASS_LEVELS[level]
  const userSetBlur = typeof raw?.wallpaperBlur === 'number' && raw.wallpaperBlur !== DEFAULTS.wallpaperBlur
  const blur = userSetBlur
    ? clampNumber(raw.wallpaperBlur, 0, 60, base.blur)
    : base.blur
  return { blur, saturate: base.saturate }
}

/** Neutral shipped defaults: stock look, no wallpaper, opaque surfaces. */
export const DEFAULTS: CustomThemeConfig = {
  preset: '',
  wallpaper: '',
  wallpaperBlur: 14,
  glass: 'frosted',
  accent: '#4176e6',
  autoAccent: false,
  surfaceOpacity: 100,
  sidebarOpacity: 100,
  chatSurfaceOpacity: 100,
  inputOpacity: 100,
  codeBlockOpacity: 100,
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
  darkSurfaceOpacity: 100,
}

/** Clamp a number into [lo, hi], falling back when absent/non-finite. */
export const clampNumber = (value: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(hi, Math.max(lo, n))
}

/** Trim a string, returning the fallback when empty/non-string. */
export const cleanString = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const toPercent = (value: unknown, fallback: number): number =>
  clampNumber(value, 0, 100, fallback)

const toVars = (value: unknown): Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string' || typeof raw === 'number') out[key] = String(raw)
  }
  return out
}

/**
 * Merge DEFAULTS ← preset ← explicit config, then coerce/clamp every field.
 */
export function normalizeConfig(
  raw: Partial<CustomThemeConfig> | undefined,
  preset: Partial<CustomThemeConfig> | undefined,
): CustomThemeConfig {
  const merged = { ...DEFAULTS, ...preset, ...raw }
  const surfaceOpacity = toPercent(merged.surfaceOpacity, DEFAULTS.surfaceOpacity)
  const darkSurfaceOpacity = merged.darkSurfaceOpacity === undefined
    ? surfaceOpacity
    : toPercent(merged.darkSurfaceOpacity, surfaceOpacity)
  const glass = isGlassLevel(merged.glass) ? merged.glass : DEFAULTS.glass
  const { blur } = resolveGlass(raw)
  return {
    preset: cleanString(merged.preset, DEFAULTS.preset),
    wallpaper: cleanString(merged.wallpaper, DEFAULTS.wallpaper),
    wallpaperBlur: blur,
    glass,
    accent: cleanString(merged.accent, DEFAULTS.accent),
    autoAccent: toBoolean(merged.autoAccent, DEFAULTS.autoAccent),
    surfaceOpacity,
    sidebarOpacity: toPercent(merged.sidebarOpacity, DEFAULTS.sidebarOpacity),
    chatSurfaceOpacity: toPercent(merged.chatSurfaceOpacity, DEFAULTS.chatSurfaceOpacity),
    inputOpacity: toPercent(merged.inputOpacity, DEFAULTS.inputOpacity),
    codeBlockOpacity: toPercent(merged.codeBlockOpacity, DEFAULTS.codeBlockOpacity),
    darkSurfaceOpacity,
    gradient: typeof merged.gradient === 'string' && merged.gradient.trim() !== ''
      ? merged.gradient.trim()
      : '',
    darkScrim: toPercent(merged.darkScrim, DEFAULTS.darkScrim),
    fontFamily: typeof merged.fontFamily === 'string' ? merged.fontFamily.trim() : '',
    codeFontFamily: typeof merged.codeFontFamily === 'string' ? merged.codeFontFamily.trim() : '',
    fontScale: Math.round(clampNumber(merged.fontScale, 0.9, 1.1, DEFAULTS.fontScale) * 20) / 20,
    scrollbarAccent: toBoolean(merged.scrollbarAccent, DEFAULTS.scrollbarAccent),
    vignette: toBoolean(merged.vignette, DEFAULTS.vignette),
    cornerRadius: isOneOf(merged.cornerRadius, CORNER_RADIUS_LEVELS, DEFAULTS.cornerRadius),
    surfaceShadow: isOneOf(merged.surfaceShadow, SURFACE_SHADOW_LEVELS, DEFAULTS.surfaceShadow),
    focusGlow: isOneOf(merged.focusGlow, FOCUS_GLOW_LEVELS, DEFAULTS.focusGlow),
    wallpaperTone: isOneOf(merged.wallpaperTone, WALLPAPER_TONE_LEVELS, DEFAULTS.wallpaperTone),
    darkAccent: cleanString(merged.darkAccent, DEFAULTS.darkAccent),
    customCss: typeof merged.customCss === 'string' ? merged.customCss : '',
    customVars: toVars(merged.customVars),
  }
}

/** Appearance knob names (no shortcuts / features). */
export const CONFIG_KEYS: readonly (keyof CustomThemeConfig)[] = [
  'preset', 'wallpaper', 'wallpaperBlur', 'glass', 'accent', 'autoAccent',
  'surfaceOpacity', 'sidebarOpacity', 'chatSurfaceOpacity', 'inputOpacity',
  'codeBlockOpacity', 'darkSurfaceOpacity', 'gradient', 'darkScrim',
  'fontFamily', 'codeFontFamily', 'fontScale', 'scrollbarAccent', 'vignette', 'cornerRadius', 'surfaceShadow',
  'focusGlow', 'wallpaperTone', 'darkAccent', 'customCss', 'customVars',
]
