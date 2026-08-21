import { describe, expect, it } from 'vitest'
import { sanitizeCustomCss, sanitizeCustomVars, sanitizeWallpaperUrl } from '../src/sanitize.ts'

describe('sanitizeWallpaperUrl', () => {
  it('rejects javascript: URLs', () => {
    expect(sanitizeWallpaperUrl('javascript:alert(1)')).toBeNull()
  })

  it('accepts https URLs', () => {
    expect(sanitizeWallpaperUrl('https://x/a.png')).toBe('https://x/a.png')
  })

  it('accepts http URLs, data:image, and same-origin paths', () => {
    expect(sanitizeWallpaperUrl('http://x/a.png')).toBe('http://x/a.png')
    expect(sanitizeWallpaperUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc')
    expect(sanitizeWallpaperUrl('/wallpapers/a.png')).toBe('/wallpapers/a.png')
  })

  it('rejects data:text, newlines, and unescaped closing parentheses', () => {
    expect(sanitizeWallpaperUrl('data:text/html,hi')).toBeNull()
    expect(sanitizeWallpaperUrl('https://x/a.png\n')).toBeNull()
    expect(sanitizeWallpaperUrl('https://x/a).png')).toBeNull()
  })

  it('rejects SVG data URLs and protocol-relative hosts', () => {
    expect(sanitizeWallpaperUrl('data:image/svg+xml,<svg>')).toBeNull()
    expect(sanitizeWallpaperUrl('DATA:IMAGE/SVG+XML;base64,abc')).toBeNull()
    expect(sanitizeWallpaperUrl('//evil.example/a.png')).toBeNull()
  })
})

describe('sanitizeCustomCss', () => {
  it('strips script tags case-insensitively', () => {
    expect(sanitizeCustomCss('a{}</style><script>x').toLowerCase()).not.toContain('<script')
  })

  it('caps length at 32768', () => {
    expect(sanitizeCustomCss('x'.repeat(40000)).length).toBe(32768)
  })

  it('strips </style>, expression(, and -moz-binding', () => {
    const cleaned = sanitizeCustomCss('a{}</STYLE>body{background:expression(alert(1));-MOZ-BINDING:url(x)}')
    const lower = cleaned.toLowerCase()
    expect(lower).not.toContain('</style')
    expect(lower).not.toContain('expression(')
    expect(lower).not.toContain('-moz-binding')
  })

  it('strips broken </style openers, @import, and javascript urls', () => {
    const cleaned = sanitizeCustomCss('a{}</style x><style/>@import url(x);body{background:url(javascript:alert(1))}')
    const lower = cleaned.toLowerCase()
    expect(lower).not.toContain('</style')
    expect(lower).not.toContain('@import')
    expect(lower).not.toContain('javascript:')
  })
})

describe('sanitizeCustomVars', () => {
  it('keeps only valid custom-property keys', () => {
    expect(sanitizeCustomVars({ '--ok': '1', color: 'red', '--x:y': 'z' })).toEqual({ '--ok': '1' })
  })
})
