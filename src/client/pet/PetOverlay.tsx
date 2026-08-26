/**
 * Draggable shell overlay pet: lists every session and opens one on click.
 * Empty overlay area is pointer-events: none so chat stays clickable.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_SETTINGS, clampPetSize, type SessionDeskSettings } from '../../shared.ts'
import { adoptPetStyles } from './pet-styles.ts'
import {
  calloutLiveStyle,
  clampPetPosition,
  completedFromLive,
  completedRows,
  defaultPetPosition,
  desktopPetRest,
  fitPetSize,
  awaitingFromLiveCards,
  foldPetList,
  foldedPetSignature,
  hideBrowserPet,
  idlePhraseIndex,
  IDLE_BROADCAST_HOLD_MS,
  mergeLiveAwaiting,
  nextIdleBroadcastDelay,
  petKindFromLive,
  progressBySession,
  resolvePetImage,
  runningRowLabel,
  subagentDetailRows,
  type FoldedPetRow,
  type PetKind,
} from './status.ts'
import { classifyPointerEnd, desktopDragOffset, desktopPointerOverChrome, desktopShouldIgnoreMouse, desktopWindowOriginFromBrowserPet, ignoreMouseChanged, petVideoShouldLoop, petVideoShouldPlay, pointerHasMoved } from './pointer.ts'
import { WhaleMark } from './WhaleMark.tsx'
import { ApPet } from './ApPet.tsx'
import { AP_THEME_IDS, apPhaseOf } from './ap-themes.ts'
import { dshpetTheme } from './dshpet-assets.ts'
import { pickReaction, resolveSprite, selectTheme, type Sprite } from './themes.ts'
import { answerPetState, listSessions, type AnswerPetSnapshot } from '../api.ts'
import { formatJsonlBytes, jsonlTooLarge } from '../../session-size.ts'

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
  answerPet?: AnswerPetSnapshot
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
  /** Electron overlay: never spawn extra windows, never hide the pet. */
  shell?: boolean
}

const MODE_HOLD_MS = 480

function useStableFoldedRows(rows: readonly FoldedPetRow[]): readonly FoldedPetRow[] {
  const ref = useRef(rows)
  if (foldedPetSignature(ref.current) !== foldedPetSignature(rows)) ref.current = rows
  return ref.current
}

function readViewport(): { w: number; h: number } {
  return {
    w: typeof window === 'undefined' ? 1280 : window.innerWidth,
    h: typeof window === 'undefined' ? 720 : window.innerHeight,
  }
}

/** Desktop-shell HTTP prefix (browser bundle must not pull node: modules from src/desktop). */
const PET_DESKTOP_PREFIX = '/session-desk/pet-desktop'

/** Headers the /status poll mutations and the mode POSTs share. See src/http.ts:244. */
const CSRF_HEADERS = {
  'content-type': 'application/json',
  'x-dsh-session-desk': '1',
} as const

/** GUI boot splash (`[data-dsh-boot]`) must finish before /spawn — a blocked
 *  host during plugin activation leaves the page stuck on "Loading plugins…". */
function whenWebBootIdle(run: () => void): () => void {
  if (typeof document === 'undefined') { run(); return () => {} }
  if (document.querySelector('[data-dsh-boot]') === null) { run(); return () => {} }
  let cancelled = false
  const tryRun = (): void => {
    if (cancelled || document.querySelector('[data-dsh-boot]') !== null) return
    observer.disconnect()
    run()
  }
  const observer = new MutationObserver(tryRun)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  return () => {
    cancelled = true
    observer.disconnect()
  }
}

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
  progress?: ReadonlyMap<string, number>,
): BubbleRow[] {
  if (kind === 'subagent') {
    return subagentDetail.map(e => ({ id: e.id, text: e.title }))
  }
  if (kind === 'running') {
    return entries
      .filter(e => e.kind === 'running' || e.kind === 'subagent')
      .map(e => ({
        id: e.id,
        text: runningRowLabel(
          e.title,
          t?.(`pet.activity.${e.activity ?? 'running'}`) ?? '',
          progress?.get(e.id),
        ),
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

function PetVideo(props: { src: string; loop: boolean; play: boolean; onEnded?: () => void }): ReactNode {
  const { src, loop, play, onEnded } = props
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

  useEffect(() => {
    const video = refs[visibleRef.current].current
    if (video === null) return
    if (!play || document.hidden) {
      video.pause()
      return
    }
    void video.play().catch(() => {})
  }, [play, src])

  useEffect(() => {
    const sync = (): void => {
      const video = refs[visibleRef.current].current
      if (video === null) return
      if (!play || document.hidden) video.pause()
      else void video.play().catch(() => {})
    }
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [play])

  const handleReady = (idx: number): void => {
    if (idx === visibleRef.current) return
    if (play) void refs[idx].current?.play().catch(() => {})
    else refs[idx].current?.pause()
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
        if (layer === null) return null
        return (
          <video
            key={i}
            ref={refs[i]}
            src={layer.src}
            autoPlay={play}
            loop={layer.loop}
            muted
            playsInline
            preload="metadata"
            disablePictureInPicture
            draggable={false}
            onDragStart={event => event.preventDefault()}
            crossOrigin="anonymous"
            onLoadedData={() => handleReady(i)}
            onEnded={i === visible && !layer.loop ? () => {
              refs[i].current?.pause()
              layer.onEnded?.()
            } : undefined}
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
  const origin = useRef({ pointerX: 0, pointerY: 0, x: 0, y: 0, screenX: 0, screenY: 0, pointerScreenX: 0, pointerScreenY: 0 })
  const livePos = useRef({ x: 0, y: 0 })
  const layerRef = useRef<HTMLDivElement | null>(null)
  const petRef = useRef<HTMLButtonElement | null>(null)
  const calloutRef = useRef<HTMLDivElement | null>(null)
  const dragRaf = useRef(0)
  const ignoreMouseRef = useRef<boolean | null>(null)
  const nativeDrag = useRef(false)

  const scoped = props.useScope ? props.useScope(snapshot => snapshot.value) : undefined
  const settings: SessionDeskSettings = { ...DEFAULT_SETTINGS, ...(scoped ?? {}) }
  const hookedList = props.useSessions ? props.useSessions(snapshot => snapshot) : undefined

  const petDesktop = settings.petDesktop === true
  const inShell = props.shell === true
  const [desktopActive, setDesktopActive] = useState(false)
  const [desktopReady, setDesktopReady] = useState(false)
  const [desktopDownloading, setDesktopDownloading] = useState(false)
  const [desktopError, setDesktopError] = useState<string | null>(null)
  const [modeMenu, setModeMenu] = useState(false)
  const lastAckRef = useRef<number | null>(null)
  const prevDesktopRef = useRef<boolean | null>(null)
  const modeHoldRef = useRef<number | undefined>(undefined)
  const modeHoldFired = useRef(false)
  const jsonlById = useRef<Map<string, number>>(new Map())

  // While desktop mode is armed, poll the host /status every 1s. If an active
  // desktop window exists, hide the browser pet; also consume any pendingOpen
  // the desktop shell records (open the session + ack so it isn't replayed).
  // Dedup ack'd `at` so an in-flight poll can't double-fire sessions.open.
  useEffect(() => {
    if (inShell || !petDesktop) {
      setDesktopActive(false)
      setDesktopReady(false)
      setDesktopDownloading(false)
      if (!petDesktop) setDesktopError(null)
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
          ready?: boolean
          pendingOpen?: { id?: string; at?: number } | null
          download?: { stage?: string; pct?: number | null; error?: string }
        }
        setDesktopActive(data.active === true)
        setDesktopReady(data.ready === true)
        setDesktopDownloading(data.download?.stage === 'downloading')
        setDesktopError(data.download?.stage === 'failed' ? (data.download.error ?? 'download failed') : null)
        const pending = data.pendingOpen
        const pendingId = pending?.id
        const pendingAt = pending?.at
        if (
          typeof pendingId === 'string' &&
          typeof pendingAt === 'number' &&
          pendingAt !== lastAckRef.current
        ) {
          lastAckRef.current = pendingAt
          void (async () => {
            try {
              if (!jsonlById.current.has(pendingId)) {
                const rows = await listSessions()
                jsonlById.current = new Map(rows.map(row => [row.sessionId, row.jsonlBytes ?? 0]))
              }
              const size = jsonlById.current.get(pendingId)
              if (jsonlTooLarge(size)) return
              void props.sessions?.open?.(pendingId)
            } catch {
              /* desktop open is best-effort */
            }
          })()
          void fetch(`${PET_DESKTOP_PREFIX}/ack-open`, {
            method: 'POST',
            headers: CSRF_HEADERS,
            body: JSON.stringify({ at: pendingAt }),
          })
        }
      } catch {
        /* keep last known state */
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 5000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [inShell, petDesktop, props.sessions])

  // Reconcile the desktop shell with the petDesktop setting. On mount a
  // persisted petDesktop=true re-arms the shell (restart case); afterwards a
  // settings change spawns (false→true) or closes (true→false) the shell.
  // The Electron overlay must never POST /spawn — that stacked extra windows.
  useEffect(() => {
    if (inShell) return
    const prev = prevDesktopRef.current
    prevDesktopRef.current = petDesktop
    if (prev !== null && prev === petDesktop) return
    let cancelled = false
    let dropBootWait = (): void => {}
    if (petDesktop) {
      dropBootWait = whenWebBootIdle(() => {
        if (cancelled) return
        void (async () => {
          try {
            const res = await fetch(`${PET_DESKTOP_PREFIX}/spawn`, {
              method: 'POST',
              headers: CSRF_HEADERS,
              body: JSON.stringify(spawnOrigin()),
            })
            if (!res.ok && !cancelled) setDesktopError(`spawn ${res.status}`)
          } catch {
            /* keep last known state; /status poll surfaces download failures */
          }
        })()
      })
    } else if (prev !== null) {
      // true→false: close the shell. Skip on mount (prev null + petDesktop
      // false means nothing is running to close).
      void fetch(`${PET_DESKTOP_PREFIX}/close`, { method: 'POST', headers: CSRF_HEADERS, body: JSON.stringify({ petDesktop: false }) })
    }
    return () => {
      cancelled = true
      dropBootWait()
    }
  }, [inShell, petDesktop])

  useEffect(() => {
    if (props.useSessions) return
    try {
      const list = props.sessions?.list
      const pull = (): void => {
        const next = readListStore(list)
        setFallbackList(prev => {
          try {
            if (foldedPetSignature(foldPetList(prev)) === foldedPetSignature(foldPetList(next))) return prev
          } catch {
            /* fall through and accept next */
          }
          return next
        })
      }
      pull()
      return subscribeListStore(list, pull)
    } catch {
      setHidden(true)
      return undefined
    }
  }, [props.sessions, props.useSessions])

  const snapshot = hookedList ?? fallbackList
  const folded = useMemo(() => {
    try {
      return foldPetList(snapshot)
    } catch {
      return []
    }
  }, [snapshot])

  const [apSnapshot, setApSnapshot] = useState<AnswerPetSnapshot | null>(null)
  const [cardsOpen, setCardsOpen] = useState(false)
  useEffect(() => {
    if (inShell) return undefined
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
    const events = new EventSource('/session-desk/api/answer-pet/events')
    events.onmessage = (event) => {
      if (!active) return
      try {
        const body = JSON.parse(event.data) as { ok?: boolean; data?: AnswerPetSnapshot }
        if (body.data) setApSnapshot(body.data)
      } catch {
        /* keep last */
      }
    }
    return () => {
      active = false
      events.close()
    }
  }, [inShell])
  const liveFromSnap = (snapshot as SessionsSnapshot | undefined)?.answerPet
  const apCards = (inShell ? liveFromSnap : apSnapshot)?.running ?? []
  const liveAwaiting = useMemo(() => awaitingFromLiveCards(apCards), [apCards])
  const entries = useStableFoldedRows(useMemo(
    () => mergeLiveAwaiting(folded, liveAwaiting),
    [folded, liveAwaiting],
  ))
  const kind = petKindFromLive({
    folded: entries.map(row => row.kind),
    liveRunning: apCards.length,
    liveAwaiting: liveAwaiting.length,
  })

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

  const [celebrating, setCelebrating] = useState(false)
  const [completedList, setCompletedList] = useState<readonly FoldedPetRow[]>([])
  const prevEntriesRef = useRef<readonly FoldedPetRow[]>([])
  const prevLiveIdsRef = useRef<readonly string[]>([])
  const timerRef = useRef<number | undefined>(undefined)
  const liveCardIds = apCards.map(card => card.id)
  const liveTitles = Object.fromEntries(apCards.map(card => [card.id, card.title || card.id]))

  // Celebrate each session as it finishes (busy → idle). New completions append to
  // the broadcast and extend the timer; the banner clears after 8s of quiet.
  useEffect(() => {
    const prevEntries = prevEntriesRef.current
    const fromList = completedRows(prevEntries, entries)
    const fromLive = completedFromLive(prevLiveIdsRef.current, liveCardIds, liveTitles)
    prevEntriesRef.current = entries
    prevLiveIdsRef.current = liveCardIds
    const justCompleted = [...fromList, ...fromLive.filter(row => !fromList.some(item => item.id === row.id))]

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
  }, [entries, liveCardIds.join('\0')])

  // Clear the celebration timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    }
  }, [])
  const [viewSize, setViewSize] = useState(readViewport)
  const theme = useMemo(
    () => selectTheme(settings.petTheme, resolvePetImage(settings.petImage), dshpetTheme, AP_THEME_IDS),
    [settings.petTheme, settings.petImage],
  )
  const size = fitPetSize(clampPetSize(settings.petSize), theme.aspect, viewSize.w, viewSize.h)
  const petHeight = Math.round(size / theme.aspect)
  const [idleTick, setIdleTick] = useState(0)
  const [idleBroadcast, setIdleBroadcast] = useState(false)
  useEffect(() => {
    if (kind !== 'idle') {
      setIdleBroadcast(false)
      return
    }
    let wait = 0
    let hold = 0
    const schedule = (): void => {
      wait = window.setTimeout(() => {
        setIdleTick(t => t + 1)
        setIdleBroadcast(true)
        hold = window.setTimeout(() => {
          setIdleBroadcast(false)
          schedule()
        }, IDLE_BROADCAST_HOLD_MS)
      }, nextIdleBroadcastDelay())
    }
    schedule()
    return () => {
      window.clearTimeout(wait)
      window.clearTimeout(hold)
    }
  }, [kind])
  const sprite = useMemo(() => resolveSprite(theme, kind), [theme, kind, idleTick])
  // Main sessions that are working (streaming) or orchestrating subagents.
  const runningRows = entries.filter(e => e.kind === 'running' || e.kind === 'subagent')
  const awaitingRows = entries.filter(e => e.kind === 'awaiting')
  const liveProgress = useMemo(() => progressBySession(apCards), [apCards])
  const subagentDetail = useStableFoldedRows(useMemo(() => subagentDetailRows(snapshot), [snapshot]))
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
  useEffect(() => {
    if (!inShell) return
    ;(window as unknown as { petDesktop?: { setPaintActive?(active: boolean): void } }).petDesktop?.setPaintActive?.(true)
  }, [inShell])

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
      if (modeHoldRef.current !== undefined) window.clearTimeout(modeHoldRef.current)
      if (dragRaf.current !== 0) window.cancelAnimationFrame(dragRaf.current)
    }
  }, [])
  const isAp = AP_THEME_IDS.includes(theme.id)
  const apThemeId = displaySprite.type === 'ap' ? displaySprite.themeId : null

  const viewport = (): { w: number; h: number } => viewSize

  const rest = (): { x: number; y: number } => {
    const { w, h } = viewport()
    // Compact desktop window: ignore GUI petX/petY (those are screen-sized) and
    // center the sprite so the bubble above + mode menu below stay in-bounds.
    if (inShell) {
      return desktopPetRest(w, h, size, petHeight)
    }
    if (settings.petX === -1 || settings.petY === -1) return defaultPetPosition(w, h, size, petHeight)
    return clampPetPosition(settings.petX, settings.petY, size, petHeight, w, h)
  }

  const pos = dragPos ?? rest()
  livePos.current = pos

  // Keep the bubble on-screen and always ABOVE the pet (never flip it below).
  const calloutStyle = calloutLiveStyle({
    petX: pos.x,
    petY: pos.y,
    petWidth: size,
    viewportWidth: viewport().w,
    viewportHeight: viewport().h,
    inShell,
  })

  useEffect(() => {
    if (settings.petX === -1 || settings.petY === -1) setDragPos(null)
  }, [settings.petX, settings.petY])

  useEffect(() => {
    const onResize = (): void => {
      setViewSize(readViewport())
      if (dragging.current) return
      setDragPos(null)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const spawnOrigin = (): { x: number; y: number } => {
    const sprite = livePos.current
    const restPos = desktopPetRest(420, 640, size, petHeight)
    return desktopWindowOriginFromBrowserPet({
      screenX: window.screenX,
      screenY: window.screenY,
      petX: sprite.x,
      petY: sprite.y,
      restX: restPos.x,
      restY: restPos.y,
    })
  }

  const persistPosition = useCallback((x: number, y: number) => {
    const { w, h } = viewport()
    const next = clampPetPosition(x, y, size, petHeight, w, h)
    void props.update?.({ petX: next.x, petY: next.y })
  }, [props.update, size, petHeight])

  const setIgnoreMouse = (ignore: boolean): void => {
    if (!inShell) return
    if (!ignoreMouseChanged(ignoreMouseRef.current, ignore)) return
    ignoreMouseRef.current = ignore
    ;(window as unknown as { petDesktop?: { setIgnoreMouse(ignore: boolean): void } }).petDesktop?.setIgnoreMouse(ignore)
  }

  const bubbleOpen = modeMenu || celebrating || kind !== 'idle' || apCards.length > 0 || idleBroadcast
  const syncDesktopIgnore = (overHit = false, menuOpen = modeMenu): void => {
    setIgnoreMouse(desktopShouldIgnoreMouse({
      dragging: dragging.current,
      menuOpen,
      overHit,
    }))
  }

  useEffect(() => {
    syncDesktopIgnore()
  }, [inShell, modeMenu, bubbleOpen])

  useEffect(() => {
    if (!modeMenu) return undefined
    const onDismiss = (event: PointerEvent): void => {
      const node = event.target
      if (!(node instanceof Element)) {
        setModeMenu(false)
        return
      }
      if (node.closest('.dsd-pet__mode-menu') || node.closest('.dsd-pet__hit')) return
      setModeMenu(false)
    }
    window.addEventListener('pointerdown', onDismiss, true)
    return () => window.removeEventListener('pointerdown', onDismiss, true)
  }, [modeMenu])

  useEffect(() => {
    if (!inShell) return undefined
    const onMove = (event: PointerEvent): void => {
      if (dragging.current) return
      const node = document.elementFromPoint(event.clientX, event.clientY)
      syncDesktopIgnore(desktopPointerOverChrome(node))
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [inShell, modeMenu, bubbleOpen])

  const clearModeHold = (): void => {
    if (modeHoldRef.current !== undefined) {
      window.clearTimeout(modeHoldRef.current)
      modeHoldRef.current = undefined
    }
  }

  const paintLivePos = (next: { x: number; y: number }): void => {
    livePos.current = next
    const pet = petRef.current
    if (pet !== null) {
      pet.style.left = `${next.x}px`
      pet.style.top = `${next.y}px`
    }
    const callout = calloutRef.current
    if (callout !== null) {
      const { w, h } = viewport()
      const style = calloutLiveStyle({
        petX: next.x,
        petY: next.y,
        petWidth: size,
        viewportWidth: w,
        viewportHeight: h,
        inShell,
      })
      callout.style.left = style.left
      callout.style.top = style.top
      callout.style.bottom = style.bottom
      callout.style.maxHeight = style.maxHeight
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    event.preventDefault()
    dragging.current = true
    petRef.current?.setAttribute('data-dragging', '')
    moved.current = false
    modeHoldFired.current = false
    const start = rest()
    origin.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: start.x,
      y: start.y,
      screenX: window.screenX,
      screenY: window.screenY,
      pointerScreenX: event.screenX,
      pointerScreenY: event.screenY,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setIgnoreMouse(false)
    const onWinMove = (move: PointerEvent): void => {
      onPointerMove(move)
    }
    const onWinUp = (): void => {
      window.removeEventListener('pointermove', onWinMove)
      window.removeEventListener('pointerup', onWinUp)
      window.removeEventListener('pointercancel', onWinUp)
      onPointerUp()
    }
    window.addEventListener('pointermove', onWinMove)
    window.addEventListener('pointerup', onWinUp)
    window.addEventListener('pointercancel', onWinUp)
    clearModeHold()
    modeHoldRef.current = window.setTimeout(() => {
      modeHoldFired.current = true
      setModeMenu(true)
      setIgnoreMouse(false)
    }, MODE_HOLD_MS)
  }

  const onPointerMove = (event: { clientX: number; clientY: number; screenX?: number; screenY?: number }): void => {
    if (!dragging.current) return
    const dx = inShell
      ? (event.screenX ?? event.clientX) - origin.current.pointerScreenX
      : event.clientX - origin.current.pointerX
    const dy = inShell
      ? (event.screenY ?? event.clientY) - origin.current.pointerScreenY
      : event.clientY - origin.current.pointerY
    if (pointerHasMoved(dx, dy)) {
      moved.current = true
      clearModeHold()
    }
    if (!moved.current) return
    if (inShell) {
      if (!nativeDrag.current) {
        nativeDrag.current = true
        const offset = desktopDragOffset(
          origin.current.screenX,
          origin.current.screenY,
          origin.current.pointerScreenX,
          origin.current.pointerScreenY,
        )
        ;(window as unknown as { petDesktop?: { startDrag(x: number, y: number): void } }).petDesktop?.startDrag(offset.x, offset.y)
      }
      return
    }
    const { w, h } = viewport()
    const next = clampPetPosition(origin.current.x + dx, origin.current.y + dy, size, petHeight, w, h)
    if (dragRaf.current !== 0) return
    dragRaf.current = window.requestAnimationFrame(() => {
      dragRaf.current = 0
      paintLivePos(next)
    })
  }

  const onPointerUp = (): void => {
    if (!dragging.current) return
    dragging.current = false
    petRef.current?.removeAttribute('data-dragging')
    if (nativeDrag.current) {
      nativeDrag.current = false
      ;(window as unknown as { petDesktop?: { stopDrag(): void } }).petDesktop?.stopDrag()
    }
    clearModeHold()
    if (dragRaf.current !== 0) {
      window.cancelAnimationFrame(dragRaf.current)
      dragRaf.current = 0
    }
    const next = livePos.current
    const kind = classifyPointerEnd({ moved: moved.current, holdMenuFired: modeHoldFired.current })
    if (kind === 'drag') {
      if (!inShell) persistPosition(next.x, next.y)
      setDragPos(next)
      return
    }
    if (kind === 'click') {
      if (modeMenu) {
        setModeMenu(false)
        setDragPos(null)
        syncDesktopIgnore(false, false)
        return
      }
      if (displaySprite.type === 'ap') triggerApBlink()
      const picked = pickReaction(theme)
      if (picked !== null && picked.type === 'video') setReaction(picked)
      setDragPos(null)
      syncDesktopIgnore(false, false)
      return
    }
    setDragPos(null)
    syncDesktopIgnore(kind === 'hold-menu', kind === 'hold-menu' || modeMenu)
  }

  const openSession = (id: string): void => {
    void (async () => {
      try {
        if (!jsonlById.current.has(id)) {
          const rows = await listSessions()
          jsonlById.current = new Map(rows.map(row => [row.sessionId, row.jsonlBytes ?? 0]))
        }
        const size = jsonlById.current.get(id)
        if (jsonlTooLarge(size)) {
          window.alert(props.t?.('sessions.tooLarge', { n: formatJsonlBytes(size ?? 0) }) ?? 'session too large')
          return
        }
        void props.sessions?.open?.(id)
      } catch {
        setHidden(true)
      }
    })()
  }

  if (hidden) return null
  if (typeof document === 'undefined') return null
  // Hide the in-page pet only after the desktop shell heartbeats /ready —
  // process-alive is not enough (transparent window + no Dock icon looks gone).
  if (!inShell && hideBrowserPet({ petDesktop, desktopReady, kind })) return null

  return createPortal(
    <div ref={layerRef} className="dsd-pet-layer" data-shell={inShell ? 'true' : undefined} aria-hidden={false}>
      <button
        ref={petRef}
        type="button"
        className="dsd-pet"
        data-kind={kind}
        data-ap-theme={apThemeId ?? undefined}
        data-ap-phase={apThemeId !== null ? apPhaseOf(kind) : undefined}
        data-ap-click-blink={isAp && apBlink ? 'true' : undefined}
        aria-label={`${props.t?.('pet.title') ?? 'pet'} · ${kindLabel(kind, props.t)}`}
        draggable={false}
        onDragStart={event => event.preventDefault()}
        style={{ left: pos.x, top: pos.y, width: size, height: petHeight }}
      >
        <span
          className="dsd-pet__hit"
          aria-hidden="true"
          draggable={false}
          onDragStart={event => event.preventDefault()}
          onPointerEnter={() => { syncDesktopIgnore(true) }}
          onPointerLeave={() => { syncDesktopIgnore(false) }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove as never}
          onPointerUp={onPointerUp as never}
          onPointerCancel={onPointerUp as never}
        />
        {/* One sprite slot: the status sprite, or a reaction overlaid through the
            same double-buffer (so a click never shows a blank decode frame). */}
        <span className="dsd-pet__art">
          {displaySprite.type === 'image'
            ? <img src={displaySprite.src} alt="" draggable={false} />
            : displaySprite.type === 'video'
              ? <PetVideo
                  src={displaySprite.src}
                  loop={petVideoShouldLoop({ kind, isReaction })}
                  play={petVideoShouldPlay({ kind, isReaction })}
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
      {petDesktop && desktopError !== null && !desktopActive && (
        <div className="dsd-pet__preparing" data-kind="error">
          {props.t?.('pet.desktop.failed') ?? '桌面依赖准备失败'}
        </div>
      )}
      {bubbleOpen && <div
        ref={calloutRef}
        className="dsd-pet__callout"
        data-kind={kind}
        data-cards={apCards.length > 0 ? 'true' : undefined}
        data-anchor="above"
        data-celebrating={celebrating ? 'true' : undefined}
        style={calloutStyle}
        onPointerEnter={() => { syncDesktopIgnore(true) }}
        onPointerLeave={() => { syncDesktopIgnore(false) }}
      >
        {celebrating && kind !== 'error' && (
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
        )}
        {kind === 'idle' && !celebrating ? (
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
            {(runningRows.length > 0 || apCards.length > 0) && (
              <>
                <span className="dsd-pet__callout__head">{bubbleText('running', Math.max(runningRows.length, apCards.length), props.t)}</span>
                {(runningRows.length > 0
                  ? bubbleRows('running', entries, subagentDetail, props.t, liveProgress)
                  : apCards.map(card => ({
                    id: card.id,
                    text: runningRowLabel(card.title || card.id, '', card.view?.progress),
                  }))
                ).map(row => (
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
          {(() => {
            const shown = cardsOpen ? apCards : []
            return (
            <>
              <button
                type="button"
                className="dsd-pet__callout__toggle"
                onPointerDown={event => event.stopPropagation()}
                onClick={event => {
                  event.stopPropagation()
                  event.preventDefault()
                  setCardsOpen(open => !open)
                }}
              >
                <span className="dsd-pet__callout__chevron">{cardsOpen ? '▾' : '▸'}</span>
                {cardsOpen
                  ? (props.t?.('pet.cards.hide') ?? '收起进度')
                  : (props.t?.('pet.cards.show') ?? `会话进度 (${apCards.length})`)}
              </button>
              {shown.map(card => (
                <div key={card.id} className="dsd-pet__card" data-phase={card.view.phase}>
                  <div className="dsd-pet__card__head">
                    <span className="dsd-pet__card__title">{card.title || card.id}</span>
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
            )
          })()}
        </div>
      )}
      </div>}
      {modeMenu && (
        <div
          className="dsd-pet__mode-menu"
          style={{ left: pos.x + size / 2, top: pos.y + petHeight - 4, transform: 'translate(-50%, 0)' }}
          onPointerEnter={() => { syncDesktopIgnore(true) }}
          onPointerLeave={() => { syncDesktopIgnore(false) }}
        >
          <span className="dsd-pet__mode-menu__title">{props.t?.('pet.mode') ?? '运行位置'}</span>
          <button
            type="button"
            className="dsd-pet__mode-menu__item"
            data-selected={!petDesktop ? 'true' : undefined}
            onClick={() => {
              setDesktopError(null)
              setModeMenu(false)
              setDesktopActive(false)
              setDesktopReady(false)
              void (async () => {
                await props.update?.({ petDesktop: false })
                await fetch(`${PET_DESKTOP_PREFIX}/close`, { method: 'POST', headers: CSRF_HEADERS, body: JSON.stringify({ petDesktop: false }) })
              })()
            }}
          >
            {props.t?.('pet.mode.browser') ?? '浏览器'}
          </button>
          <button
            type="button"
            className="dsd-pet__mode-menu__item"
            data-selected={petDesktop ? 'true' : undefined}
            onClick={() => {
              setDesktopError(null)
              setModeMenu(false)
              void props.update?.({ petDesktop: true })
              if (!inShell) {
                void fetch(`${PET_DESKTOP_PREFIX}/spawn`, {
                  method: 'POST',
                  headers: CSRF_HEADERS,
                  body: JSON.stringify(spawnOrigin()),
                })
              }
            }}
          >
            {props.t?.('pet.mode.desktop') ?? '桌面'}
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}
