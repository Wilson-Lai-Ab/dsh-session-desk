/**
 * Floating preview hint (shell.overlay): F2 exits preview and reopens settings.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { appearanceEn, appearanceZh, type AppearanceKey } from './appearance-locales.ts'
import { previewBar } from './preview-bar.ts'

export interface PreviewBarProps {
  t?: (key: string) => string
  onExit?: () => void
}

const EXIT_KEY = 'F2'

function fallback(key: AppearanceKey): string {
  const lang = typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('en')
    ? appearanceEn
    : appearanceZh
  return lang[key]
}

export function PreviewBar({ t, onExit }: PreviewBarProps): ReactNode {
  const [visible, setVisible] = useState(previewBar.getSnapshot())
  useEffect(() => previewBar.subscribe(() => setVisible(previewBar.getSnapshot())), [])

  useEffect(() => {
    if (!visible) return
    const onKey = (event: Event): void => {
      const keyEvent = event as unknown as { key: string; preventDefault(): void }
      if (keyEvent.key === EXIT_KEY) {
        keyEvent.preventDefault()
        onExit?.()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [visible, onExit])

  if (!visible) return null
  const label = t?.('appearance.previewingBar') ?? fallback('previewingBar')
  return (
    <div className="dsd-pb-hint" role="status">
      {label}
    </div>
  )
}
