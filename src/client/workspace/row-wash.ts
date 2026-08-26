/**
 * Workspace session-row wash: tint busy / unseen-terminal rows, leave idle
 * rows (and opened terminal rows) untouched. Progress lives on a 2px bar;
 * the host relative-time label is never replaced.
 */
import {
  isSubagentRow,
  progressBySession,
  sessionKindFromRow,
  type PetKind,
  type PetListSnapshot,
  type PetSessionRow,
} from '../pet/status.ts'

export const STYLE_ID = 'dsh-session-desk-row-wash'

export type RowWashKind = 'idle' | 'running' | 'subagent' | 'awaiting' | 'completed' | 'error'

export interface WashElement {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  style: {
    setProperty(name: string, value: string): void
    removeProperty(name: string): string
  }
}

export interface TreeRowView {
  title: string
  selected: boolean
}

export interface SessionTitleRow {
  id: string
  title: string
}

export function rowWashKind(input: {
  kind: PetKind
  completed?: boolean
  current?: boolean
  seen?: boolean
}): RowWashKind {
  if (input.kind === 'running' || input.kind === 'subagent' || input.kind === 'awaiting') return input.kind
  if (input.seen === true) return 'idle'
  if (input.kind === 'error') return input.current === true ? 'idle' : 'error'
  if (input.completed === true && input.current !== true) return 'completed'
  return 'idle'
}

/** Opening a terminal (completed / error / idle) row remembers it as seen. Busy rows stay live. */
export function rememberOpenedTerminal(seen: Set<string>, id: string, kind: PetKind, current: boolean): void {
  if (kind === 'running' || kind === 'subagent' || kind === 'awaiting') {
    seen.delete(id)
    return
  }
  if (!current) return
  seen.add(id)
}

export function progressVars(input: {
  kind: RowWashKind
  progress?: number
  phase?: string
}): { progress?: number; indeterminate: boolean; phase?: string } {
  if (input.kind === 'idle') return { indeterminate: false }
  if (input.kind === 'completed') return { progress: 100, indeterminate: false }
  const raw = input.progress
  const has = typeof raw === 'number' && Number.isFinite(raw)
  const phase = input.phase === 'tool' ? 'tool' : undefined
  if (has) return { progress: Math.min(100, Math.max(0, raw)), indeterminate: false, phase }
  return { indeterminate: true, phase }
}

export function isSessionTreeRow(node: { getAttribute?(name: string): string | null; role?: string | null; expanded?: string | null }): boolean {
  const role = node.role ?? node.getAttribute?.('role')
  if (role !== 'treeitem') return false
  const expanded = node.expanded ?? node.getAttribute?.('aria-expanded')
  return expanded === null || expanded === undefined || expanded === ''
}

const TIME_SUFFIX = /(?:\s+(?:刚刚|now|\d+\s*(?:分钟|小时|天|个月|年|min|h|d|mo|y)(?:\s*ago)?|just now))+$/i

export function normalizeRowTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().replace(TIME_SUFFIX, '').trim()
}

export function matchSessionRows(
  views: readonly TreeRowView[],
  sessions: readonly SessionTitleRow[],
  currentId?: string,
): Array<{ index: number; id: string }> {
  const byTitle = new Map<string, SessionTitleRow[]>()
  for (const session of sessions) {
    const key = normalizeRowTitle(session.title)
    if (key === '') continue
    const list = byTitle.get(key) ?? []
    list.push(session)
    byTitle.set(key, list)
  }
  const used = new Set<string>()
  const out: Array<{ index: number; id: string }> = []
  views.forEach((view, index) => {
    if (view.selected && currentId && !used.has(currentId) && sessions.some(row => row.id === currentId)) {
      used.add(currentId)
      out.push({ index, id: currentId })
      return
    }
    const candidates = (byTitle.get(normalizeRowTitle(view.title)) ?? []).filter(row => !used.has(row.id))
    if (candidates.length === 0) return
    const picked = candidates[0]
    if (!picked) return
    used.add(picked.id)
    out.push({ index, id: picked.id })
  })
  return out
}

export function applyRowWash(el: WashElement, input: {
  kind: RowWashKind
  progress?: number
  phase?: string
}): void {
  const vars = progressVars(input)
  if (input.kind === 'idle') {
    el.removeAttribute('data-dsd-kind')
    el.removeAttribute('data-dsd-indet')
    el.removeAttribute('data-dsd-phase')
    el.style.removeProperty('--dsd-progress')
    return
  }
  el.setAttribute('data-dsd-kind', input.kind)
  if (vars.phase) el.setAttribute('data-dsd-phase', vars.phase)
  else el.removeAttribute('data-dsd-phase')
  if (vars.indeterminate) el.setAttribute('data-dsd-indet', '')
  else el.removeAttribute('data-dsd-indet')
  if (typeof vars.progress === 'number') el.style.setProperty('--dsd-progress', `${Math.round(vars.progress)}%`)
  else el.style.removeProperty('--dsd-progress')
}

export function extractRowTitle(node: { querySelector: (sel: string) => { textContent: string | null } | null; textContent?: string | null }): string {
  const titled = node.querySelector('[class*="title"]')
  const raw = titled?.textContent ?? node.textContent ?? ''
  return normalizeRowTitle(raw)
}

function rowId(row: PetSessionRow): string | undefined {
  if (typeof row.id === 'string' && row.id !== '') return row.id
  if (typeof row.sessionId === 'string' && row.sessionId !== '') return row.sessionId
  return undefined
}

function displayTitle(row: PetSessionRow, id: string): string {
  const title = row.displayTitle || row.title
  return typeof title === 'string' && title.trim() !== '' ? normalizeRowTitle(title) : id
}

function petKindForWash(row: PetSessionRow): PetKind {
  const self = sessionKindFromRow(row)
  if (isSubagentRow(row) && self === 'running') return 'subagent'
  return self
}

export interface WashPaint {
  kind: RowWashKind
  progress?: number
  phase?: string
}

export function paintsBySession(
  snap: PetListSnapshot | undefined,
  progress: ReadonlyMap<string, number>,
  phases: ReadonlyMap<string, string> = new Map(),
  seen: Set<string> = new Set(),
): Map<string, WashPaint> {
  const out = new Map<string, WashPaint>()
  if (!snap) return out
  const current = typeof snap.current === 'string' ? snap.current : undefined
  const rows: PetSessionRow[] = []
  if (snap.byId && typeof snap.byId === 'object') {
    const ordered = Array.isArray(snap.ids) ? snap.ids : Object.keys(snap.byId)
    for (const id of ordered) {
      const row = snap.byId[id]
      rows.push({ ...(row ?? {}), id: row?.id || id })
    }
  } else if (Array.isArray(snap.items)) {
    rows.push(...snap.items)
  }
  for (const row of rows) {
    const id = rowId(row)
    if (!id) continue
    const petKind = petKindForWash(row)
    const isCurrent = id === current
    rememberOpenedTerminal(seen, id, petKind, isCurrent)
    const kind = rowWashKind({
      kind: petKind,
      completed: row.completed === true,
      current: isCurrent,
      seen: seen.has(id),
    })
    const vars = progressVars({ kind, progress: progress.get(id), phase: phases.get(id) })
    out.set(id, { kind, progress: vars.progress, phase: vars.phase })
  }
  return out
}

export function paintDocument(
  nodes: ReadonlyArray<WashElement & {
    getAttribute(name: string): string | null
    querySelector: (sel: string) => { textContent: string | null } | null
    textContent?: string | null
  }>,
  sessions: readonly SessionTitleRow[],
  paints: ReadonlyMap<string, WashPaint>,
  currentId?: string,
): void {
  const sessionNodes = nodes.filter(node => isSessionTreeRow(node))
  const views = sessionNodes.map(node => ({
    title: extractRowTitle(node),
    selected: node.getAttribute('aria-selected') === 'true',
  }))
  const matched = matchSessionRows(views, sessions, currentId)
  const painted = new Set<number>()
  for (const { index, id } of matched) {
    painted.add(index)
    const paint = paints.get(id) ?? { kind: 'idle' }
    applyRowWash(sessionNodes[index]!, paint)
  }
  sessionNodes.forEach((node, index) => {
    if (!painted.has(index)) applyRowWash(node, { kind: 'idle' })
  })
}

export const cssText = `
[role="treeitem"]:not([aria-expanded])[data-dsd-kind] {
  position: relative;
  overflow: hidden;
  background-clip: padding-box;
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind]::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  border-radius: 8px 0 0 8px;
  pointer-events: none;
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind]::after {
  content: "";
  position: absolute;
  left: 3px;
  bottom: 0;
  height: 2px;
  pointer-events: none;
  background: var(--dsw-alias-state-business-primary);
  width: var(--dsd-progress, 0%);
  max-width: calc(100% - 3px);
  transform-origin: left center;
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="running"] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="running"]::before {
  background: var(--dsw-alias-state-business-primary);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="subagent"] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="subagent"]::before {
  background: repeating-linear-gradient(
    180deg,
    var(--dsw-alias-state-business-primary) 0 5px,
    transparent 5px 8px
  );
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="awaiting"] {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="awaiting"]::before {
  background: var(--dsw-alias-state-warn-primary);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="awaiting"]::after {
  background: var(--dsw-alias-state-warn-primary);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="completed"] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="completed"]::before {
  background: var(--dsw-alias-state-success-primary);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="completed"]::after {
  background: var(--dsw-alias-state-success-primary);
  width: 100%;
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="error"] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="error"]::before {
  background: var(--dsw-alias-state-error-primary);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="error"]::after {
  background: var(--dsw-alias-state-error-primary);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-phase="tool"]::after {
  background: var(--dsw-alias-state-warn-primary);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-indet]::after {
  width: 38%;
  animation: dsd-row-wash-scan 1.6s ease-in-out infinite;
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind][aria-selected="true"],
[role="treeitem"]:not([aria-expanded])[data-dsd-kind][aria-selected="true"]:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="running"]:hover:not([aria-selected="true"]) {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="subagent"]:hover:not([aria-selected="true"]) {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="awaiting"]:hover:not([aria-selected="true"]) {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="completed"]:hover:not([aria-selected="true"]) {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);
}
[role="treeitem"]:not([aria-expanded])[data-dsd-kind="error"]:hover:not([aria-selected="true"]) {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
}
@keyframes dsd-row-wash-scan {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(260%); }
}
`

export function adoptRowWashStyles(doc: { getElementById: (id: string) => { textContent: string | null } | null; head: { appendChild: (node: unknown) => void }; createElement: (tag: string) => { id: string; dataset: Record<string, string>; textContent: string | null } } | Document = document): void {
  if (typeof doc === 'undefined' || doc.getElementById === undefined) return
  if (doc.getElementById(STYLE_ID) !== null) return
  const style = doc.createElement('style') as HTMLStyleElement
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-session-desk'
  style.dataset.pluginCss = STYLE_ID
  style.textContent = cssText
  doc.head.appendChild(style)
}

function readListStore(list: unknown): PetListSnapshot | undefined {
  if (list === undefined || list === null) return undefined
  try {
    if (typeof list === 'function') return list() as PetListSnapshot
    if (typeof list === 'object' && 'getSnapshot' in list) {
      return (list as { getSnapshot: () => unknown }).getSnapshot() as PetListSnapshot
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

function titlesFromSnap(snap: PetListSnapshot | undefined): SessionTitleRow[] {
  if (!snap?.byId) {
    return (snap?.items ?? []).flatMap(row => {
      const id = rowId(row)
      return id ? [{ id, title: displayTitle(row, id) }] : []
    })
  }
  const ordered = Array.isArray(snap.ids) ? snap.ids : Object.keys(snap.byId)
  const out: SessionTitleRow[] = []
  for (const id of ordered) {
    const row = snap.byId[id]
    out.push({ id, title: displayTitle({ ...(row ?? {}), id }, id) })
  }
  return out
}

function phasesBySession(cards: readonly { id?: string; view?: { phase?: string } }[] | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!cards) return map
  for (const card of cards) {
    if (typeof card.id !== 'string' || card.id === '') continue
    const phase = card.view?.phase
    if (typeof phase === 'string' && phase !== '') map.set(card.id, phase)
  }
  return map
}

export function startRowWash(opts: {
  list?: unknown
  document?: Document
  fetchCards?: () => Promise<readonly { id?: string; view?: { progress?: number; phase?: string } }[]>
  intervalMs?: number
}): () => void {
  const doc = opts.document ?? (typeof document === 'undefined' ? undefined : document)
  if (!doc) return () => {}
  adoptRowWashStyles(doc)
  let cards: readonly { id?: string; view?: { progress?: number; phase?: string } }[] = []
  const seen = new Set<string>()
  const paint = (): void => {
    const snap = readListStore(opts.list)
    const progress = progressBySession(cards)
    const phases = phasesBySession(cards)
    const paints = paintsBySession(snap, progress, phases, seen)
    const query = typeof doc.querySelectorAll === 'function' ? doc.querySelectorAll.bind(doc) : undefined
    if (query === undefined) return
    const nodes = Array.from(query('[role="treeitem"]')) as unknown as Array<WashElement & {
      getAttribute(name: string): string | null
      querySelector: (sel: string) => { textContent: string | null } | null
      textContent?: string | null
    }>
    paintDocument(nodes, titlesFromSnap(snap), paints, typeof snap?.current === 'string' ? snap.current : undefined)
  }
  const pullCards = (): void => {
    if (!opts.fetchCards) return
    void opts.fetchCards().then(next => {
      cards = next
      paint()
    }).catch(() => { /* keep last */ })
  }
  paint()
  pullCards()
  const offList = subscribeListStore(opts.list, paint)
  const timer = opts.fetchCards
    ? setInterval(pullCards, Math.max(400, opts.intervalMs ?? 1000))
    : undefined
  const Observer = typeof MutationObserver === 'function' ? MutationObserver : undefined
  const observer = Observer === undefined ? undefined : new Observer(() => { paint() })
  observer?.observe((doc.body ?? doc.documentElement) as Node, { childList: true, subtree: true })
  return () => {
    offList?.()
    if (timer !== undefined) clearInterval(timer)
    observer?.disconnect()
  }
}
