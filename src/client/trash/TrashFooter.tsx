/**
 * Sidebar-footer 废纸篓 entry + flying drop target. The footer action opens the
 * restore/purge panel; while a session drag is active the trash itself grows
 * and flies from the footer to the center drop spot. Dropping crumples the
 * session into a paper ball and throws it in (no confirm — trash is
 * restorable); dropping elsewhere just sends the trash back to the footer.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { listTrash, purge, restore, trash as apiTrash, type TrashRow } from '../api.ts'
import { collectDescendants, type CascadeInput, type CascadeRow } from '../../trash/cascade.ts'
import { adoptTrashStyles } from './trash-styles.ts'
import { isSessionDrag, registerSessionDragWatchers } from './drag-detect.ts'
import { trashGlassLevel, type TrashGlassLevel } from './glass.ts'

interface SessionsRow {
  id?: string
  parentId?: string
  origin?: string
  displayTitle?: string
}

interface SessionsSnapshot {
  byId?: Record<string, SessionsRow | undefined>
  subagentsByParent?: CascadeInput['subagentsByParent']
}

interface SettingsSnapshot {
  value?: { retentionDays?: number; trashGlass?: string }
}

export interface TrashFooterProps {
  wide: boolean
  t?: (key: string, vars?: Record<string, string | number>) => string
  useSessions?: <T>(select: (snapshot: SessionsSnapshot) => T) => T
  useScope?: <T>(select: (snapshot: SettingsSnapshot) => T) => T
  sessions?: {
    list?: unknown
    refresh?: () => Promise<void>
    refreshSubagents?: (parentSessionId: string) => Promise<void>
    setSubagentCatalogOpen?: (parentSessionId: string, open: boolean) => void
  }
}

const DEFAULT_RETENTION_DAYS = 30

/** Drop-spot anchor: center-lower of the viewport (image-2 area). */
const TARGET_X = 0.46
const TARGET_Y = 0.685

interface PaperBall {
  x: number
  y: number
  dx: number
  dy: number
}

type TargetPhase = 'idle' | 'flyin' | 'back' | 'swallow'

function readListStore(list: unknown): SessionsSnapshot | undefined {
  if (list === undefined || list === null) return undefined
  try {
    if (typeof list === 'function') return list() as SessionsSnapshot
    if (typeof list === 'object' && 'getSnapshot' in list) {
      return (list as { getSnapshot: () => unknown }).getSnapshot() as SessionsSnapshot
    }
  } catch {
    return undefined
  }
  return undefined
}

export function TrashFooter(props: TrashFooterProps): ReactNode {
  adoptTrashStyles()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<TrashRow[]>([])
  const [notice, setNotice] = useState('')
  const [phase, setPhase] = useState<TargetPhase>('idle')
  const [fly, setFly] = useState({ fx: 0, fy: 0 })
  const [active, setActive] = useState(false)
  const [paper, setPaper] = useState<PaperBall | null>(null)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const thrownRef = useRef(false)
  const snap = props.useSessions ? props.useSessions(s => s) : undefined
  const retention = props.useScope ? props.useScope(s => s.value?.retentionDays) : undefined
  const retentionDays = typeof retention === 'number' && retention > 0 ? retention : DEFAULT_RETENTION_DAYS
  const trashGlass = props.useScope ? props.useScope(s => s.value?.trashGlass) : undefined
  const glassLevel: TrashGlassLevel = trashGlassLevel(trashGlass as 'off' | 'light' | 'frosted' | 'mica' | undefined)
  const t = props.t ?? ((key: string) => key)

  const refresh = async (): Promise<void> => {
    try {
      setRows(await listTrash())
    } catch {
      setRows([])
    }
  }

  const refreshSessions = async (): Promise<void> => {
    try {
      await props.sessions?.refresh?.()
    } catch {
      /* best-effort */
    }
  }

  const refreshAll = async (): Promise<void> => {
    await refresh()
    await refreshSessions()
  }

  useEffect(() => { void refresh() }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const pop = popRef.current
      const anchor = anchorRef.current
      const target = event.target
      if (!(target instanceof Node)) return
      if (pop !== null && pop.contains(target)) return
      if (anchor !== null && anchor.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onBlur = (): void => {
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  const targetCenter = (): { x: number; y: number } => ({
    x: typeof window === 'undefined' ? 0 : window.innerWidth * TARGET_X,
    y: typeof window === 'undefined' ? 0 : window.innerHeight * TARGET_Y,
  })

  useEffect(() => {
    const onDragStart = (event: DragEvent): void => {
      if (!isSessionDrag(event.dataTransfer)) return
      const rect = anchorRef.current?.getBoundingClientRect()
      const tc = targetCenter()
      const fx = rect ? rect.left + rect.width / 2 - tc.x : -tc.x
      const fy = rect ? rect.top + rect.height / 2 - tc.y : -tc.y
      setFly({ fx, fy })
      setActive(false)
      setPhase('flyin')
    }
    const onDragEnd = (): void => {
      // A real drop on the trash handles cleanup itself; anything else sends
      // the trash back to the footer (sorting / cancel / drop elsewhere).
      if (thrownRef.current) return
      setActive(false)
      setPhase(p => (p === 'idle' ? p : 'back'))
      window.setTimeout(() => {
        setPhase(p => (p === 'back' ? 'idle' : p))
      }, 300)
    }
    // dragstart must be observed in the BUBBLE phase: the host's row
    // onDragStart populates the DataTransfer (effectAllowed='move' + a
    // text/plain session-id payload) before the event reaches document, so a
    // document-capture listener would see an empty DataTransfer and never
    // recognize the drag (see drag-detect.ts for the empirical proof).
    return registerSessionDragWatchers({ onDragStart, onDragEnd })
  }, [])

  const daysLeft = (deletedAt: number): number =>
    Math.max(0, Math.ceil((deletedAt + retentionDays * 86_400_000 - Date.now()) / 86_400_000))

  const resolveSnapshot = (): SessionsSnapshot => readListStore(props.sessions?.list) ?? snap ?? {}

  /** Crumple-and-throw: trash the session + its subagents directly (no confirm). */
  const throwIntoTrash = async (id: string): Promise<void> => {
    try {
      const current = resolveSnapshot()
      const rawById = current.byId ?? {}
      const byId: Record<string, CascadeRow> = {}
      for (const [key, row] of Object.entries(rawById)) {
        if (row === undefined) continue
        byId[key] = { id: row.id ?? key, parentId: row.parentId, origin: row.origin }
      }
      const descendants = collectDescendants(id, { byId, subagentsByParent: current.subagentsByParent })
      const ids = [id, ...descendants]
      const title = rawById[id]?.displayTitle ?? id
      await apiTrash({ sessionId: id, sessionIds: ids, title })
      await refreshAll()
      setNotice('')
    } catch (error) {
      setNotice(t('action.failed', { error: error instanceof Error ? error.message : String(error) }))
    }
  }

  const popStyle = useMemo(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
    const vh = typeof window === 'undefined' ? 720 : window.innerHeight
    return {
      left: rect ? Math.max(8, Math.min(rect.left, vw - 320)) : 8,
      bottom: rect ? Math.max(8, vh - rect.top) : 8,
    }
  }, [open, props.wide])

  const label = t('tab.trash')
  const tc = targetCenter()
  const targetStyle = {
    '--tx': `${tc.x}px`,
    '--ty': `${tc.y}px`,
    '--fx': `${fly.fx}px`,
    '--fy': `${fly.fy}px`,
    '--dsd-trash-blur': `${glassLevel.blur}px`,
    '--dsd-trash-alpha-c': String(glassLevel.alphaC),
    '--dsd-trash-alpha-e': String(glassLevel.alphaE),
    '--dsd-trash-saturate': String(glassLevel.saturate),
  } as CSSProperties

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="dsd-trash-foot"
        onClick={() => { setOpen(v => !v); void refresh() }}
        title={label}
      >
        <span className="dsd-trash-foot__icon" aria-hidden="true">🗑</span>
        {props.wide && <span className="dsd-trash-foot__label">{label}</span>}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div ref={popRef} className="dsd-trash-pop" role="dialog" style={popStyle}>
          {rows.length === 0 ? (
            <div className="dsd-trash-pop__empty">{t('trash.empty')}</div>
          ) : (
            <>
              {rows.map(row => (
                <div key={row.trashId} className="dsd-trash-pop__row">
                  <div className="dsd-trash-pop__meta">
                    <div className="dsd-trash-pop__title">{row.title}</div>
                    <div className="dsd-trash-pop__sub">
                      {row.memberCount ? `${t('trash.members', { n: row.memberCount })} · ` : ''}
                      {t('trash.daysLeft', { n: daysLeft(row.deletedAt) })}
                    </div>
                  </div>
                  <button type="button" onClick={() => { void restore(row.trashId).then(() => refreshAll()) }}>{t('trash.restore')}</button>
                  <button type="button" onClick={() => { if (window.confirm(t('trash.confirmPurge'))) void purge({ trashId: row.trashId }).then(refresh) }}>{t('trash.purge')}</button>
                </div>
              ))}
              <button type="button" className="dsd-trash-pop__all" onClick={() => { if (window.confirm(t('trash.confirmPurgeAll'))) void purge({ all: true }).then(refresh) }}>{t('trash.purgeAll')}</button>
            </>
          )}
          {notice !== '' && <div className="dsd-trash-pop__notice">{notice}</div>}
        </div>,
        document.body,
      )}

      {phase !== 'idle' && typeof document !== 'undefined' && createPortal(
        <div
          className={`dsd-trash-target${active ? ' dsd-trash-target--active' : ''}${phase === 'swallow' ? ' dsd-trash-target--swallowed' : ''}${phase === 'back' ? ' dsd-trash-target--back' : ''}`}
          style={targetStyle}
          onDragEnter={() => setActive(true)}
          onDragOver={(event) => { event.preventDefault(); if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move' }}
          onDragLeave={() => setActive(false)}
          onDrop={(event) => {
            event.preventDefault()
            const id = event.dataTransfer?.getData('text/plain') ?? ''
            setActive(false)
            if (id === '') {
              thrownRef.current = false
              setPhase(p => (p === 'swallow' ? 'idle' : p))
              return
            }
            thrownRef.current = true
            const x = event.clientX
            const y = event.clientY
            setPaper({ x, y, dx: tc.x - x, dy: tc.y - y })
            setPhase('swallow')
            window.setTimeout(() => {
              thrownRef.current = false
              setPaper(null)
              setPhase('idle')
              void throwIntoTrash(id)
            }, 700)
          }}
        >
          <div className="dsd-trash-target__core">
            <span className="dsd-trash-target__icon" aria-hidden="true">🗑</span>
            <span className="dsd-trash-target__hint">{t('trash.dropHint')}</span>
          </div>
        </div>,
        document.body,
      )}

      {paper !== null && createPortal(
        <div
          className="dsd-trash-paper"
          style={{ left: paper.x, top: paper.y, '--dx': `${paper.dx}px`, '--dy': `${paper.dy}px` } as CSSProperties}
        />,
        document.body,
      )}
    </>
  )
}
