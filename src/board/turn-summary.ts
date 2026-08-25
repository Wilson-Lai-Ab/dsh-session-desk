/**
 * Per-turn board summary: fold the mounted chat snapshot into one row per
 * engine turn (model / tool / reasoning totals). Tool wall time is never
 * mixed into model time. Missing durations stay undefined — never 0-filled.
 */
import { previewOfNode } from '../history/turns.ts'

const SKIP_MODEL_KINDS = new Set([
  'tool-call',
  'tool-result',
  'user',
  'steering',
  'context',
  'command',
  'compaction',
  'unknown',
  'turn-error',
  'turn-max-tokens',
  'model-retry',
])

export interface TurnToolRow {
  name: string
  count: number
  totalMs?: number
}

export interface TurnSummary {
  turn: number
  question?: string
  wallMs?: number
  ttftMs?: number
  modelMs?: number
  modelCount: number
  planMs?: number
  reasonMs?: number
  answerMs?: number
  toolMs?: number
  toolCount: number
  tools: TurnToolRow[]
}

type Timing = { startTime?: number; endTime?: number; ttftMs?: number; ttft?: number }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return value as Record<string, unknown>
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function walkNodes(snapshot: unknown): Array<Record<string, unknown>> {
  const root = asRecord(snapshot)
  if (root === undefined) return []
  const nodes = root.nodes
  if (nodes instanceof Map) {
    const order = Array.isArray(root.order) ? root.order as readonly string[] : [...nodes.keys()]
    const out: Array<Record<string, unknown>> = []
    for (const key of order) {
      const node = asRecord(nodes.get(key))
      if (node !== undefined) out.push(node)
    }
    return out
  }
  if (nodes != null && typeof nodes === 'object' && 'get' in nodes && typeof (nodes as { get: unknown }).get === 'function' && Array.isArray(root.order)) {
    const out: Array<Record<string, unknown>> = []
    const store = nodes as { get: (key: string) => unknown }
    for (const key of root.order as readonly string[]) {
      const node = asRecord(store.get(key))
      if (node !== undefined) out.push(node)
    }
    if (out.length > 0) return out
  }
  if (nodes != null && typeof nodes === 'object' && 'values' in nodes && typeof (nodes as { values: unknown }).values === 'function') {
    const out: Array<Record<string, unknown>> = []
    for (const node of (nodes as { values: () => Iterable<unknown> }).values()) {
      const rec = asRecord(node)
      if (rec !== undefined) out.push(rec)
    }
    return out
  }
  if (Array.isArray(nodes)) {
    return nodes.map(asRecord).filter((node): node is Record<string, unknown> => node !== undefined)
  }
  const legacy = asRecord(root.legacy)
  if (Array.isArray(legacy?.nodes)) {
    return (legacy.nodes as unknown[]).map(asRecord).filter((node): node is Record<string, unknown> => node !== undefined)
  }
  return []
}

function kindOf(node: Record<string, unknown>): string | undefined {
  const nested = asRecord(node.data)
  return asString(node.kind) ?? asString(nested?.kind) ?? asString(node.type) ?? asString(nested?.type)
}

function locationTurn(node: Record<string, unknown>): number | undefined {
  const location = asRecord(node.location)
  if (location === undefined) return undefined
  if (location.kind !== 'turn' && location.kind !== 'step') return undefined
  const wrap = asRecord(location.turn)
  return asNumber(wrap?.turn)
}

function explicitTurn(node: Record<string, unknown>, data: Record<string, unknown>): number | undefined {
  return asNumber(data.turn) ?? asNumber(node.turn) ?? locationTurn(node)
}

function payloadOf(node: Record<string, unknown>): Record<string, unknown> {
  const data = asRecord(node.data)
  if (data === undefined) return node
  const root = asRecord(data.root)
  const finalNode = asRecord(data.finalNode)
  return {
    ...node,
    ...data,
    ...finalNode,
    ...root,
    timing: asRecord(data.timing) ?? asRecord(finalNode?.timing) ?? asRecord(node.timing),
    blocks: data.blocks ?? finalNode?.blocks,
    turn: asNumber(data.turn) ?? asNumber(root?.turn) ?? asNumber(finalNode?.turn) ?? asNumber(node.turn),
  }
}

function timingOf(data: Record<string, unknown>): Record<string, unknown> | undefined {
  return asRecord(data.timing) ?? asRecord(asRecord(data.finalNode)?.timing)
}

function modelDurationOf(data: Record<string, unknown>): number | undefined {
  const timing = timingOf(data)
  const explicit = asNumber(data.durationMs) ?? asNumber(data.elapsedMs) ?? asNumber(timing?.durationMs)
  if (explicit !== undefined) return explicit
  const start = asNumber(timing?.stepStartTime)
    ?? asNumber(timing?.startTime)
    ?? asNumber(data.firstVisibleTime)
    ?? asNumber(data.stepStartTime)
  const end = asNumber(timing?.completedTime)
    ?? asNumber(timing?.endTime)
    ?? asNumber(data.time)
  if (start !== undefined && end !== undefined) return Math.max(0, end - start)
  return undefined
}

function firstTokenOf(data: Record<string, unknown>): number | undefined {
  const timing = timingOf(data)
  return asNumber(timing?.firstTokenTime)
    ?? asNumber(data.firstTokenTime)
    ?? asNumber(timing?.firstTokenMs)
}

function stepStartOf(data: Record<string, unknown>): number | undefined {
  const timing = timingOf(data)
  return asNumber(timing?.stepStartTime)
    ?? asNumber(data.firstVisibleTime)
    ?? asNumber(timing?.startTime)
}

function planDurationOf(data: Record<string, unknown>): number | undefined {
  const start = stepStartOf(data)
  const first = firstTokenOf(data)
  if (start !== undefined && first !== undefined) return Math.max(0, first - start)
  return asNumber(data.ttftMs)
}

function decodeDurationOf(data: Record<string, unknown>): number | undefined {
  const timing = timingOf(data)
  const first = firstTokenOf(data)
  const end = asNumber(timing?.completedTime) ?? asNumber(data.time)
  if (first !== undefined && end !== undefined) return Math.max(0, end - first)
  return undefined
}

function reasonDurationOf(data: Record<string, unknown>): number | undefined {
  const timing = timingOf(data)
  const explicit = asNumber(data.reasoningMs)
    ?? asNumber(data.thinkingMs)
    ?? asNumber(timing?.reasoningMs)
    ?? asNumber(timing?.thinkingMs)
  if (explicit !== undefined) return explicit
  if (!hasReasoning(data)) return undefined
  const decode = decodeDurationOf(data)
  if (decode !== undefined) return decode
  const start = stepStartOf(data)
  const end = asNumber(timing?.completedTime) ?? asNumber(data.time)
  if (start !== undefined && end !== undefined && !hasAnswerText(data)) return Math.max(0, end - start)
  return undefined
}

function answerDurationOf(data: Record<string, unknown>): number | undefined {
  const timing = timingOf(data)
  const explicitReason = asNumber(data.reasoningMs)
    ?? asNumber(data.thinkingMs)
    ?? asNumber(timing?.reasoningMs)
    ?? asNumber(timing?.thinkingMs)
  const model = modelDurationOf(data)
  if (explicitReason !== undefined && model !== undefined) return Math.max(0, model - explicitReason)
  if (hasReasoning(data)) return undefined
  const decode = decodeDurationOf(data)
  if (decode !== undefined) return decode
  return model
}

function hasBlockKind(data: Record<string, unknown>, kind: string): boolean {
  const lists = [data.blocks, asRecord(data.finalNode)?.blocks]
  for (const blocks of lists) {
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      const rec = asRecord(block)
      if (asString(rec?.kind) === kind || asString(rec?.type) === kind) return true
    }
  }
  return false
}

function hasReasoning(data: Record<string, unknown>): boolean {
  return hasBlockKind(data, 'reasoning') || hasBlockKind(data, 'thinking')
}

function hasAnswerText(data: Record<string, unknown>): boolean {
  return hasBlockKind(data, 'text')
}

function toolNameOf(node: Record<string, unknown>): string | undefined {
  const data = payloadOf(node)
  const call = asRecord(data.call)
  const root = asRecord(data.root)
  return asString(data.name)
    ?? asString(call?.name)
    ?? asString(root?.name)
    ?? asString(asRecord(root?.call)?.name)
}

function callIdOf(node: Record<string, unknown>): string | undefined {
  const data = payloadOf(node)
  const message = asRecord(data.message)
  const source = asRecord(message?.source)
  const first = Array.isArray(message?.content)
    ? asRecord(message.content[0])
    : Array.isArray(data.content)
      ? asRecord(data.content[0])
      : undefined
  const root = asRecord(data.root)
  return asString(data.callId)
    ?? asString(root?.callId)
    ?? asString(data.id)
    ?? asString(data.toolCallId)
    ?? asString(source?.callId)
    ?? asString(first?.toolCallId)
}

function eventTimeOf(node: Record<string, unknown>): number | undefined {
  const data = payloadOf(node)
  return asNumber(data.time) ?? asNumber(node.time)
}

function toolDurationOf(node: Record<string, unknown>): number | undefined {
  const data = payloadOf(node)
  const explicit = asNumber(data.durationMs)
  if (explicit !== undefined) return explicit
  const time = asNumber(data.time)
  const callTime = asNumber(data.callTime)
  if (time !== undefined && callTime !== undefined && callTime !== null as unknown) return Math.max(0, time - callTime)
  return undefined
}

function isToolKind(kind: string | undefined): boolean {
  return kind === 'tool-call' || kind === 'tool-result'
}

function nestedToolNodes(node: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = asRecord(node.data) ?? {}
  const message = asRecord(data.message)
  const root = asRecord(data.root)
  const lists = [data.blocks, data.content, message?.content, asRecord(data.finalNode)?.blocks]
  const out: Array<Record<string, unknown>> = []
  if (root !== undefined) out.push(root)
  for (const blocks of lists) {
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      const rec = asRecord(block)
      if (rec === undefined) continue
      if (isToolKind(asString(rec.kind) ?? asString(rec.type))) out.push(rec)
    }
  }
  const sub = root?.subCalls
  if (Array.isArray(sub)) {
    for (const child of sub) {
      const rec = asRecord(child)
      if (rec !== undefined) out.push(rec)
    }
  }
  return out
}

function addDefined(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return current
  return (current ?? 0) + next
}

interface Draft {
  turn: number
  question?: string
  wallMs?: number
  ttftMs?: number
  modelMs?: number
  modelCount: number
  planMs?: number
  reasonMs?: number
  answerMs?: number
  tools: Map<string, { name: string; count: number; totalMs?: number }>
  seenCalls: Map<string, { name: string; durationMs?: number; startedAt?: number; endedAt?: number }>
  anon: number
}

function ensure(index: Map<number, Draft>, turn: number): Draft {
  const existing = index.get(turn)
  if (existing !== undefined) return existing
  const created: Draft = { turn, modelCount: 0, tools: new Map(), seenCalls: new Map(), anon: 0 }
  index.set(turn, created)
  return created
}

function addTool(draft: Draft, node: Record<string, unknown>): void {
  const name = toolNameOf(node)
  const id = callIdOf(node) ?? (name !== undefined ? `__anon_${draft.anon++}` : undefined)
  if (id === undefined) return
  const prev = draft.seenCalls.get(id)
  if (prev === undefined && name === undefined) return
  const kind = kindOf(node)
  const startedAt = kind === 'tool-call' ? eventTimeOf(node) : undefined
  const endedAt = kind === 'tool-result' ? eventTimeOf(node) : undefined
  const durationMs = toolDurationOf(node)
  draft.seenCalls.set(id, {
    name: prev?.name || name || id,
    durationMs: prev?.durationMs ?? durationMs,
    startedAt: prev?.startedAt ?? startedAt,
    endedAt: prev?.endedAt ?? endedAt,
  })
}

function addModel(draft: Draft, data: Record<string, unknown>): void {
  draft.modelCount += 1
  draft.modelMs = addDefined(draft.modelMs, modelDurationOf(data))
  draft.planMs = addDefined(draft.planMs, planDurationOf(data))
  draft.reasonMs = addDefined(draft.reasonMs, reasonDurationOf(data))
  draft.answerMs = addDefined(draft.answerMs, answerDurationOf(data))
}

function timingsOf(
  snapshot: unknown,
  top?: Map<number, Timing> | Record<string, Timing>,
): Map<number, Timing> {
  if (top instanceof Map) return top
  if (top !== undefined && typeof top === 'object') {
    const out = new Map<number, Timing>()
    for (const [key, value] of Object.entries(top)) {
      const turn = Number(key)
      if (Number.isFinite(turn)) out.set(turn, value)
    }
    return out
  }
  const root = asRecord(snapshot)
  const legacy = asRecord(root?.legacy)
  const source = legacy?.turnTimings
  if (source instanceof Map) return source as Map<number, Timing>
  if (source !== undefined && typeof source === 'object') {
    const out = new Map<number, Timing>()
    for (const [key, value] of Object.entries(source as Record<string, Timing>)) {
      const turn = Number(key)
      if (Number.isFinite(turn)) out.set(turn, value)
    }
    return out
  }
  return new Map()
}

function finish(draft: Draft): TurnSummary {
  const tools: TurnToolRow[] = []
  for (const entry of draft.seenCalls.values()) {
    const paired = entry.startedAt !== undefined && entry.endedAt !== undefined
      ? Math.max(0, entry.endedAt - entry.startedAt)
      : undefined
    const durationMs = entry.durationMs ?? paired
    const row = draft.tools.get(entry.name) ?? { name: entry.name, count: 0 }
    row.count += 1
    row.totalMs = addDefined(row.totalMs, durationMs)
    draft.tools.set(entry.name, row)
  }
  for (const row of draft.tools.values()) tools.push(row)
  tools.sort((a, b) => (b.totalMs ?? 0) - (a.totalMs ?? 0) || b.count - a.count || a.name.localeCompare(b.name))
  let toolMs: number | undefined
  let toolCount = 0
  for (const row of tools) {
    toolCount += row.count
    toolMs = addDefined(toolMs, row.totalMs)
  }
  const reasonMs = draft.reasonMs
  const modelMs = draft.modelMs
  const planMs = draft.planMs
  const answerMs = draft.answerMs
    ?? (planMs !== undefined
      ? undefined
      : modelMs === undefined
        ? undefined
        : reasonMs === undefined ? modelMs : Math.max(0, modelMs - reasonMs))
  const out: TurnSummary = {
    turn: draft.turn,
    modelCount: draft.modelCount,
    toolCount,
    tools,
  }
  if (draft.question !== undefined && draft.question !== '') out.question = draft.question
  if (draft.wallMs !== undefined) out.wallMs = draft.wallMs
  if (draft.ttftMs !== undefined) out.ttftMs = draft.ttftMs
  if (modelMs !== undefined) out.modelMs = modelMs
  if (planMs !== undefined) out.planMs = planMs
  if (reasonMs !== undefined) out.reasonMs = reasonMs
  if (answerMs !== undefined) out.answerMs = answerMs
  if (toolMs !== undefined) out.toolMs = toolMs
  return out
}

/**
 * Walk a chat snapshot once and index per-turn totals. Nodes without a turn
 * (explicit or inherited from the preceding user/steering message) are dropped.
 */
export function indexTurnSummaries(
  snapshot: unknown,
  topTimings?: Map<number, Timing> | Record<string, Timing>,
): Map<number, TurnSummary> {
  const drafts = new Map<number, Draft>()
  let current: number | undefined
  const runningCalls = asRecord(asRecord(snapshot)?.legacy)?.runningCalls
  if (Array.isArray(runningCalls)) {
    // runningCalls have no order; only attach when they already carry a turn.
    for (const item of runningCalls) {
      const rec = asRecord(item)
      if (rec === undefined) continue
      const turn = explicitTurn(rec, payloadOf(rec))
      if (turn === undefined) continue
      addTool(ensure(drafts, turn), rec)
    }
  }
  for (const node of walkNodes(snapshot)) {
    const kind = kindOf(node)
    const data = payloadOf(node)
    const found = explicitTurn(node, data)
    if (found !== undefined) current = found
    else if (kind === 'user' || kind === 'steering') {
      // opening a turn without a number cannot inherit the previous turn
      current = undefined
    }
    if (current === undefined) continue
    const draft = ensure(drafts, current)
    if (kind === 'user' || kind === 'steering') {
      const text = kind === undefined ? '' : previewOfNode(kind, asRecord(node.data) ?? data)
      if (text !== '') draft.question = text
      continue
    }
    if (isToolKind(kind)) {
      addTool(draft, node)
      for (const nested of nestedToolNodes(node)) addTool(draft, nested)
      continue
    }
    for (const nested of nestedToolNodes(node)) addTool(draft, nested)
    if (kind !== undefined && SKIP_MODEL_KINDS.has(kind)) continue
    const isModel = kind === 'assistant' || kind === 'assistant-step'
    if (!isModel && modelDurationOf(data) === undefined && reasonDurationOf(data) === undefined) continue
    addModel(draft, data)
  }
  const timings = timingsOf(snapshot, topTimings)
  const out = new Map<number, TurnSummary>()
  for (const [turn, draft] of drafts) {
    const timing = timings.get(turn)
    if (timing !== undefined) {
      const start = asNumber(timing.startTime)
      const end = asNumber(timing.endTime)
      if (start !== undefined && end !== undefined) draft.wallMs = Math.max(0, end - start)
      const ttft = asNumber(timing.ttftMs) ?? asNumber(timing.ttft)
      if (ttft !== undefined) draft.ttftMs = ttft
    }
    out.set(turn, finish(draft))
  }
  return out
}

/** Highest engine turn present in the index, if any. */
export function latestTurn(index: ReadonlyMap<number, TurnSummary>): number | undefined {
  let max: number | undefined
  for (const turn of index.keys()) {
    if (max === undefined || turn > max) max = turn
  }
  return max
}
