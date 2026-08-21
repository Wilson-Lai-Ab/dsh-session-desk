/**
 * Collect per-step model-call samples from a chat snapshot and aggregate
 * count / total / median / max / TTFT. Tool durations are never mixed in.
 */

export interface ModelCallSample {
  durationMs?: number
  ttftMs?: number
  modelKey?: string
  turn?: number
}

export interface ModelStatsRow {
  label: string
  count: number
  totalMs?: number
  medianMs?: number
  maxMs?: number
  medianTtftMs?: number
  fallbackSessionTotal: boolean
}

const SKIP_KINDS = new Set([
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
  return asString(node.kind) ?? asString(nested?.kind)
}

function modelKeyOf(data: Record<string, unknown>): string | undefined {
  const direct = asString(data.model)
  if (direct !== undefined) return direct
  const provider = asString(data.provider)
  const modelName = asString(data.modelName)
  if (provider !== undefined && modelName !== undefined) return `${provider}:${modelName}`
  const provenance = asRecord(data.provenance)
  if (provenance !== undefined) {
    const p = asString(provenance.provider)
    const m = asString(provenance.model)
    if (p !== undefined && m !== undefined) return `${p}:${m}`
  }
  const request = asRecord(data.requestConfig)
  if (request !== undefined) {
    const p = asString(request.provider)
    const m = asString(request.model)
    if (p !== undefined && m !== undefined) return `${p}:${m}`
  }
  return undefined
}

function durationOf(data: Record<string, unknown>): number | undefined {
  const timing = asRecord(data.timing)
  const explicit = asNumber(data.durationMs) ?? asNumber(data.elapsedMs) ?? asNumber(timing?.durationMs)
  if (explicit !== undefined) return explicit
  const start = asNumber(timing?.stepStartTime) ?? asNumber(timing?.startTime)
  const end = asNumber(timing?.completedTime) ?? asNumber(timing?.endTime)
  if (start !== undefined && end !== undefined) return Math.max(0, end - start)
  return undefined
}

function ttftOf(data: Record<string, unknown>): number | undefined {
  const timing = asRecord(data.timing)
  const explicit = asNumber(data.ttftMs) ?? asNumber(data.firstTokenMs)
  if (explicit !== undefined) return explicit
  const start = asNumber(timing?.stepStartTime) ?? asNumber(timing?.startTime)
  const first = asNumber(timing?.firstTokenTime) ?? asNumber(timing?.firstTokenMs)
  if (start !== undefined && first !== undefined) return Math.max(0, first - start)
  return undefined
}

function payloadOf(node: Record<string, unknown>): Record<string, unknown> {
  const data = asRecord(node.data)
  if (data === undefined) return node
  return { ...node, ...data }
}

/**
 * Walk chat nodes into model-call samples. Tool-call / tool-result nodes are
 * skipped so tool wall time cannot leak into model stats.
 */
export function collectModelSamples(snapshot: unknown): ModelCallSample[] {
  const samples: ModelCallSample[] = []
  for (const node of walkNodes(snapshot)) {
    const kind = kindOf(node)
    if (kind !== undefined && SKIP_KINDS.has(kind)) continue
    const data = payloadOf(node)
    const durationMs = durationOf(data)
    const ttftMs = ttftOf(data)
    const modelKey = modelKeyOf(data)
    const turn = asNumber(data.turn)
    if (kind !== 'assistant' && durationMs === undefined && ttftMs === undefined && modelKey === undefined) continue
    const sample: ModelCallSample = {}
    if (durationMs !== undefined) sample.durationMs = durationMs
    if (ttftMs !== undefined) sample.ttftMs = ttftMs
    if (modelKey !== undefined) sample.modelKey = modelKey
    if (turn !== undefined) sample.turn = turn
    samples.push(sample)
  }
  return samples
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1]! + sorted[mid]!) / 2
}

function rowOf(
  label: string,
  samples: readonly ModelCallSample[],
  sessionLlmMs?: number,
): ModelStatsRow {
  const durations = samples
    .map(sample => sample.durationMs)
    .filter((value): value is number => value !== undefined)
  const ttfts = samples
    .map(sample => sample.ttftMs)
    .filter((value): value is number => value !== undefined)
  let totalMs: number | undefined
  let fallbackSessionTotal = false
  if (durations.length > 0) {
    totalMs = durations.reduce((sum, value) => sum + value, 0)
  }
  else if (sessionLlmMs !== undefined) {
    totalMs = sessionLlmMs
    fallbackSessionTotal = true
  }
  return {
    label,
    count: samples.length,
    totalMs,
    medianMs: median(durations),
    maxMs: durations.length > 0 ? Math.max(...durations) : undefined,
    medianTtftMs: median(ttfts),
    fallbackSessionTotal,
  }
}

/**
 * Aggregate model-call samples. Median / max / TTFT come only from samples
 * that actually carry those fields — never `total/count` from sessionLlmMs.
 */
export function aggregateModelCalls(
  samples: readonly ModelCallSample[],
  sessionLlmMs?: number,
): { all: ModelStatsRow; byModel: ModelStatsRow[] } {
  const groups = new Map<string, ModelCallSample[]>()
  for (const sample of samples) {
    if (sample.modelKey === undefined) continue
    const list = groups.get(sample.modelKey)
    if (list === undefined) groups.set(sample.modelKey, [sample])
    else list.push(sample)
  }
  return {
    all: rowOf('all', samples, sessionLlmMs),
    byModel: [...groups.entries()].map(([label, group]) => rowOf(label, group)),
  }
}
