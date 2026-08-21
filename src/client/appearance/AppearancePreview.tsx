/** Mini UI mock that follows the staged appearance draft. */

import { sanitizeCustomCss, sanitizeWallpaperUrl } from '../../sanitize.ts'
import type { ThemeSection } from './theme-section.ts'

const cleanString = (value: string | undefined, fallback: string): string =>
  typeof value === 'string' && value !== '' ? value : fallback
const toNumber = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' ? value : fallback

/** Mini interface mock reflecting the staged draft. */
export function AppearancePreview({ draft }: { draft: ThemeSection }) {
  const accent = cleanString(draft.accent, '#4176e6')
  const gradient = sanitizeCustomCss(cleanString(draft.gradient, ''))
  const wallpaper = sanitizeWallpaperUrl(cleanString(draft.wallpaper, '')) ?? ''
  const fontFamily = cleanString(draft.fontFamily, '')
  const codeFont = cleanString(draft.codeFontFamily, '')
  const scale = toNumber(draft.fontScale, 1)
  const scrim = toNumber(draft.darkScrim, 0)
  const px = (n: number): string => `${Math.round(n * scale)}px`

  const layers: string[] = []
  if (gradient !== '') layers.push(gradient)
  if (wallpaper !== '') layers.push(`url("${wallpaper.replaceAll('"', '\\"')}")`)
  const backgroundImage = layers.length > 0 ? layers.join(', ') : undefined

  const alpha = (value: number | undefined, fallback: number): string => {
    const n = toNumber(value, fallback)
    return `color-mix(in srgb, var(--pv-base) ${Math.max(4, Math.min(100, n))}%, transparent)`
  }

  return (
    <div
      className="dsd-pv-mock"
      style={{
        ['--pv-accent' as string]: accent,
        ['--pv-scrim' as string]: `${scrim}%`,
        ['--pv-surface' as string]: alpha(draft.surfaceOpacity, 100),
        ['--pv-chat' as string]: alpha(draft.chatSurfaceOpacity, 100),
        ['--pv-input' as string]: alpha(draft.inputOpacity, 100),
        ['--pv-sidebar' as string]: alpha(draft.sidebarOpacity, 100),
        backgroundImage,
        fontFamily: fontFamily !== '' ? fontFamily : undefined,
      }}
    >
      <span className="dsd-pv-scrim" />
      <div className="dsd-pv-window" style={{ fontSize: px(10) }}>
        <div className="dsd-pv-sidebar" style={{ background: 'var(--pv-sidebar)' }}>
          <span className="dsd-pv-navDot" style={{ background: accent }} />
          <span className="dsd-pv-line" />
          <span className="dsd-pv-line" style={{ width: '70%' }} />
          <span className="dsd-pv-navActive" style={{ background: accent }} />
        </div>
        <div className="dsd-pv-main">
          <div className="dsd-pv-topbar">
            <span className="dsd-pv-title" style={{ fontFamily: codeFont !== '' ? codeFont : undefined }}>session-desk</span>
            <span className="dsd-pv-badge" style={{ background: accent, color: '#fff' }}>预览</span>
          </div>
          <div className="dsd-pv-chat" style={{ background: 'var(--pv-chat)' }}>
            <div className="dsd-pv-bubbleLeft" />
            <div className="dsd-pv-bubbleRight" style={{ borderColor: accent }} />
            <div className="dsd-pv-bubbleLeft" style={{ width: '62%' }} />
          </div>
          <div className="dsd-pv-inputRow">
            <span className="dsd-pv-inputField" style={{ background: 'var(--pv-input)' }} />
            <span className="dsd-pv-send" style={{ background: accent }} />
          </div>
        </div>
      </div>
    </div>
  )
}
