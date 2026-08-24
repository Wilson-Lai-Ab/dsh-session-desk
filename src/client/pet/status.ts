/**
 * Pet status mapping, image URL whitelist, and viewport clamp.
 * Chat body text is never inspected: awaiting is openState only.
 */
import { clampPetSize, PET_SIZE_MIN } from '../../shared.ts'
import { sanitizeWallpaperUrl } from '../../sanitize.ts'

export type PetKind = 'running' | 'idle' | 'error' | 'awaiting' | 'subagent'

const RUNNING = new Set(['streaming', 'running', 'generating'])
const ERROR = new Set(['error', 'failed'])
const AWAITING = new Set(['awaiting_input', 'needs_permission', 'blocked'])

/** Size of the pet sprite in CSS pixels. */
export const PET_SIZE = 48

/** Default inset from the right edge when petX/petY are -1. */
export const PET_DEFAULT_RIGHT = 16

/** Default inset from the bottom (above the composer) when petX/petY are -1. */
export const PET_DEFAULT_BOTTOM = 96

/**
 * Map a session `openState` to a pet kind. Case-insensitive exact match only.
 * Idle / tool-running / thinking / chat text such as 「确认」 are not awaiting.
 */
export function petKindOf(openState: string | undefined): PetKind {
  const key = (openState ?? '').trim().toLowerCase()
  if (RUNNING.has(key)) return 'running'
  if (ERROR.has(key)) return 'error'
  if (AWAITING.has(key)) return 'awaiting'
  return 'idle'
}

/** Fields a sessions.list row may carry besides the spec's `openState`. */
export interface PetSessionRow {
  id?: string
  openState?: string
  running?: boolean
  pendingInteraction?: string
  error?: unknown
  failed?: unknown
  title?: string
  displayTitle?: string
  parentId?: string
  parentSessionId?: string
  sessionId?: string
  origin?: 'subagent' | string
}

/**
 * Kind for a list row. `openState` wins when present; otherwise list flags.
 * Title / chat text is never inspected.
 */
/** Tools that pause the turn until the user answers (desktop + browser pets). */
export function isConfirmationTool(name: string | undefined): boolean {
  const key = (name ?? '').trim().toLowerCase()
  if (key === '') return false
  return key === 'ask_user_question' || key === 'exit_plan_mode'
    || key.includes('ask_user') || key.includes('permission')
}

export function sessionKindFromRow(row: PetSessionRow | undefined): PetKind {
  if (!row) return 'idle'
  // pendingInteraction is the host's "waiting on the user" flag; it beats a
  // stale streaming openState that desktop snapshots still carry.
  if (toolOf(row)) return 'awaiting'
  if (typeof row.openState === 'string' && row.openState.trim() !== '') {
    return petKindOf(row.openState)
  }
  if (row.error === true || row.failed === true) return 'error'
  if (typeof row.error === 'string' && row.error.trim() !== '') return 'error'
  if (row.running === true) return 'running'
  return 'idle'
}

/** Worst-case kind across listed sessions for the pet badge. */
export function aggregatePetKind(kinds: readonly PetKind[]): PetKind {
  if (kinds.includes('awaiting')) return 'awaiting'
  if (kinds.includes('error')) return 'error'
  if (kinds.includes('subagent')) return 'subagent'
  if (kinds.includes('running')) return 'running'
  return 'idle'
}

/** Folded list can miss live work; answer-pet running cards fill that gap. */
export function petKindFromLive(input: { folded: readonly PetKind[]; liveRunning: number }): PetKind {
  const folded = aggregatePetKind(input.folded)
  if (folded !== 'idle') return folded
  return input.liveRunning > 0 ? 'running' : 'idle'
}

const BUSY: ReadonlySet<PetKind> = new Set(['running', 'awaiting', 'error', 'subagent'])

/** Catalog / lineage child — listed under a parent, not as its own pet row. */
function parentKeyOf(row: PetSessionRow | undefined): string | undefined {
  if (!row) return undefined
  const parent = row.parentId ?? row.parentSessionId
  return typeof parent === 'string' && parent.trim() !== '' ? parent.trim() : undefined
}

export function isSubagentRow(row: PetSessionRow | undefined): boolean {
  if (!row) return false
  if (row.origin === 'subagent') return true
  return parentKeyOf(row) !== undefined
}

function worseKind(a: PetKind, b: PetKind): PetKind {
  return aggregatePetKind([a, b])
}

function parentKindWithChildren(self: PetKind, children: readonly PetKind[]): PetKind {
  const child = aggregatePetKind(children)
  if (self === 'awaiting' || self === 'error') return worseKind(self, child === 'subagent' ? 'running' : child)
  if (child === 'awaiting') return 'awaiting'
  if (child === 'error') return 'error'
  if (child === 'running' || child === 'subagent' || children.some(kind => BUSY.has(kind))) return 'subagent'
  return self
}

/** One pet-panel row after subagents are folded into their parent. */
export interface FoldedPetRow {
  id: string
  title: string
  kind: PetKind
  /** Short "what it's doing" label key (running/subagent rows). */
  activity?: PetActivity
  /** Tool name being requested (awaiting rows). */
  tool?: string
}

export type PetActivity = 'streaming' | 'generating' | 'running'

/** Compact list line: `title · activity 42%`. Omit the percent when unknown. */
export function runningRowLabel(title: string, activity: string, progress?: number): string {
  const head = activity === '' ? title : `${title} · ${activity}`
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return head
  return `${head} ${Math.round(Math.min(100, Math.max(0, progress)))}%`
}

/** Index live answer-pet percents by session id. */
export function progressBySession(
  cards: readonly { id?: string; view?: { progress?: number } }[] | undefined,
): Map<string, number> {
  const map = new Map<string, number>()
  if (!cards) return map
  for (const card of cards) {
    if (typeof card.id !== 'string' || card.id === '') continue
    const progress = card.view?.progress
    if (typeof progress !== 'number' || !Number.isFinite(progress)) continue
    map.set(card.id, progress)
  }
  return map
}

/** Map a row's `openState` to a short activity label key; `running` is the fallback. */
export function activityOf(row: PetSessionRow | undefined): PetActivity {
  const key = (row?.openState ?? '').trim().toLowerCase()
  if (key === 'streaming') return 'streaming'
  if (key === 'generating') return 'generating'
  return 'running'
}

/** Trimmed `pendingInteraction` (the tool name), or undefined when empty. */
export function toolOf(row: PetSessionRow | undefined): string | undefined {
  if (!row) return undefined
  const tool = typeof row.pendingInteraction === 'string' ? row.pendingInteraction.trim() : ''
  return tool === '' ? undefined : tool
}

/** Index into an idle-copy phrase list that wraps tick around `count`. */
export function idlePhraseIndex(tick: number, count: number): number {
  if (count <= 0) return 0
  return ((tick % count) + count) % count
}

/** Random delay between idle broadcasts, inclusive of both ends. */
export const IDLE_BROADCAST_MIN_MS = 10_000
export const IDLE_BROADCAST_MAX_MS = 60_000

export function nextIdleBroadcastDelay(random: () => number = Math.random): number {
  const span = IDLE_BROADCAST_MAX_MS - IDLE_BROADCAST_MIN_MS
  const unit = Math.min(1, Math.max(0, random()))
  return Math.round(IDLE_BROADCAST_MIN_MS + unit * span)
}

/** How long an idle broadcast bubble stays visible. */
export const IDLE_BROADCAST_HOLD_MS = 8_000

/**
 * Rows that just finished: busy (running/subagent) in `prev`, idle in `next`.
 * A session still running, awaiting, or errored is not counted as completed.
 */
export function completedRows(
  prev: readonly FoldedPetRow[],
  next: readonly FoldedPetRow[],
): FoldedPetRow[] {
  const prevKinds = new Map(prev.map(e => [e.id, e.kind] as const))
  return next.filter(e => {
    const before = prevKinds.get(e.id)
    return (before === 'running' || before === 'subagent') && e.kind === 'idle'
  })
}

/**
 * Running subagent children (origin='subagent' or a parent link), for the
 * "子代理执行中" list. Main (parent) sessions are shown in the running section
 * instead, so parents and idle/finished children are excluded here.
 */
export function subagentDetailRows(snap: PetListSnapshot | undefined): FoldedPetRow[] {
  return rowsFromList(snap)
    .filter(row => isSubagentRow(row) && sessionKindFromRow(row) === 'running')
    .map(row => {
      const id = rowId(row)
      return {
        id: id ?? '',
        title: row.displayTitle || row.title || id || '',
        kind: 'subagent' as const,
      }
    })
    .filter(row => row.id !== '')
}

/**
 * Keep top-level sessions only. A busy child becomes the parent's
 * `subagent` kind ("子代理执行") instead of its own row.
 */
function rowId(row: PetSessionRow): string | undefined {
  if (typeof row.id === 'string' && row.id !== '') return row.id
  if (typeof row.sessionId === 'string' && row.sessionId !== '') return row.sessionId
  return undefined
}

function rootParentId(row: PetSessionRow, byId: Map<string, PetSessionRow>): string | undefined {
  let current: PetSessionRow | undefined = row
  const seen = new Set<string>()
  while (current && isSubagentRow(current)) {
    const id = rowId(current)
    if (id !== undefined) {
      if (seen.has(id)) break
      seen.add(id)
    }
    const parent = parentKeyOf(current)
    if (!parent) return undefined
    const next = byId.get(parent)
    if (next === undefined || !isSubagentRow(next)) return parent
    current = next
  }
  return undefined
}

/** Stable identity for folded pet rows: session-store churn with the same rows is a no-op. */
export function foldedPetSignature(rows: readonly FoldedPetRow[]): string {
  return rows
    .map(row => `${row.id}\0${row.title}\0${row.kind}\0${row.activity ?? ''}\0${row.tool ?? ''}`)
    .join('\n')
}

export function foldPetRows(rows: readonly PetSessionRow[]): FoldedPetRow[] {
  const byId = new Map<string, PetSessionRow>()
  for (const row of rows) {
    const id = rowId(row)
    if (id !== undefined) byId.set(id, row)
  }
  const childrenByParent = new Map<string, PetKind[]>()
  for (const row of rows) {
    if (!isSubagentRow(row)) continue
    const parent = rootParentId(row, byId)
    if (!parent) continue
    const list = childrenByParent.get(parent) ?? []
    list.push(sessionKindFromRow(row))
    childrenByParent.set(parent, list)
  }
  const out: FoldedPetRow[] = []
  for (const row of rows) {
    if (isSubagentRow(row)) continue
    const id = rowId(row)
    if (id === undefined) continue
    const self = sessionKindFromRow(row)
    const children = childrenByParent.get(id) ?? []
    const kind = parentKindWithChildren(self, children)
    out.push({
      id,
      title: row.displayTitle || row.title || id,
      kind,
      activity: kind === 'running' || kind === 'subagent' ? activityOf(row) : undefined,
      tool: kind === 'awaiting' ? toolOf(row) : undefined,
    })
  }
  return out
}

export interface PetJobView {
  kind?: string
  status?: string
}

export interface PetCatalogChild {
  kind?: string
  activity?: string
}

export interface PetListSnapshot {
  ids?: string[]
  byId?: Record<string, PetSessionRow>
  items?: PetSessionRow[]
  jobsBySession?: Record<string, readonly PetJobView[] | undefined>
  subagentsByParent?: Record<string, { entries?: readonly PetCatalogChild[] } | undefined>
}

function rowsFromList(snap: PetListSnapshot | undefined): PetSessionRow[] {
  if (!snap) return []
  const byId = snap.byId
  if (byId && typeof byId === 'object') {
    const ordered = Array.isArray(snap.ids) ? snap.ids : Object.keys(byId)
    const seen = new Set<string>()
    const rows: PetSessionRow[] = []
    const push = (id: string, row: PetSessionRow | undefined): void => {
      if (seen.has(id)) return
      seen.add(id)
      rows.push({ ...(row ?? {}), id: row?.id || id, parentId: row?.parentId ?? row?.parentSessionId })
    }
    for (const id of ordered) push(id, byId[id])
    for (const [id, row] of Object.entries(byId)) push(id, row)
    return rows.filter(row => row.id)
  }
  if (Array.isArray(snap.items)) {
    return snap.items.map(row => ({
      ...row,
      id: row.id || row.sessionId,
      parentId: row.parentId ?? row.parentSessionId,
    })).filter(row => row.id)
  }
  return []
}

function isSubagentJob(job: PetJobView | undefined): boolean {
  const kind = (job?.kind ?? '').toLowerCase()
  return kind === 'subagent' || kind === 'task' || kind === 'send_message' || kind.includes('subagent')
}

function liveSubagentParentIds(snap: PetListSnapshot | undefined): Set<string> {
  const parents = new Set<string>()
  if (!snap) return parents
  const jobs = snap.jobsBySession
  if (jobs && typeof jobs === 'object') {
    for (const [sessionId, list] of Object.entries(jobs)) {
      if (!Array.isArray(list)) continue
      if (list.some(job => isSubagentJob(job) && (job.status === 'running' || job.status === 'stopping'))) {
        parents.add(sessionId)
      }
    }
  }
  const catalogs = snap.subagentsByParent
  if (catalogs && typeof catalogs === 'object') {
    for (const [sessionId, catalog] of Object.entries(catalogs)) {
      const entries = catalog?.entries
      if (!Array.isArray(entries)) continue
      if (entries.some(entry => entry?.kind === 'child' && entry.activity === 'running')) {
        parents.add(sessionId)
      }
    }
  }
  return parents
}

/** Fold list rows plus live catalog/job signals that never appear as session rows. */
export function foldPetList(snap: PetListSnapshot | undefined): FoldedPetRow[] {
  const folded = foldPetRows(rowsFromList(snap))
  const live = liveSubagentParentIds(snap)
  if (live.size === 0) return folded
  return folded.map(row => {
    if (!live.has(row.id)) return row
    if (row.kind === 'awaiting' || row.kind === 'error') return row
    return { ...row, kind: 'subagent' }
  })
}

/**
 * Return a safe pet image URL, or null to use the built-in whale.
 * Empty / rejected values (javascript:, data:text, …) fall back to default.
 */
export function resolvePetImage(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null
  if (raw.trim() === '') return null
  return sanitizeWallpaperUrl(raw)
}

/** Compact desktop window: sit the sprite low so the bubble above is not clipped. */
export function desktopPetRest(
  viewportWidth: number,
  viewportHeight: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const menu = 96
  const bubble = 228
  return clampPetInBounds(
    (viewportWidth - width) / 2,
    Math.max(bubble, viewportHeight - height - menu),
    width,
    height,
    viewportWidth,
    viewportHeight,
  )
}

/** First `limit` progress cards stay in view; the rest are overflow. */
export function visiblePetCards<T>(cards: readonly T[], limit = 2): { shown: T[]; overflow: number } {
  const cap = Math.max(0, limit)
  const shown = cards.slice(0, cap)
  return { shown, overflow: Math.max(0, cards.length - shown.length) }
}

/** Live answer-pet cards that vanished between ticks are finished sessions. */
export function completedFromLive(
  prevIds: readonly string[],
  nextIds: readonly string[],
  titles: Record<string, string> = {},
): FoldedPetRow[] {
  const next = new Set(nextIds)
  return prevIds
    .filter(id => id !== '' && !next.has(id))
    .map(id => ({ id, title: titles[id] ?? id, kind: 'idle' as const }))
}

/** Clamp a width×height pet so it stays fully inside a window, with no composer inset. */
export function clampPetInBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const maxX = Math.max(0, viewportWidth - width)
  const maxY = Math.max(0, viewportHeight - height)
  return {
    x: Math.min(maxX, Math.max(0, x)),
    y: Math.min(maxY, Math.max(0, y)),
  }
}

/** Clamp a width×height pet so it stays fully inside the viewport, above the composer. */
export function clampPetPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const maxX = Math.max(0, viewportWidth - width)
  const maxY = Math.max(0, viewportHeight - height - PET_DEFAULT_BOTTOM)
  return {
    x: Math.min(maxX, Math.max(0, x)),
    y: Math.min(maxY, Math.max(0, y)),
  }
}

/** Max bubble height that still fits above the sprite in a compact window. */
export function calloutMaxHeight(petY: number, margin = 8): number {
  return Math.max(72, petY - margin - 12)
}

/** Horizontal center of the speech bubble, kept on-screen without a 160px floor. */
export function calloutAnchorX(petX: number, petWidth: number, viewportWidth: number, margin = 12): number {
  const center = petX + petWidth / 2
  const min = margin
  const max = Math.max(margin, viewportWidth - margin)
  return Math.min(max, Math.max(min, center))
}

/**
 * Live bubble placement while the pet moves. Always pin with `bottom` (and
 * `top: auto`) so a drag cannot leave both edges set — CSS then squeezes
 * the bubble into the leftover gap ("挤到一起").
 */
export function calloutLiveStyle(input: {
  petX: number
  petY: number
  petWidth: number
  viewportWidth: number
  viewportHeight: number
  inShell: boolean
}): { left: string; top: string; bottom: string; maxHeight: string } {
  return {
    left: `${calloutAnchorX(input.petX, input.petWidth, input.viewportWidth)}px`,
    top: 'auto',
    bottom: `${input.viewportHeight - input.petY + 12}px`,
    maxHeight: `${calloutMaxHeight(input.petY)}px`,
  }
}

/** Pixel left/top for the default bottom-right rest pose. */
export function defaultPetPosition(
  viewportWidth: number,
  viewportHeight: number,
  width = PET_SIZE,
  height = PET_SIZE,
): { x: number; y: number } {
  return clampPetPosition(
    viewportWidth - width - PET_DEFAULT_RIGHT,
    viewportHeight - height - PET_DEFAULT_BOTTOM,
    width,
    height,
    viewportWidth,
    viewportHeight,
  )
}

/**
 * Shrink a configured pet so it stays inside the viewport (VS Code sidebar,
 * split panes) and never occupies more than half the width. Leaves room above
 * the composer via PET_DEFAULT_BOTTOM.
 */
export function fitPetSize(
  requested: number,
  aspect: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const width = clampPetSize(requested)
  const ratio = aspect > 0 ? aspect : 1
  const maxWidth = Math.max(
    PET_SIZE_MIN,
    Math.min(
      viewportWidth - PET_DEFAULT_RIGHT * 2,
      Math.floor(viewportWidth * 0.5),
      Math.floor(Math.max(PET_SIZE_MIN, viewportHeight - PET_DEFAULT_BOTTOM - 24) * ratio),
    ),
  )
  return clampPetSize(Math.min(width, maxWidth))
}
