/**
 * URL / CSS / custom-property sanitizers for appearance apply.
 * Pure and DOM-free so wallpaper, customCss, and customVars cannot smuggle
 * script or style-breakout payloads into the injected theme.
 */

const CUSTOM_VAR_KEY = /^--[a-zA-Z][\w-]*$/
const CUSTOM_CSS_MAX = 32768

/**
 * Allow only http(s), raster data:image, or a same-origin path starting with `/`.
 * Rejects javascript:, data:text, data:image/svg, protocol-relative `//`,
 * newlines, and unescaped `)`.
 */
export function sanitizeWallpaperUrl(raw: string): string | null {
  if (typeof raw !== 'string') return null
  if (/[\r\n\u2028\u2029]/.test(raw)) return null
  const value = raw.trim()
  if (value === '') return null
  if (/(?<!\\)\)/.test(value)) return null
  const lower = value.toLowerCase()
  if (lower.startsWith('javascript:')) return null
  if (lower.startsWith('data:text')) return null
  if (lower.startsWith('data:image/svg')) return null
  if (lower.startsWith('//')) return null
  if (lower.startsWith('http:') || lower.startsWith('https:')) return value
  if (lower.startsWith('data:image/')) return value
  if (value.startsWith('/')) return value
  return null
}

/**
 * Cap custom CSS at 32KiB and strip style-breakout / expression payloads.
 */
export function sanitizeCustomCss(raw: string): string {
  const text = typeof raw === 'string' ? raw : ''
  return text
    .replace(/<\/style/gi, '')
    .replace(/<script/gi, '')
    .replace(/@import\b/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/expression\(/gi, '')
    .replace(/-moz-binding/gi, '')
    .slice(0, CUSTOM_CSS_MAX)
}

/**
 * Keep only well-formed CSS custom-property keys (`--name`).
 */
export function sanitizeCustomVars(vars: Record<string, string>): Record<string, string> {
  if (typeof vars !== 'object' || vars === null || Array.isArray(vars)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(vars)) {
    if (!CUSTOM_VAR_KEY.test(key)) continue
    if (typeof value === 'string' || typeof value === 'number') out[key] = String(value)
  }
  return out
}
