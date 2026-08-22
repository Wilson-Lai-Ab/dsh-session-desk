/**
 * Electron overlay renderer for the dsh-session-desk pet.
 *
 * Runs in the compact desktop window, polling `/snapshot` and rendering
 * `PetOverlay` with `shell`. Dragging moves the native window via preload.
 * `update` POSTs `/settings` so 桌面/浏览器 and position persist.
 */
import { useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { PetOverlay, type PetOverlayProps } from '../src/client/pet/PetOverlay.tsx'
import { zh } from '../src/client/locales.ts'
import { DEFAULT_SETTINGS, type SessionDeskSettings } from '../src/shared.ts'

const token = new URLSearchParams(location.search).get('token') ?? ''
const PREFIX = '/session-desk/pet-desktop'

const EMPTY_SESSIONS = { items: [] as unknown[] }
let snapshot: { sessions: { items: unknown[] }; settings: Partial<SessionDeskSettings> } | null = null
// Recomputed only inside setSnapshot so getSnapshot returns a stable reference.
let scopeSnapshot = { value: { ...DEFAULT_SETTINGS } as Partial<SessionDeskSettings> }
const listeners = new Set<() => void>()

function setSnapshot(next: typeof snapshot) {
  snapshot = next
  scopeSnapshot = { value: { ...DEFAULT_SETTINGS, ...(next?.settings ?? {}) } }
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let lastOk = false
async function poll(): Promise<void> {
  try {
    const res = await fetch(`${PREFIX}/snapshot?token=${encodeURIComponent(token)}`)
    if (res.ok) {
      setSnapshot(await res.json())
      lastOk = true
    } else if (lastOk) {
      // Server flipped to error (e.g. GUI down): surface a stale snapshot so the
      // pet renders the error state instead of freezing on the last good one.
      setSnapshot({ sessions: { items: [] }, settings: { petTheme: 'whale' } })
      lastOk = false
    }
  } catch {
    /* keep last known */
  }
}
void poll()
const timer = setInterval(poll, 1000)

function useSessions<T>(select: (s: { items: unknown[] }) => T): T {
  const snap = useSyncExternalStore(subscribe, () => snapshot?.sessions ?? EMPTY_SESSIONS)
  return select(snap)
}
function useScope<T>(select: (s: { value?: Partial<SessionDeskSettings> }) => T): T {
  const snap = useSyncExternalStore(subscribe, () => scopeSnapshot)
  return select(snap)
}

const update: PetOverlayProps['update'] = (patch) => {
  void fetch(`${PREFIX}/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pet-token': token, 'x-dsh-session-desk': '1' },
    body: JSON.stringify(patch),
  })
  return Promise.resolve()
}

const openSession = (id: string): void => {
  void fetch(`${PREFIX}/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pet-token': token, 'x-dsh-session-desk': '1' },
    body: JSON.stringify({ id }),
  })
}

const t: PetOverlayProps['t'] = (key, vars) => {
  let text = (zh as Record<string, string>)[key] ?? key
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value))
  return text
}

function Root() {
  return (
    <PetOverlay
      t={t}
      useSessions={useSessions as never}
      useScope={useScope as never}
      sessions={{ open: openSession }}
      update={update}
      shell
    />
  )
}

createRoot(document.getElementById('root')!).render(<Root />)