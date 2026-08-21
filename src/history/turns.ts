/**
  * Conversation-history model: one row per user/steering turn in the mounted
  * chat snapshot, plus jump / current-turn helpers for the minimap.
  */

/** One history row: a user (or steering) turn within the mounted window. */
export interface HistoryTurn {
  /** Chat node key of the turn-opening user message (the jump anchor). */
  key: string
  /** 1-based turn index in the loaded window. */
  index: number
  /** First lines of the user message text ('' when the message has no text). */
  question: string
  /** Epoch ms of the turn start (the user message time); undefined when unavailable. */
  time?: number
  /** Engine-owned turn number (stable per session); undefined when the node has no turn location. */
  turn?: number
}

/** One chat node the minimap can preview. */
export interface HistoryNode {
  kind: string
  data: unknown
  location?: unknown
}

/** Live ChatNodeStore-shaped reader (get + optional values), not only Map. */
export interface HistoryNodeReader {
  get(key: string): HistoryNode | undefined
}

/** Snapshot shape buildTurns accepts (Chat snapshot, without importing runtime types). */
export interface HistorySnapshot {
  order: readonly string[]
  nodes: HistoryNodeReader
  legacy?: { turnTimings?: Map<number, { startTime?: number }> | { get?(turn: number): { startTime?: number } | undefined } }
}

const EMPTY_READER: HistoryNodeReader = { get: () => undefined }

/** Accept Map, ChatNodeStore `{ get }`, or missing nodes. */
export function asNodeReader(nodes: unknown): HistoryNodeReader {
  if (nodes != null && typeof nodes === 'object' && typeof (nodes as HistoryNodeReader).get === 'function') {
    return nodes as HistoryNodeReader
  }
  return EMPTY_READER
}

/** Normalize a live Chat snapshot (or unknown) into what {@link buildTurns} reads. */
export function toHistorySnapshot(chat: unknown): HistorySnapshot {
  if (typeof chat !== 'object' || chat === null) return { order: [], nodes: EMPTY_READER }
  const rec = chat as { order?: unknown; nodes?: unknown; legacy?: HistorySnapshot['legacy'] }
  const order = Array.isArray(rec.order)
    ? rec.order.filter((key): key is string => typeof key === 'string')
    : []
  return { order, nodes: asNodeReader(rec.nodes), legacy: rec.legacy }
}

/** Preview length cap before ellipsis. */
const PREVIEW_LIMIT = 60

/** Hard ceiling for the strip, including pinned turns. */
export const MAX_STRIP_TURNS = 120

/** Read a text block's text defensively. Content blocks carry `type: 'text'`,
 * assistant blocks carry `kind: 'text'` — accept both shapes. */
function blockText(block: unknown): string | null {
  if (typeof block !== 'object' || block === null) return null
  const candidate = block as { type?: unknown; kind?: unknown; text?: unknown }
  const isText = candidate.type === 'text' || candidate.kind === 'text'
  return isText && typeof candidate.text === 'string' ? candidate.text : null
}

/** Join block texts into one whitespace-normalized preview, capped + ellipsized. */
function joinPreview(chunks: readonly unknown[]): string {
  const text = chunks
    .map(blockText)
    .filter((chunk): chunk is string => chunk !== null)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…` : text
}

/**
 * First text preview of a chat node payload: user/steering messages carry
 * `content` blocks, assistant messages carry `blocks`. Everything else reads
 * as ''. Structural narrowing only — never throws on unknown payload shapes.
 */
export function previewOfNode(kind: string, data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const payload = data as { content?: unknown; blocks?: unknown }
  if (kind === 'user' || kind === 'steering') {
    return Array.isArray(payload.content) ? joinPreview(payload.content) : ''
  }
  if (kind === 'assistant') {
    return Array.isArray(payload.blocks) ? joinPreview(payload.blocks) : ''
  }
  return ''
}

/** The turn number a node belongs to, from its engine location ('' path = none). */
function nodeTurn(node: { location?: unknown }): number | undefined {
  const location = node.location
  if (typeof location !== 'object' || location === null) return undefined
  const loc = location as { kind?: unknown; turn?: { turn?: unknown } }
  if (loc.kind !== 'turn' && loc.kind !== 'step') return undefined
  const turn = loc.turn?.turn
  return typeof turn === 'number' ? turn : undefined
}

/**
 * Build the mounted history list from a Chat snapshot. Rows open at
 * user/steering messages; the turn start time (when resolvable) rides along.
 */
export function buildTurns(snapshot: HistorySnapshot): HistoryTurn[] {
  const turns: HistoryTurn[] = []
  const timings = snapshot.legacy?.turnTimings
  for (const key of snapshot.order) {
    const node = snapshot.nodes.get(key)
    if (node === undefined) continue
    if (node.kind !== 'user' && node.kind !== 'steering') continue
    const turnNumber = nodeTurn(node)
    const time = turnNumber === undefined ? undefined : timings?.get?.(turnNumber)?.startTime
    turns.push({
      key,
      index: turns.length + 1,
      question: previewOfNode(node.kind, node.data),
      time,
      turn: turnNumber,
    })
  }
  return turns
}

function isPinned(turn: HistoryTurn, pinned: ReadonlySet<number>): boolean {
  return turn.turn !== undefined && pinned.has(turn.turn)
}

/**
 * Visible turns: recent-turns limit on NON-pinned turns, with every pinned
 * turn merged back at its natural position. `limit <= 0` means all, then the
 * result is hard-capped at 120 (pins kept first).
 */
export function mergeVisibleTurns(
  turns: readonly HistoryTurn[],
  limit: number,
  pinned: ReadonlySet<number>,
): HistoryTurn[] {
  const merged = limit <= 0
    ? [...turns]
    : [...turns.filter(turn => isPinned(turn, pinned)), ...turns.filter(turn => !isPinned(turn, pinned)).slice(-limit)]
      .sort((a, b) => a.index - b.index)
  if (merged.length <= MAX_STRIP_TURNS) return merged
  const keepPins = merged.filter(turn => isPinned(turn, pinned))
  const rest = merged.filter(turn => !isPinned(turn, pinned))
  const pinBudget = Math.min(keepPins.length, MAX_STRIP_TURNS)
  const room = MAX_STRIP_TURNS - pinBudget
  return [...keepPins.slice(-pinBudget), ...rest.slice(-room)].sort((a, b) => a.index - b.index)
}

/** Locate the mounted chat row for a node key (opaque engine key). */
export function findAnchorRow(key: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]'))
  for (const row of rows) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/**
 * Smoothly scroll the conversation to a turn and flash a transient accent
 * marker on its row. No-op when the row is not mounted (paged out).
 */
export function jumpToTurn(key: string): void {
  const row = findAnchorRow(key)
  if (row === null) return
  row.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const previousShadow = row.style.boxShadow
  row.style.transition = 'box-shadow 240ms ease'
  row.style.boxShadow = 'inset 3px 0 0 0 var(--dsd-accent, var(--dsw-alias-brand-primary))'
  window.setTimeout(() => {
    row.style.boxShadow = previousShadow
    row.style.transition = ''
  }, 1600)
}

/**
 * Pick the turn the reader is currently in. Without a mounted DOM (tests,
 * node), returns null.
 */
export function currentTurnKey(keys: readonly string[]): string | null {
  if (typeof document === 'undefined') return null
  const OFFSET = 120
  const byKey = new Map<string, HTMLElement>()
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]'))
  for (const row of rows) {
    const key = row.dataset.chatAnchorKey
    if (key !== undefined) byKey.set(key, row)
  }
  let current: string | null = null
  let topmost: { key: string; top: number } | null = null
  for (const key of keys) {
    const row = byKey.get(key)
    if (row === undefined) continue
    const top = row.getBoundingClientRect().top
    if (topmost === null || top < topmost.top) topmost = { key, top }
    if (top <= OFFSET) current = key
  }
  return current ?? topmost?.key ?? null
}
