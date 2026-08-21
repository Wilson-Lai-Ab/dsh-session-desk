/**
 * Per-session model-trajectory folding.
 *
 * Ported byte-faithfully from dsh-answer-pet `trace.mjs` (MIT, Nanki-nn)
 * into TypeScript. Compresses phase + tool events into a bounded, safe-summary
 * timeline. Never exposes full arguments/command — only whitelisted short
 * detail keys. Zero host dependencies; unit-testable.
 */
export const MAX_TRACE_ITEMS = 6

/** Whitelisted argument fields that may appear in a trace detail line. */
const DETAIL_KEYS = ['description', 'query', 'pattern', 'file_path', 'path', 'url']

export interface TraceItem {
  id: string
  kind: 'phase' | 'tool'
  label: string
  detail: string | null
  status: 'running' | 'done' | 'error'
  startedAt: number
  endedAt: number | null
  callId: string | null
}

/** Folded trace state before projection. */
export interface TraceState {
  items: TraceItem[]
  calls: Map<string, TraceItem>
  serial: number
}

/** Projected, serializable trace item (as served to the client). */
export interface TraceViewItem {
  id: string
  kind: 'phase' | 'tool'
  label: string
  detail: string | null
  status: 'running' | 'done' | 'error'
  durationMs: number
}

export function initialTraceState(): TraceState {
  return { items: [], calls: new Map(), serial: 0 }
}

function cleanText(value: unknown, max = 88): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length === 0) return null
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/**
 * Extract a safe short description from tool arguments. Never returns a full
 * command or raw JSON — only the first non-empty whitelisted field, truncated.
 */
export function summarizeToolArguments(raw: unknown): string | null {
  let args: unknown = raw
  if (typeof raw === 'string') {
    try {
      args = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return null
  const rec = args as Record<string, unknown>
  for (const key of DETAIL_KEYS) {
    const text = cleanText(rec[key])
    if (text !== null) return text
  }
  return null
}

function trim(state: TraceState): void {
  if (state.items.length <= MAX_TRACE_ITEMS) return
  const removed = state.items.splice(0, state.items.length - MAX_TRACE_ITEMS)
  for (const item of removed) {
    if (item.callId !== null) state.calls.delete(item.callId)
  }
}

function add(state: TraceState, input: {
  id?: string
  kind: 'phase' | 'tool'
  label: string
  detail?: string | null
  status?: 'running' | 'done' | 'error'
  startedAt: number
  endedAt?: number | null
  callId?: string | null
}): TraceItem {
  const item: TraceItem = {
    id: input.id ?? `trace:${++state.serial}`,
    kind: input.kind,
    label: input.label,
    detail: input.detail ?? null,
    status: input.status ?? 'running',
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
    callId: input.callId ?? null,
  }
  state.items.push(item)
  if (item.callId !== null) state.calls.set(item.callId, item)
  trim(state)
  return item
}

function closePhases(state: TraceState, now: number): void {
  for (const item of state.items) {
    if (item.kind === 'phase' && item.status === 'running') {
      item.status = 'done'
      item.endedAt = now
    }
  }
}

function phaseOnce(state: TraceState, id: string, label: string, detail: string | null, now: number): TraceItem {
  const existing = state.items.find((item) => item.id === id)
  if (existing !== undefined) return existing
  closePhases(state, now)
  return add(state, { id, kind: 'phase', label, detail, status: 'running', startedAt: now })
}

/** Start a new turn: reset trace state and open the "开始处理请求" phase. */
export function startTraceTurn(data: { turn?: unknown } | undefined, now = Date.now()): TraceState {
  const state = initialTraceState()
  const turn = typeof data?.turn === 'number' ? data.turn : 0
  add(state, {
    id: `turn:${turn}`,
    kind: 'phase',
    label: '开始处理请求',
    status: 'running',
    startedAt: now,
  })
  return state
}

function resultCallId(data: Record<string, unknown>): string | null {
  if (typeof data?.callId === 'string') return data.callId
  const block = data?.message as { content?: unknown } | undefined
  if (block?.content !== null && typeof block?.content === 'object' && !Array.isArray(block.content)) {
    const first = (block.content as Record<string, unknown>)
    return typeof first.toolCallId === 'string' ? first.toolCallId : null
  }
  const content = Array.isArray(block?.content) ? (block.content as unknown[])[0] : undefined
  if (content !== null && typeof content === 'object') {
    return typeof (content as Record<string, unknown>).toolCallId === 'string'
      ? (content as Record<string, unknown>).toolCallId as string
      : null
  }
  return null
}

function resultIsError(data: Record<string, unknown>): boolean {
  if (data?.error !== undefined) return true
  const block = data?.message as { content?: unknown } | undefined
  if (Array.isArray(block?.content)) {
    const first = (block.content as unknown[])[0]
    if (first !== null && typeof first === 'object') {
      return (first as Record<string, unknown>).isError === true
    }
  }
  return false
}

function settleCall(state: TraceState, callId: string | null, isError: boolean, now: number): void {
  if (callId === null) return
  const item = state.calls.get(callId)
  if (item === undefined) return
  item.status = isError ? 'error' : 'done'
  item.endedAt = now
  state.calls.delete(callId)
}

/** Apply one session event to the folded trace (in place). */
export function applyTraceEvent(state: TraceState, event: { type?: string; data?: Record<string, unknown> } | null | undefined, now = Date.now()): TraceState {
  const type = event?.type
  const data = event?.data ?? {}
  const turn = typeof data.turn === 'number' ? data.turn : 0
  const step = typeof data.step === 'number' ? data.step : 0
  switch (type) {
    case 'step/start':
      phaseOnce(state, `step:${turn}:${step}`, '分析任务', `步骤 ${step + 1}`, now)
      break
    case 'assistant/chunk': {
      const chunk = (data?.chunk ?? {}) as Record<string, unknown>
      const chunkType = chunk.type
      if (chunkType === 'reasoning-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
        phaseOnce(state, `reason:${turn}:${step}`, '推理与规划', null, now)
      } else if (chunkType === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
        phaseOnce(state, `answer:${turn}:${step}`, '组织回答', null, now)
      }
      break
    }
    case 'tool/call': {
      closePhases(state, now)
      const callId = typeof data.callId === 'string' ? data.callId : `tool:${++state.serial}`
      const name = cleanText(data.name, 40) ?? 'unknown'
      add(state, {
        id: `tool:${callId}`,
        kind: 'tool',
        label: `调用 ${name}`,
        detail: summarizeToolArguments(data.arguments),
        status: 'running',
        startedAt: now,
        callId,
      })
      break
    }
    case 'tool/result':
      settleCall(state, resultCallId(data), resultIsError(data), now)
      break
    case 'tool/code-dispatch-start': {
      const callId = typeof data.subCallId === 'string' ? data.subCallId : `code:${++state.serial}`
      const name = cleanText(data.name, 40) ?? 'unknown'
      add(state, {
        id: `tool:${callId}`,
        kind: 'tool',
        label: `调用 ${name}`,
        detail: summarizeToolArguments(data.arguments),
        status: 'running',
        startedAt: now,
        callId,
      })
      break
    }
    case 'tool/code-dispatch':
      settleCall(state, typeof data.subCallId === 'string' ? data.subCallId : null, data.isError === true, now)
      break
    case 'assistant/message':
    case 'step/end':
      closePhases(state, now)
      break
    case 'turn/end':
      for (const item of state.items) {
        if (item.status === 'running') {
          item.status = 'done'
          item.endedAt = now
        }
      }
      break
    default:
      break
  }
  return state
}

/** Project the folded trace into a serializable view (host keeps 6, client shows 4). */
export function deriveTrace(state: TraceState | undefined, now = Date.now()): TraceViewItem[] {
  if (state === undefined || !Array.isArray(state.items)) return []
  return state.items.map((item) => ({
    id: item.id,
    kind: item.kind,
    label: item.label,
    detail: item.detail,
    status: item.status,
    durationMs: Math.max(0, (item.endedAt ?? now) - item.startedAt),
  }))
}

/** Recover the current turn's trajectory from a historical event list (first sight of a session). */
export function foldTrace(events: unknown, now = Date.now()): TraceState {
  let state = initialTraceState()
  if (!Array.isArray(events)) return state
  for (const event of events) {
    if (event !== null && typeof event === 'object' && (event as Record<string, unknown>).type === 'turn/start') {
      state = startTraceTurn((event as Record<string, unknown>).data as { turn?: unknown } | undefined, (event as { time?: unknown }).time as number | undefined ?? now)
    } else {
      applyTraceEvent(state, event as { type?: string; data?: Record<string, unknown> }, (event as { time?: unknown }).time as number | undefined ?? now)
    }
  }
  return state
}
