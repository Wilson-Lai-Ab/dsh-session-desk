/**
 * Snapshot-fold bridge: map `sessions.list()` rows (no event logs) into the
 * answer status-card view. The pure progress/trace modules fold *event logs*;
 * this adapter derives a coarse, monotone status view from the coarse snapshot
 * fields a live session row exposes (openState / running / pendingInteraction /
 * title), falling back to a bounded trace when no per-session events exist.
 *
 * Intended for the host route: a polling client builds one card per running
 * session from this view, matching the answer-pet "多会话进度卡" shape without
 * requiring a new `session/event` surface.
 */
import { PHASES, type Phase, type ProgressView, initialProgressState, deriveView } from './progress.ts'
import type { TraceViewItem } from './trace.ts'

/** One live session row from `sessions.list()` (superset, tolerate unknowns). */
export interface AnswerSessionRow {
  id?: string
  sessionId?: string
  title?: string
  displayTitle?: string
  openState?: string
  running?: boolean
  pendingInteraction?: string
  error?: unknown
  failed?: unknown
  origin?: 'subagent' | string
  parentId?: string
  parentSessionId?: string
  /** Optional per-session event log (when the host exposes it). */
  events?: unknown
}

/** Coarse phase derived purely from a row's openState / running flags. */
export function phaseFromRow(row: AnswerSessionRow | undefined): Phase {
  if (!row) return PHASES.IDLE
  const key = (row.openState ?? '').trim().toLowerCase()
  if (key === 'streaming' || key === 'running' || key === 'generating') return PHASES.STREAM
  if (key === 'tool' || key === 'tool-running' || key === 'tool_running') return PHASES.TOOL
  if (key === 'think' || key === 'thinking') return PHASES.THINK
  if (row.error === true || row.failed === true) return PHASES.ERROR
  if (row.running === true || key !== '') return PHASES.TURN
  return PHASES.IDLE
}

/** Short status line for a row (used as the card status text's seed). */
export function statusSeed(row: AnswerSessionRow | undefined): string {
  if (!row) return ''
  const key = (row.openState ?? '').trim().toLowerCase()
  if (key === 'streaming') return 'stream'
  if (key === 'tool' || key === 'tool-running' || key === 'tool_running') return 'tool'
  if (key === 'think' || key === 'thinking') return 'think'
  if (row.error === true || row.failed === true) return 'error'
  if (row.running === true) return 'running'
  return 'idle'
}

/**
 * Build a progress view from a snapshot row. Keeps the monotone-progress /
 * phase-label semantics of the event-driven module, but the coarse snapshot
 * can only reach anchor phases — it does not fabricate token counts.
 */
export function viewFromRow(row: AnswerSessionRow | undefined, now = Date.now()): ProgressView {
  const state = initialProgressState()
  const phase = phaseFromRow(row)
  state.phase = phase
  if (phase === PHASES.STREAM || phase === PHASES.THINK || phase === PHASES.TURN) {
    state.startedAt = now
  } else if (phase === PHASES.ERROR) {
    state.endedAt = now
  }
  return deriveView(state, now)
}

/** Bounded trace view from a snapshot row (tool name / phase seed, no fabricated steps). */
export function traceFromRow(row: AnswerSessionRow | undefined, now = Date.now()): TraceViewItem[] {
  if (!row) return []
  const phase = phaseFromRow(row)
  const items: TraceViewItem[] = []
  if (phase === PHASES.STREAM) {
    items.push({ id: 'snap:answer', kind: 'phase', label: '组织回答', detail: null, status: 'running', durationMs: 0 })
  } else if (phase === PHASES.THINK) {
    items.push({ id: 'snap:think', kind: 'phase', label: '推理与规划', detail: null, status: 'running', durationMs: 0 })
  } else if (phase === PHASES.TURN) {
    items.push({ id: 'snap:turn', kind: 'phase', label: '开始处理请求', detail: null, status: 'running', durationMs: 0 })
  }
  const tool = typeof row.pendingInteraction === 'string' ? row.pendingInteraction.trim() : ''
  if (phase === PHASES.TOOL || tool !== '') {
    const name = tool !== '' ? tool : 'tool'
    items.push({
      id: `snap:tool:${name}`,
      kind: 'tool',
      label: `调用 ${name}`,
      detail: null,
      status: row.error === true ? 'error' : 'running',
      durationMs: 0,
    })
  }
  return items
}

/** One status-card row for a running (or recently active) session. */
export interface AnswerStatusCard {
  id: string
  title: string
  view: ProgressView
  trace: TraceViewItem[]
}

/** Fold the whole `sessions.list()` snapshot into status-card rows (top-level only). */
export function foldSnapshotRows(rows: readonly AnswerSessionRow[] | undefined, now = Date.now()): AnswerStatusCard[] {
  if (!Array.isArray(rows)) return []
  const out: AnswerStatusCard[] = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const id = typeof row.id === 'string' ? row.id : row.sessionId
    if (typeof id !== 'string' || id === '') continue
    // skip subagent children — main sessions get their own card
    const parent = row.parentId ?? row.parentSessionId
    if (typeof parent === 'string' && parent !== '') continue
    out.push({
      id,
      title: row.displayTitle || row.title || id,
      view: viewFromRow(row, now),
      trace: traceFromRow(row, now),
    })
  }
  return out
}
