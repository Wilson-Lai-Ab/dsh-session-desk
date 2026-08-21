/**
 * Mapping from the runtime settings document onto a normalized CustomThemeConfig.
 */
import {
  isCornerRadius, isFocusGlow, isSurfaceShadow, isWallpaperTone,
  type CustomThemeConfig, type GlassLevel,
} from './config.ts'

const GLASS_LEVELS: readonly string[] = ['off', 'light', 'frosted', 'mica']

const isGlassLevel = (value: unknown): value is GlassLevel =>
  typeof value === 'string' && GLASS_LEVELS.includes(value)

/** Runtime-editable appearance fields (values may be undefined while loading). */
export interface ThemeSection {
  wallpaper: string | undefined
  wallpaperBlur: number | undefined
  glass: string | undefined
  accent: string | undefined
  autoAccent: boolean | undefined
  surfaceOpacity: number | undefined
  sidebarOpacity: number | undefined
  chatSurfaceOpacity: number | undefined
  inputOpacity: number | undefined
  codeBlockOpacity: number | undefined
  darkSurfaceOpacity: number | undefined
  gradient: string | undefined
  darkScrim: number | undefined
  fontFamily: string | undefined
  codeFontFamily: string | undefined
  fontScale: number | undefined
  scrollbarAccent: boolean | undefined
  vignette: boolean | undefined
  cornerRadius: string | undefined
  surfaceShadow: string | undefined
  focusGlow: string | undefined
  wallpaperTone: string | undefined
  darkAccent: string | undefined
  customCss?: string | undefined
  customVars?: Record<string, string> | undefined
  myPresets?: Record<string, string>
  preset?: string | undefined
}

/**
 * Merge a theme section over the normalized loader config.
 */
export function configFromThemeSection(
  normalized: CustomThemeConfig,
  section: ThemeSection | undefined,
): CustomThemeConfig {
  if (section === undefined) return normalized
  const { darkSurfaceOpacity, ...rest } = normalized
  const stringField = (value: string | undefined, fallback: string): string =>
    value !== undefined && value !== '' ? value : fallback
  return {
    ...rest,
    darkSurfaceOpacity: section.darkSurfaceOpacity ?? section.surfaceOpacity ?? darkSurfaceOpacity ?? 100,
    wallpaper: stringField(section.wallpaper, normalized.wallpaper),
    wallpaperBlur: section.wallpaperBlur ?? normalized.wallpaperBlur,
    glass: isGlassLevel(section.glass) ? section.glass : normalized.glass,
    accent: stringField(section.accent, normalized.accent),
    autoAccent: section.autoAccent ?? normalized.autoAccent,
    surfaceOpacity: section.surfaceOpacity ?? normalized.surfaceOpacity,
    sidebarOpacity: section.sidebarOpacity ?? normalized.sidebarOpacity,
    chatSurfaceOpacity: section.chatSurfaceOpacity ?? normalized.chatSurfaceOpacity,
    inputOpacity: section.inputOpacity ?? normalized.inputOpacity,
    codeBlockOpacity: section.codeBlockOpacity ?? normalized.codeBlockOpacity,
    gradient: stringField(section.gradient, normalized.gradient),
    darkScrim: section.darkScrim ?? normalized.darkScrim,
    fontFamily: stringField(section.fontFamily, normalized.fontFamily),
    codeFontFamily: stringField(section.codeFontFamily, normalized.codeFontFamily),
    fontScale: section.fontScale ?? normalized.fontScale,
    scrollbarAccent: section.scrollbarAccent ?? normalized.scrollbarAccent,
    vignette: section.vignette ?? normalized.vignette,
    cornerRadius: isCornerRadius(section.cornerRadius) ? section.cornerRadius : normalized.cornerRadius,
    surfaceShadow: isSurfaceShadow(section.surfaceShadow) ? section.surfaceShadow : normalized.surfaceShadow,
    focusGlow: isFocusGlow(section.focusGlow) ? section.focusGlow : normalized.focusGlow,
    wallpaperTone: isWallpaperTone(section.wallpaperTone) ? section.wallpaperTone : normalized.wallpaperTone,
    darkAccent: stringField(section.darkAccent, normalized.darkAccent),
    customCss: typeof section.customCss === 'string' ? section.customCss : normalized.customCss,
    customVars: section.customVars ?? normalized.customVars,
    preset: stringField(section.preset, normalized.preset),
  }
}
