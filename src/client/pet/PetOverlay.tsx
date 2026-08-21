/**
 * Draggable shell overlay pet: lists every session and opens one on click.
 * Empty overlay area is pointer-events: none so chat stays clickable.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_SETTINGS, clampPetSize, type SessionDeskSettings } from '../../shared.ts'
import { adoptPetStyles } from './pet-styles.ts'
import {
  aggregatePetKind,
  clampPetPosition,
  completedRows,
  defaultPetPosition,
  foldPetList,
  idlePhraseIndex,
  resolvePetImage,
  subagentDetailRows,
  type FoldedPetRow,
  type PetKind,
} from './status.ts'
import { WhaleMark } from './WhaleMark.tsx'
import { ApPet } from './ApPet.tsx'
import { AP_THEME_IDS, apPhaseOf } from './ap-themes.ts'
import { dshpetTheme } from './dshpet-assets.ts'
import { pickReaction, resolveSprite, selectTheme, type Sprite } from './themes.ts'
import { answerPetState, type AnswerPetSnapshot } from '../api.ts'

interface SessionRow {
  id?: string
  sessionId?: string
  title?: string
  displayTitle?: string
  openState?: string
  running?: boolean
  pendingInteraction?: string
  error?: unknown
  failed?: unknown
  parentId?: string
  parentSessionId?: string
  origin?: 'subagent' | string
}

interface SessionsSnapshot {
  current?: string
  ids?: string[]
  byId?: Record<string, SessionRow>
  items?: SessionRow[]
  jobsBySession?: Record<string, readonly { kind?: string; status?: string }[] | undefined>
  subagentsByParent?: Record<string, { entries?: readonly { kind?: string; activity?: string }[] } | undefined>
}

interface SettingsSnapshot {
  value?: SessionDeskSettings
}

export interface PetOverlayProps {
  t?: (key: string, vars?: Record<string, string | number>) => string
  useSessions?: <T>(select: (snapshot: SessionsSnapshot) => T) => T
  useScope?: <T>(select: (snapshot: SettingsSnapshot) => T) => T
  hooks?: { scope?: unknown }
  sessions?: {
    list?: unknown
    open?: (id: string) => unknown
    refreshSubagents?: (parentSessionId: string) => Promise<void>
    setSubagentCatalogOpen?: (parentSessionId: string, open: boolean) => void
  }
  update?: (patch: Partial<SessionDeskSettings>) => Promise<void> | void
}

const DRAG_THRESHOLD = 4

/** Desktop-shell HTTP prefix (browser bundle must not pull node: modules from src/desktop). */
const PET_DESKTOP_PREFIX = '/session-desk/pet-desktop'

/** Headers the /status poll mutations and the mode POSTs share. See src/http.ts:244. */
const CSRF_HEADERS = {
  'content-type': 'application/json',
  'x-dsh-session-desk': '1',
} as const

function readListStore(list: unknown): SessionsSnapshot | undefined {
  if (list === undefined || list === null) return undefined
  try {
    if (typeof list === 'function') return list() as SessionsSnapshot
    if (typeof list === 'object' && 'getSnapshot' in list) {
      const snap = (list as { getSnapshot: () => unknown }).getSnapshot()
      return snap as SessionsSnapshot
    }
  } catch {
    return undefined
  }
  return undefined
}

function subscribeListStore(list: unknown, listener: () => void): (() => void) | undefined {
  if (list === undefined || list === null) return undefined
  if (typeof list === 'object' && 'subscribe' in list) {
    const subscribe = (list as { subscribe?: (fn: () => void) => unknown }).subscribe
    if (typeof subscribe !== 'function') return undefined
    const off = subscribe(listener)
    return typeof off === 'function' ? () => { off() } : undefined
  }
  return undefined
}

function kindLabel(kind: PetKind, t: PetOverlayProps['t']): string {
  return t?.(`pet.kind.${kind}`) ?? kind
}

/** Speech-bubble status text: richer than the plain kind label, with a count. */
function bubbleText(kind: PetKind, count: number, t: PetOverlayProps['t']): string {
  return t?.(`pet.bubble.${kind}`, { n: count }) ?? kindLabel(kind, t)
}

interface BubbleRow {
  id: string
  text: string
}

/** Number of rotating idle-copy phrases in `pet.idle.copy.N`. */
const IDLE_PHRASE_COUNT = 8

/** Clickable rows for the list-bearing statuses (running / awaiting / subagent). */
function bubbleRows(
  kind: PetKind,
  entries: readonly FoldedPetRow[],
  subagentDetail: readonly FoldedPetRow[],
  t: PetOverlayProps['t'],
): BubbleRow[] {
  if (kind === 'subagent') {
    return subagentDetail.map(e => ({ id: e.id, text: e.title }))
  }
  if (kind === 'running') {
    return entries
      .filter(e => e.kind === 'running' || e.kind === 'subagent')
      .map(e => ({
        id: e.id,
        text: `${e.title} · ${t?.(`pet.activity.${e.activity ?? 'running'}`) ?? ''}`,
      }))
  }
  if (kind === 'awaiting') {
    return entries
      .filter(e => e.kind === kind)
      .map(e => {
        const request = e.tool ? (t?.('pet.awaiting.request', { tool: e.tool }) ?? '') : ''
        return { id: e.id, text: request ? `${e.title} ${request}` : e.title }
      })
  }
  return []
}

/**
 * Two-layer video. When `src` changes, the new webm is loaded (and starts
 * playing muted) in a hidden layer while the old one keeps showing, then the
 * layers hard-swap once the new first frame is ready. This avoids the blank
 * decode frame that a plain in-place `src` swap shows. Hard cut (no crossfade):
 * dsh-pet webm carry an alpha channel, so overlapping them would ghost.
 */
interface PetVideoLayer {
  src: string
  loop: boolean
  onEnded?: () => void
}

function PetVideo(props: { src: string; loop: boolean; onEnded?: () => void }): ReactNode {
  const { src, loop, onEnded } = props
  const [layers, setLayers] = useState<[PetVideoLayer | null, PetVideoLayer | null]>([
    { src, loop, onEnded },
    null,
  ])
  const [visible, setVisible] = useState(0)
  const visibleRef = useRef(0)
  visibleRef.current = visible
  const refs = [useRef<HTMLVideoElement | null>(null), useRef<HTMLVideoElement | null>(null)]

  useEffect(() => {
    const vis = visibleRef.current
    const cur = layers[vis]
    if (cur !== null && cur.src === src && cur.loop === loop) return
    const hidden = 1 - vis
    setLayers(prev => {
      const next: [PetVideoLayer | null, PetVideoLayer | null] = [prev[0], prev[1]]
      next[hidden] = { src, loop, onEnded }
      return next
    })
  }, [src, loop, onEnded])

  const handleReady = (idx: number): void => {
    if (idx === visibleRef.current) return
    void refs[idx].current?.play().catch(() => {})
    setVisible(idx)
    setLayers(prev => {
      const next: [PetVideoLayer | null, PetVideoLayer | null] = [prev[0], prev[1]]
      next[1 - idx] = null
      return next
    })
  }

  return (
    <>
      {[0, 1].map(i => {
        const layer = layers[i]
        return (
          <video
            key={i}
            ref={refs[i]}
            src={layer?.src ?? undefined}
            autoPlay
            loop={layer?.loop ?? true}
            muted
            playsInline
            onLoadedData={layer !== null ? () => handleReady(i) : undefined}
            onEnded={i === visible && layer !== null && !layer.loop ? layer.onEnded : undefined}
            className={i === visible ? 'dsd-pet__layer dsd-pet__layer--on' : 'dsd-pet__layer'}
          />
        )
      })}
    </>
  )
}

export function PetOverlay(props: PetOverlayProps): ReactNode {
  adoptPetStyles()
  const [hidden, setHidden] = useState(false)
  const [fallbackList, setFallbackList] = useState<SessionsSnapshot | undefined>(undefined)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)
  const moved = useRef(false)
  const origin = useRef({ pointerX: 0, pointerY: 0, x: 0, y: 0 })
  const livePos = useRef({ x: 0, y: 0 })
  const layerRef = useRef<HTMLDivElement | null>(null)

  const scoped = props.useScope ? props.useScope(snapshot => snapshot.value) : undefined
  const settings: SessionDeskSettings = { ...DEFAULT_SETTINGS, ...(scoped ?? {}) }
  const hookedList = props.useSessions ? props.useSessions(snapshot => snapshot) : undefined

  const petDesktop = settings.petDesktop === true
  const [desktopActive, setDesktopActive] = useState(false)
  const [desktopDownloading, setDesktopDownloading] = useState(false)
  const lastAckRef = useRef<number | null>(null)
  const prevDesktopRef = useRef<boolean | null>(null)

  // While desktop mode is armed, poll the host /status every 1s. If an active
  // desktop window exists, hide the browser pet; also consume any pendingOpen
  // the desktop shell records (open the session + ack so it isn't replayed).
  // Dedup ack'd `at` so an in-flight poll can't double-fire sessions.open.
  useEffect(() => {
    if (!petDesktop) {
      setDesktopActive(false)
      setDesktopDownloading(false)
      lastAckRef.current = null
      return undefined
    }
    let stopped = false
    const poll = async (): Promise<void> => {
      if (stopped) return
      try {
        const res = await fetch(`${PET_DESKTOP_PREFIX}/status`)
        if (!res.ok) return
        const data = (await res.json()) as {
          ok?: boolean
          active?: boolean
          pendingOpen?: { id?: string; at?: number } | null
          download?: { stage?: string; pct?: number | null; error?: string }
        }
        setDesktopActive(data.active === true)
        setDesktopDownloading(data.download?.stage === 'downloading')
        const pending = data.pendingOpen
        if (
          pending &&
          typeof pending.id === 'string' &&
          typeof pending.at === 'number' &&
          pending.at !== lastAckRef.current
        ) {
          lastAckRef.current = pending.at
          void props.sessions?.open?.(pending.id)
          void fetch(`${PET_DESKTOP_PREFIX}/ack-open`, {
            method: 'POST',
            headers: CSRF_HEADERS,
            body: JSON.stringify({ at: pending.at }),
          })
        }
      } catch {
        /* keep last known state */
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [petDesktop, props.sessions])

  // Reconcile the desktop shell with the petDesktop setting. On mount a
  // persisted petDesktop=true re-arms the shell (restart case); afterwards a
  // settings change spawns (false→true) or closes (true→false) the shell. A
  // failed spawn clears the flag so the user can retry from settings.
  useEffect(() => {
    const prev = prevDesktopRef.current
    prevDesktopRef.current = petDesktop
    if (prev !== null && prev === petDesktop) return
    let cancelled = false
    if (petDesktop) {
      void (async () => {
        try {
          const res = await fetch(`${PET_DESKTOP_PREFIX}/spawn`, { method: 'POST', headers: CSRF_HEADERS, body: '{}' })
          if (!res.ok && !cancelled) void props.update?.({ petDesktop: false })
        } catch {
          if (!cancelled) void props.update?.({ petDesktop: false })
        }
      })()
    } else if (prev !== null) {
      // true→false: close the shell. Skip on mount (prev null + petDesktop
      // false means nothing is running to close).
      void fetch(`${PET_DESKTOP_PREFIX}/close`, { method: 'POST', headers: CSRF_HEADERS, body: JSON.stringify({ petDesktop: false }) })
    }
    return () => { cancelled = true }
  }, [petDesktop])

  useEffect(() => {
    if (props.useSessions) return
    try {
      const list = props.sessions?.list
      const pull = (): void => setFallbackList(readListStore(list))
      pull()
      return subscribeListStore(list, pull)
    } catch {
      setHidden(true)
      return undefined
    }
  }, [props.sessions, props.useSessions])

  const snapshot = hookedList ?? fallbackList
  const entries = useMemo(() => {
    try {
      return foldPetList(snapshot)
    } catch {
      return []
    }
  }, [snapshot])

  const watchIds = useMemo(() => {
    const ids = new Set<string>()
    if (typeof snapshot?.current === 'string' && snapshot.current !== '') ids.add(snapshot.current)
    for (const row of entries) {
      if (row.kind === 'running' || row.kind === 'subagent' || row.kind === 'awaiting') ids.add(row.id)
    }
    return [...ids].join('\0')
  }, [entries, snapshot])

  useEffect(() => {
    const refresh = props.sessions?.refreshSubagents
    const setCatalogOpen = props.sessions?.setSubagentCatalogOpen
    const ids = watchIds === '' ? [] : watchIds.split('\0')
    for (const id of ids) {
      try {
        setCatalogOpen?.(id, true)
        void refresh?.(id)
      } catch {
        /* catalog watch is best-effort */
      }
    }
    return () => {
      for (const id of ids) {
        try {
          setCatalogOpen?.(id, false)
        } catch {
          /* ignore */
        }
      }
    }
  }, [watchIds, props.sessions])

  const kind = aggregatePetKind(entries.map(row => row.kind))
  const [celebrating, setCelebrating] = useState(false)
  const [completedList, setCompletedList] = useState<readonly FoldedPetRow[]>([])
  const prevEntriesRef = useRef<readonly FoldedPetRow[]>([])
  const timerRef = useRef<number | undefined>(undefined)

  // Celebrate each session as it finishes (busy → idle). New completions append to
  // the broadcast and extend the timer; the banner clears after 8s of quiet.
  useEffect(() => {
    const prevEntries = prevEntriesRef.current
    const justCompleted = completedRows(prevEntries, entries)
    prevEntriesRef.current = entries

    if (justCompleted.length === 0) return

    setCompletedList(prev => {
      const seen = new Set(prev.map(e => e.id))
      const added = justCompleted.filter(e => !seen.has(e.id))
      return added.length > 0 ? [...prev, ...added] : prev
    })
    setCelebrating(true)

    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setCelebrating(false)
      setCompletedList([])
      timerRef.current = undefined
    }, 8000)
  }, [entries])

  // Clear the celebration timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    }
  }, [])
  const size = clampPetSize(settings.petSize)
  const theme = useMemo(
    () => selectTheme(settings.petTheme, resolvePetImage(settings.petImage), dshpetTheme, AP_THEME_IDS),
    [settings.petTheme, settings.petImage],
  )
  const petHeight = Math.round(size / theme.aspect)
  const [idleTick, setIdleTick] = useState(0)
  useEffect(() => {
    if (kind !== 'idle') return
    let timer = 0
    const schedule = (): void => {
      // Rotate idle copy on a random 5–60s cadence instead of a fixed interval.
      timer = window.setTimeout(() => {
        setIdleTick(t => t + 1)
        schedule()
      }, 5000 + Math.random() * 55000)
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [kind])
  const sprite = useMemo(() => resolveSprite(theme, kind), [theme, kind, idleTick])
  // Main sessions that are working (streaming) or orchestrating subagents.
  const runningRows = entries.filter(e => e.kind === 'running' || e.kind === 'subagent')
  const awaitingRows = entries.filter(e => e.kind === 'awaiting')
  const subagentDetail = useMemo(() => subagentDetailRows(snapshot), [snapshot])
  // Subagent list is collapsed to a summary row by default; click to expand.
  const [subagentOpen, setSubagentOpen] = useState(false)
  useEffect(() => {
    if (subagentDetail.length === 0) setSubagentOpen(false)
  }, [subagentDetail.length])
  const [reaction, setReaction] = useState<Sprite | null>(null)
  useEffect(() => {
    setReaction(null)
  }, [theme])
  const clearReaction = useCallback(() => setReaction(null), [])
  const displaySprite = reaction ?? sprite
  const isReaction = reaction !== null

  // Single-blink on click for answer-pet themes (non-drag): clear after ~340ms.
  const [apBlink, setApBlink] = useState(false)
  const apBlinkTimerRef = useRef<number | undefined>(undefined)
  const triggerApBlink = useCallback((): void => {
    if (apBlinkTimerRef.current !== undefined) window.clearTimeout(apBlinkTimerRef.current)
    setApBlink(true)
    apBlinkTimerRef.current = window.setTimeout(() => {
      setApBlink(false)
      apBlinkTimerRef.current = undefined
    }, 340)
  }, [])
  useEffect(() => {
    if (apBlinkTimerRef.current !== undefined) window.clearTimeout(apBlinkTimerRef.current)
    setApBlink(false)
  }, [theme])
  useEffect(() => {
    return () => {
      if (apBlinkTimerRef.current !== undefined) window.clearTimeout(apBlinkTimerRef.current)
    }
  }, [])
  const isAp = displaySprite.type === 'ap'
  const apThemeId = isAp ? displaySprite.themeId : null

  // Answer-pet live snapshot (real title + non-zero progress from session events).
  const [apSnapshot, setApSnapshot] = useState<AnswerPetSnapshot | null>(null)
  // #3: progress cards are collapsed by default; user expands when needed.
  const [cardsOpen, setCardsOpen] = useState(false)
  useEffect(() => {
    let active = true
    const poll = async (): Promise<void> => {
      if (!active) return
      try {
        setApSnapshot(await answerPetState())
      } catch {
        /* host route absent → keep last */
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])
  // #4: only running(ish) sessions produce cards — idle sessions no longer spam the bubble.
  const apCards = apSnapshot?.running ?? []

  const viewport = (): { w: number; h: number } => ({
    w: typeof window === 'undefined' ? 1280 : window.innerWidth,
    h: typeof window === 'undefined' ? 720 : window.innerHeight,
  })

  const rest = (): { x: number; y: number } => {
    const { w, h } = viewport()
    if (settings.petX === -1 || settings.petY === -1) return defaultPetPosition(w, h, size, petHeight)
    return clampPetPosition(settings.petX, settings.petY, size, petHeight, w, h)
  }

  const pos = dragPos ?? rest()
  livePos.current = pos

  // #5: keep the bubble on-screen and always ABOVE the pet (never flip it below).
  const calloutCenterX = Math.min(Math.max(160, pos.x + size / 2), Math.max(160, viewport().w - 160))
  const calloutAbove = true
  const calloutTop = calloutAbove ? pos.y - 12 : pos.y + petHeight + 12

  useEffect(() => {
    if (settings.petX === -1 || settings.petY === -1) setDragPos(null)
  }, [settings.petX, settings.petY])

  useEffect(() => {
    const onResize = (): void => {
      if (dragging.current) return
      setDragPos(null)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const persistPosition = useCallback((x: number, y: number) => {
    const { w, h } = viewport()
    const next = clampPetPosition(x, y, size, petHeight, w, h)
    void props.update?.({ petX: next.x, petY: next.y })
  }, [props.update, size, petHeight])

  const onPointerDown = (event: { pointerId: number; clientX: number; clientY: number; preventDefault(): void; currentTarget: HTMLElement }): void => {
    event.preventDefault()
    dragging.current = true
    moved.current = false
    const start = rest()
    origin.current = { pointerX: event.clientX, pointerY: event.clientY, x: start.x, y: start.y }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: { clientX: number; clientY: number }): void => {
    if (!dragging.current) return
    const dx = event.clientX - origin.current.pointerX
    const dy = event.clientY - origin.current.pointerY
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) moved.current = true
    const { w, h } = viewport()
    const next = clampPetPosition(origin.current.x + dx, origin.current.y + dy, size, petHeight, w, h)
    livePos.current = next
    setDragPos(next)
  }

  const onPointerUp = (): void => {
    if (!dragging.current) return
    dragging.current = false
    const next = livePos.current
    if (moved.current) persistPosition(next.x, next.y)
    else {
      if (displaySprite.type === 'ap') triggerApBlink()
      const picked = pickReaction(theme)
      if (picked !== null && picked.type === 'video') setReaction(picked)
    }
    setDragPos(moved.current ? next : null)
  }

  const openSession = (id: string): void => {
    try {
      void props.sessions?.open?.(id)
    } catch {
      setHidden(true)
    }
  }

  if (hidden) return null
  if (typeof document === 'undefined') return null
  if (petDesktop && desktopActive) return null

  return createPortal(
    <div ref={layerRef} className="dsd-pet-layer" aria-hidden={false}>
      <button
        type="button"
        className="dsd-pet"
        data-kind={kind}
        data-ap-theme={apThemeId ?? undefined}
        data-ap-phase={apThemeId !== null ? apPhaseOf(kind) : undefined}
        data-ap-click-blink={isAp && apBlink ? 'true' : undefined}
        aria-label={`${props.t?.('pet.title') ?? 'pet'} · ${kindLabel(kind, props.t)}`}
        style={{ left: pos.x, top: pos.y, width: size, height: petHeight }}
        onPointerDown={onPointerDown as never}
        onPointerMove={onPointerMove as never}
        onPointerUp={onPointerUp as never}
        onPointerCancel={onPointerUp as never}
      >
        {/* One sprite slot: the status sprite, or a reaction overlaid through the
            same double-buffer (so a click never shows a blank decode frame). */}
        <span className="dsd-pet__art">
          {displaySprite.type === 'image'
            ? <img src={displaySprite.src} alt="" draggable={false} />
            : displaySprite.type === 'video'
              ? <PetVideo
                  src={displaySprite.src}
                  loop={!isReaction}
                  onEnded={isReaction ? clearReaction : undefined}
                />
              : displaySprite.type === 'ap'
                ? <ApPet themeId={displaySprite.themeId} />
                : <WhaleMark variant={displaySprite.variant} />}
        </span>
      </button>
      {petDesktop && desktopDownloading && !desktopActive && (
        <div className="dsd-pet__preparing">
          {props.t?.('pet.desktop.preparing') ?? '正在准备桌面依赖…'}
        </div>
      )}
      <div
        className="dsd-pet__callout"
        data-kind={kind}
        data-below={calloutAbove ? undefined : 'true'}
        data-celebrating={celebrating ? 'true' : undefined}
        style={{ left: calloutCenterX, top: calloutTop }}
      >
        {celebrating && kind !== 'error' && kind !== 'awaiting' ? (
          <>
            <span className="dsd-pet__callout__head">{props.t?.('pet.bubble.completed') ?? '任务完成啦🎉'}</span>
            {completedList.length > 0 ? (
              completedList.map(row => (
                <button
                  key={row.id}
                  type="button"
                  className="dsd-pet__callout__item"
                  onClick={() => openSession(row.id)}
                >
                  {row.title}
                </button>
              ))
            ) : (
              <span className="dsd-pet__callout__sub">{props.t?.('pet.completed.sub') ?? ''}</span>
            )}
          </>
        ) : kind === 'idle' ? (
          <>
            <span className="dsd-pet__callout__head">{props.t?.('pet.bubble.idle') ?? '休息中'}</span>
            <span className="dsd-pet__callout__sub">
              {props.t?.(`pet.idle.copy.${idlePhraseIndex(idleTick, IDLE_PHRASE_COUNT) + 1}`)
                ?? props.t?.('pet.idle.sub')
                ?? ''}
            </span>
          </>
        ) : kind === 'error' ? (
          <>
            <span className="dsd-pet__callout__head">{props.t?.('pet.bubble.error') ?? '连不上 DSH'}</span>
            <span className="dsd-pet__callout__sub">{props.t?.('pet.error.hint') ?? ''}</span>
          </>
        ) : kind === 'awaiting' ? (
          <>
            <span className="dsd-pet__callout__head">{bubbleText('awaiting', awaitingRows.length, props.t)}</span>
            {bubbleRows('awaiting', entries, subagentDetail, props.t).map(row => (
              <button
                key={row.id}
                type="button"
                className="dsd-pet__callout__item"
                onClick={() => openSession(row.id)}
              >
                {row.text}
              </button>
            ))}
          </>
        ) : (
          <>
            {runningRows.length > 0 && (
              <>
                <span className="dsd-pet__callout__head">{bubbleText('running', runningRows.length, props.t)}</span>
                {bubbleRows('running', entries, subagentDetail, props.t).map(row => (
                  <button
                    key={row.id}
                    type="button"
                    className="dsd-pet__callout__item"
                    onClick={() => openSession(row.id)}
                  >
                    {row.text}
                  </button>
                ))}
              </>
            )}
            {subagentDetail.length > 0 && (
              <>
                <button
                  type="button"
                  className="dsd-pet__callout__toggle"
                  onClick={() => setSubagentOpen(o => !o)}
                >
                  <span className="dsd-pet__callout__chevron">{subagentOpen ? '▾' : '▸'}</span>
                  {bubbleText('subagent', subagentDetail.length, props.t)}
                </button>
                {subagentOpen && bubbleRows('subagent', entries, subagentDetail, props.t).map(row => (
                  <button
                    key={row.id}
                    type="button"
                    className="dsd-pet__callout__item"
                    onClick={() => openSession(row.id)}
                  >
                    {row.text}
                  </button>
                ))}
              </>
            )}
          </>
        )}
        {/* Answer-pet progress cards: hoisted out of the kind branches so they render
            whenever the live engine reports running sessions, independent of the
            session-store `kind` (which can lag). Collapsed by default; click to expand. */}
        {apCards.length > 0 && (
        <div className="dsd-pet__cards">
          {cardsOpen ? (
            <>
              <button
                type="button"
                className="dsd-pet__callout__toggle"
                onClick={() => setCardsOpen(false)}
              >
                <span className="dsd-pet__callout__chevron">▾</span>
                {props.t?.('pet.cards.hide') ?? '收起进度'}
              </button>
              {apCards.map(card => (
                <div key={card.id} className="dsd-pet__card" data-phase={card.view.phase}>
                  <div className="dsd-pet__card__head">
                    <span className="dsd-pet__card__title">{card.title ?? card.id}</span>
                    <span className="dsd-pet__card__label">{card.view.label}</span>
                    <span className="dsd-pet__card__pct">{Math.round(card.view.progress)}%</span>
                  </div>
                  <div className="dsd-pet__card__bar">
                    <span style={{ width: `${Math.min(100, Math.max(0, card.view.progress))}%` }} />
                  </div>
                  <div className="dsd-pet__card__stats">
                    <span>{card.view.outputTokens} tok</span>
                    {card.view.rateTokS > 0 && <span>{card.view.rateTokS} tok/s</span>}
                    <span>{(card.view.elapsedMs / 1000).toFixed(1)}s</span>
                  </div>
                  {card.trace.length > 0 && (
                    <ol className="dsd-pet__card__trace">
                      {card.trace.slice(-4).map(item => (
                        <li key={item.id} data-status={item.status}>
                          <span className="dsd-pet__card__dot" />
                          <span className="dsd-pet__card__trace-label">{item.label}</span>
                          {item.detail !== null && item.detail !== undefined && (
                            <span className="dsd-pet__card__trace-detail">{item.detail}</span>
                          )}
                          <span className="dsd-pet__card__trace-time">{(item.durationMs / 1000).toFixed(1)}s</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </>
          ) : (
            <button
              type="button"
              className="dsd-pet__callout__toggle"
              onClick={() => setCardsOpen(true)}
            >
              <span className="dsd-pet__callout__chevron">▸</span>
              {props.t?.('pet.cards.show') ?? `会话进度 (${apCards.length})`}
            </button>
          )}
        </div>
      )}
      </div>
    </div>,
    document.body,
  )
}
