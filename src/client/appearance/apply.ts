/**
 * Applier: turns a normalized `CustomThemeConfig` into DOM effects.
 *
 * Writes `--dsd-*` custom properties on <html>, gated behind
 * `html[data-dsd-active]`. Neutral config must not set the gate.
 * Wallpaper, customCss, and customVars always pass through sanitize.
 */
import { sanitizeCustomCss, sanitizeCustomVars, sanitizeWallpaperUrl } from '../../sanitize.ts'
import type { CustomThemeConfig } from './config.ts'
import { clampNumber, cleanString, DEFAULTS, GLASS_LEVELS } from './config.ts'
import { dominantColorFromRgba } from './color.ts'
import { adoptThemeStyles } from './theme-styles.ts'

const CUSTOM_STYLE_ID = 'dsh-session-desk-css'

/** Gated `--dsd-*` properties written onto `<html>` (cleared on reset). */
export const THEME_PROPERTY_KEYS = [
  '--dsd-wallpaper',
  '--dsd-blur',
  '--dsd-saturate',
  '--dsd-accent',
  '--dsd-surface-alpha',
  '--dsd-sidebar-alpha',
  '--dsd-chat-alpha',
  '--dsd-input-alpha',
  '--dsd-code-alpha',
  '--dsd-dark-alpha',
  '--dsd-scrim',
  '--dsd-gradient',
  '--dsd-font',
  '--dsd-code-font',
  '--dsd-font-scale',
  '--dsd-scrollbar',
  '--dsd-vignette',
  '--dsd-radius',
  '--dsd-shadow',
  '--dsd-focus-glow',
  '--dsd-tone',
  '--dsd-dark-accent',
] as const

let lastCustomVarKeys: string[] = []

export interface ReconciledCustomVars {
  toRemove: string[]
  toWrite: Record<string, string>
  kept: string[]
}

/**
 * Diff previously written custom-var keys against the next sanitized map.
 * Keys that disappear (or whose value is '') are listed for removeProperty.
 */
export function reconcileCustomVarKeys(
  previous: readonly string[],
  next: Record<string, string>,
): ReconciledCustomVars {
  const toWrite: Record<string, string> = {}
  const kept: string[] = []
  for (const [key, value] of Object.entries(next)) {
    if (value === '') continue
    toWrite[key] = value
    kept.push(key)
  }
  const nextSet = new Set(kept)
  const toRemove = previous.filter((key) => !nextSet.has(key))
  return { toRemove, toWrite, kept }
}

/** Corner radius px per level ('inherit' is handled by the caller). */
const CORNER_RADIUS_PX: Readonly<Record<string, number>> = { sm: 6, md: 10, lg: 14, xl: 18 }

/** Box-shadow string per surface-shadow level ('inherit' is handled by the caller). */
const SURFACE_SHADOW_CSS: Readonly<Record<string, string>> = {
  none: 'none',
  soft: '0 8px 24px rgb(0 0 0 / 0.10)',
  medium: '0 14px 36px rgb(0 0 0 / 0.16)',
  strong: '0 24px 56px rgb(0 0 0 / 0.26)',
}

/** Tone overlay as a background-image layer (a bare color would invalidate the declaration). */
const WALLPAPER_TONE_CSS: Readonly<Record<string, string>> = {
  soft: 'linear-gradient(rgb(15 17 21 / 0.16), rgb(15 17 21 / 0.16))',
  dim: 'linear-gradient(rgb(15 17 21 / 0.34), rgb(15 17 21 / 0.34))',
  bright: 'linear-gradient(rgb(255 255 255 / 0.12), rgb(255 255 255 / 0.12))',
}

/** Escapes a wallpaper string for embedding inside `url("…")`. */
const escapeUrl = (text: string): string => text.replaceAll('"', '\\"')

/**
 * Load the wallpaper into an offscreen canvas and extract its dominant
 * saturated color. Resolves null on any failure (CORS, decode, missing 2D).
 */
export async function extractWallpaperAccent(url: string): Promise<string | null> {
  const safe = sanitizeWallpaperUrl(url)
  if (safe === null) return null
  try {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('wallpaper decode failed'))
      image.src = safe
    })
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) return null
    context.drawImage(image, 0, 0, size, size)
    const pixels = context.getImageData(0, 0, size, size).data
    return dominantColorFromRgba(pixels)
  } catch {
    return null
  }
}

/**
 * True when the normalized config overrides nothing — the exact stock look.
 * Neutral config must not set `data-dsd-active`.
 */
export const isNeutralConfig = (config: CustomThemeConfig): boolean =>
  config.wallpaper === DEFAULTS.wallpaper
  && config.gradient === DEFAULTS.gradient
  && config.accent === DEFAULTS.accent
  && config.autoAccent === DEFAULTS.autoAccent
  && config.glass === DEFAULTS.glass
  && config.surfaceOpacity === DEFAULTS.surfaceOpacity
  && config.sidebarOpacity === DEFAULTS.sidebarOpacity
  && config.chatSurfaceOpacity === DEFAULTS.chatSurfaceOpacity
  && config.inputOpacity === DEFAULTS.inputOpacity
  && config.codeBlockOpacity === DEFAULTS.codeBlockOpacity
  && config.darkSurfaceOpacity === 100
  && config.darkScrim === DEFAULTS.darkScrim
  && config.fontFamily === DEFAULTS.fontFamily
  && config.codeFontFamily === DEFAULTS.codeFontFamily
  && config.fontScale === DEFAULTS.fontScale
  && config.scrollbarAccent === DEFAULTS.scrollbarAccent
  && config.vignette === DEFAULTS.vignette
  && config.cornerRadius === DEFAULTS.cornerRadius
  && config.surfaceShadow === DEFAULTS.surfaceShadow
  && config.focusGlow === DEFAULTS.focusGlow
  && config.wallpaperTone === DEFAULTS.wallpaperTone
  && config.darkAccent === DEFAULTS.darkAccent
  && config.customCss === DEFAULTS.customCss
  && config.wallpaperBlur === DEFAULTS.wallpaperBlur
  && config.preset === DEFAULTS.preset
  && Object.keys(config.customVars).length === 0

/**
 * Apply the normalized config to the document.
 */
function clearThemeProperties(root: CSSStyleDeclaration): void {
  for (const key of THEME_PROPERTY_KEYS) root.removeProperty(key)
}

function applyCustomVars(root: CSSStyleDeclaration, vars: Record<string, string>): void {
  const next = reconcileCustomVarKeys(lastCustomVarKeys, vars)
  for (const key of next.toRemove) root.removeProperty(key)
  for (const [key, value] of Object.entries(next.toWrite)) root.setProperty(key, value)
  lastCustomVarKeys = next.kept
}

/**
 * Apply the normalized config to the document.
 */
export function applyConfig(config: CustomThemeConfig): void {
  if (typeof document === 'undefined') return
  adoptThemeStyles()
  const root = document.documentElement
  if (isNeutralConfig(config)) {
    root.removeAttribute('data-dsd-active')
    document.getElementById(CUSTOM_STYLE_ID)?.remove()
    clearThemeProperties(root.style)
    applyCustomVars(root.style, {})
    return
  }
  root.setAttribute('data-dsd-active', '1')

  const set = (name: string, value: string): void => root.style.setProperty(name, value)
  const wallpaperRaw = cleanString(config.wallpaper, '')
  const wallpaper = wallpaperRaw === '' ? '' : (sanitizeWallpaperUrl(wallpaperRaw) ?? '')
  if (wallpaper === '') root.style.removeProperty('--dsd-wallpaper')
  else set('--dsd-wallpaper', `url("${escapeUrl(wallpaper)}")`)
  const blurPx = config.glass === 'off' ? GLASS_LEVELS.off.blur : clampNumber(config.wallpaperBlur, 0, 60, 14)
  set('--dsd-blur', `${blurPx}px`)
  set('--dsd-saturate', String(GLASS_LEVELS[config.glass]?.saturate ?? 1.25))
  set('--dsd-accent', cleanString(config.accent, '#4176e6'))
  set('--dsd-surface-alpha', `${clampNumber(config.surfaceOpacity, 0, 100, 50)}%`)
  set('--dsd-sidebar-alpha', `${clampNumber(config.sidebarOpacity, 0, 100, 50)}%`)
  set('--dsd-chat-alpha', `${clampNumber(config.chatSurfaceOpacity, 0, 100, 80)}%`)
  set('--dsd-input-alpha', `${clampNumber(config.inputOpacity, 0, 100, 82)}%`)
  set('--dsd-code-alpha', `${clampNumber(config.codeBlockOpacity, 0, 100, 45)}%`)
  set('--dsd-dark-alpha', `${clampNumber(config.darkSurfaceOpacity, 0, 100, config.surfaceOpacity)}%`)
  set('--dsd-scrim', `rgb(15 17 21 / ${clampNumber(config.darkScrim, 0, 100, 22) / 100})`)
  const gradient = config.gradient !== '' ? sanitizeCustomCss(config.gradient) : ''
  set('--dsd-gradient', gradient !== '' ? gradient : 'none')
  const font = cleanString(config.fontFamily, '')
  if (font !== '') set('--dsd-font', font)
  else root.style.removeProperty('--dsd-font')
  const codeFont = cleanString(config.codeFontFamily, '')
  if (codeFont !== '') set('--dsd-code-font', codeFont)
  else root.style.removeProperty('--dsd-code-font')
  if (config.fontScale !== 1) set('--dsd-font-scale', `${clampNumber(config.fontScale, 0.9, 1.1, 1)}`)
  else root.style.removeProperty('--dsd-font-scale')
  set('--dsd-scrollbar', config.scrollbarAccent ? '1' : '0')
  set('--dsd-vignette', config.vignette ? '1' : '0')

  if (config.cornerRadius !== 'inherit') set('--dsd-radius', `${CORNER_RADIUS_PX[config.cornerRadius] ?? 10}px`)
  else root.style.removeProperty('--dsd-radius')
  if (config.surfaceShadow !== 'inherit') set('--dsd-shadow', SURFACE_SHADOW_CSS[config.surfaceShadow] ?? 'none')
  else root.style.removeProperty('--dsd-shadow')
  set('--dsd-focus-glow', config.focusGlow === 'on' ? '1' : '0')
  if (config.wallpaperTone !== 'inherit') set('--dsd-tone', WALLPAPER_TONE_CSS[config.wallpaperTone] ?? 'none')
  else root.style.removeProperty('--dsd-tone')
  const darkAccent = cleanString(config.darkAccent, '')
  if (darkAccent !== '') set('--dsd-dark-accent', darkAccent)
  else root.style.removeProperty('--dsd-dark-accent')

  if (config.autoAccent && wallpaper !== '') {
    void extractWallpaperAccent(wallpaper).then((color) => {
      if (color !== null) root.style.setProperty('--dsd-accent', color)
    })
  }

  applyCustomVars(root.style, sanitizeCustomVars(config.customVars))

  const customCss = sanitizeCustomCss(config.customCss)
  let style = document.getElementById(CUSTOM_STYLE_ID) as HTMLStyleElement | null
  if (customCss !== '') {
    if (style === null) {
      style = document.createElement('style')
      style.id = CUSTOM_STYLE_ID
      style.dataset.plugin = 'dsh-session-desk'
      document.head.appendChild(style)
    }
    style.textContent = customCss
  } else {
    style?.remove()
  }
}
