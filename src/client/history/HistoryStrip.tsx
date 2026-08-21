/**
 * Two-state conversation minimap: idle dashes in a 28px capsule, hover expands
 * inward into truncated question rows. Click jumps; hover never scrolls.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DEFAULT_SETTINGS,
  type SessionDeskSettings,
} from '../../shared.ts'
import { buildTurns, currentTurnKey, jumpToTurn, mergeVisibleTurns, MAX_STRIP_TURNS, toHistorySnapshot } from '../../history/turns.ts'
import {
  canTakeLoadOlderBatch,
  conversationEdgeStyle,
  historyPositionOf,
  LOAD_OLDER_THROTTLE_MS,
  pagerIdentity,
  resetBatchesIfIdentityChanged,
  type ConversationBox,
} from '../../history/minimap-control.ts'
import { adoptHistoryStyles } from './history-styles.ts'

export interface HistoryStripInjected {
  loadOlder: () => void
  sessionId: string
  hooks: {
    scope: unknown
  }
}

interface SessionSlice {
  chat?: unknown
  blank?: boolean
  openState?: string
  hasMore?: boolean
  loadingOlder?: boolean
}

interface SettingsSnapshot {
  value?: SessionDeskSettings
}

export interface HistoryStripProps {
  useSession?: <T>(select: (snapshot: SessionSlice) => T) => T
  loadOlder?: () => void
  sessionId?: string
  useScope?: <T>(select: (snapshot: SettingsSnapshot) => T) => T
  t?: (key: string, vars?: Record<string, string | number>) => string
}

/** AppFrame center column: `#root > [data-slot=root] > frame > nth-child(2)`. */
function conversationColumn(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector('#root > [data-slot="root"] > div > div:nth-child(2)')
}

function readConversationBox(): ConversationBox | null {
  const col = conversationColumn()
  if (col === null) return null
  const rect = col.getBoundingClientRect()
  if (rect.width <= 1) return null
  return { left: rect.left, right: rect.right }
}

export function HistoryStrip(props: HistoryStripProps): ReactNode {
  adoptHistoryStyles()
  const useSession = props.useSession
  const chat = useSession ? useSession(s => s.chat) : undefined
  const blank = useSession ? useSession(s => s.blank) : false
  const openState = useSession ? useSession(s => s.openState) : 'open'
  const hasMore = useSession ? Boolean(useSession(s => s.hasMore)) : false
  const loadingOlder = useSession ? Boolean(useSession(s => s.loadingOlder)) : false
  const settings = props.useScope
    ? props.useScope(snapshot => snapshot.value)
    : undefined
  const historyLimit = settings?.historyLimit ?? DEFAULT_SETTINGS.historyLimit
  const position = historyPositionOf(settings?.historyPosition)
  const sessionId = props.sessionId ?? ''
  const pinnedNumbers = useMemo(() => {
    const set = new Set<number>()
    for (const turn of settings?.pinnedTurns?.[sessionId] ?? []) set.add(turn)
    return set
  }, [settings?.pinnedTurns, sessionId])

  const allTurns = useMemo(() => {
    if (blank || position === 'off') return []
    return buildTurns(toHistorySnapshot(chat))
  }, [chat, blank, position])

  const turns = useMemo(
    () => mergeVisibleTurns(allTurns, historyLimit, pinnedNumbers),
    [allTurns, historyLimit, pinnedNumbers],
  )

  const [open, setOpen] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [box, setBox] = useState<ConversationBox | null>(null)
  const loadOlderRef = useRef(props.loadOlder)
  loadOlderRef.current = props.loadOlder
  const pagerRef = useRef({ identity: '', loaded: 0 })
  pagerRef.current = resetBatchesIfIdentityChanged(
    pagerRef.current,
    pagerIdentity(sessionId, position, historyLimit),
  )

  const target = historyLimit > 0 ? Math.min(historyLimit, MAX_STRIP_TURNS) : MAX_STRIP_TURNS
  const unpinnedCount = useMemo(
    () => allTurns.filter(turn => turn.turn === undefined || !pinnedNumbers.has(turn.turn)).length,
    [allTurns, pinnedNumbers],
  )
  const pinnedMissing = useMemo(() => {
    if (pinnedNumbers.size === 0) return false
    const loaded = new Set<number>()
    for (const turn of allTurns) if (turn.turn !== undefined) loaded.add(turn.turn)
    for (const turn of pinnedNumbers) if (!loaded.has(turn)) return true
    return false
  }, [allTurns, pinnedNumbers])
  const pagerDone = unpinnedCount >= target && !pinnedMissing

  useEffect(() => {
    if (position === 'off') return
    if (openState !== undefined && openState !== 'open') return
    if (!hasMore || loadingOlder) return
    if (pagerDone) return
    if (!canTakeLoadOlderBatch(pagerRef.current.loaded)) return
    const timer = setTimeout(() => {
      pagerRef.current = { ...pagerRef.current, loaded: pagerRef.current.loaded + 1 }
      loadOlderRef.current?.()
    }, LOAD_OLDER_THROTTLE_MS)
    return () => clearTimeout(timer)
  }, [position, openState, hasMore, loadingOlder, pagerDone, sessionId, historyLimit])

  useEffect(() => {
    if (position === 'off' || turns.length === 0) return
    let raf = 0
    const keys = turns.map(turn => turn.key)
    const compute = () => {
      raf = 0
      setActiveKey(currentTurnKey(keys))
    }
    const onScroll = () => {
      if (raf === 0) raf = requestAnimationFrame(compute)
    }
    compute()
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [turns, position])

  useLayoutEffect(() => {
    if (blank || position === 'off' || turns.length === 0) return
    const col = conversationColumn()
    if (col === null) return
    const measure = (): void => {
      const next = readConversationBox()
      if (next === null) return
      setBox(previous =>
        previous !== null
        && Math.abs(previous.left - next.left) <= 1
        && Math.abs(previous.right - next.right) <= 1
          ? previous
          : next,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(col)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [blank, position, turns.length])

  if (blank || turns.length === 0 || position === 'off') return null
  if (typeof document === 'undefined') return null

  const side = position === 'left' ? 'left' : 'right'
  const t = props.t
  const edge = box === null
    ? undefined
    : conversationEdgeStyle(side, box, window.innerWidth)
  return createPortal(
    <div
      className={`dsd-minimap dsd-minimap--${side}${open ? ' dsd-minimap--open' : ''}`}
      style={edge}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div className="dsd-minimap__capsule" role="navigation" aria-label={t?.('history.title') ?? 'history'}>
        {turns.map((turn) => {
          const isCurrent = activeKey === turn.key
          const isPinned = turn.turn !== undefined && pinnedNumbers.has(turn.turn)
          const question = turn.question || t?.('history.noText') || ''
          return (
            <button
              key={turn.key}
              type="button"
              className={[
                'dsd-minimap__row',
                isCurrent ? 'dsd-minimap__row--current' : '',
                isPinned ? 'dsd-minimap__row--pinned' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => jumpToTurn(turn.key)}
              aria-label={t?.('history.jump') ?? question}
              title={open ? question : undefined}
            >
              {open && side === 'right' ? <span className="dsd-minimap__q">{question}</span> : null}
              <span className="dsd-minimap__dash" aria-hidden="true" />
              {open && side === 'left' ? <span className="dsd-minimap__q">{question}</span> : null}
            </button>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}
