/**
 * Map a tool name onto one of the board's fixed buckets (spec §2.4).
 */

export type ToolBucket =
  | 'skill'
  | 'bash'
  | 'read'
  | 'write'
  | 'search'
  | 'browse'
  | 'vision'
  | 'subagent'
  | 'other'

/** One classified-tool row: call count plus summed pair duration. */
export interface ToolBucketRow {
  bucket: ToolBucket
  count: number
  totalMs?: number
}

const BUCKET_ORDER: readonly ToolBucket[] = [
  'skill',
  'bash',
  'read',
  'write',
  'search',
  'browse',
  'vision',
  'subagent',
  'other',
]

/**
 * Classify a tool name. `web_search` (and other `*_search`) is search, not
 * browse; remaining `web_*` names plus `browser` are browse.
 */
export function classifyTool(name: string): ToolBucket {
  const key = name.trim()
  const lower = key.toLowerCase()
  if (lower.includes('skill')) return 'skill'
  if (lower === 'bash' || lower.startsWith('job_')) return 'bash'
  if (lower === 'read' || lower === 'read_image') return 'read'
  if (lower === 'write' || lower === 'edit') return 'write'
  if (lower === 'grep' || lower === 'glob' || lower === 'web_search' || lower.endsWith('_search')) {
    return 'search'
  }
  if (lower === 'browser' || (lower.startsWith('web_') && !lower.endsWith('_search'))) return 'browse'
  if (lower.startsWith('vision_')) return 'vision'
  if (lower === 'subagent' || lower === 'task' || lower === 'send_message') return 'subagent'
  return 'other'
}

interface ToolNode {
  kind?: string
  data?: unknown
  callId?: unknown
  name?: unknown
  time?: unknown
  callTime?: unknown
  call?: unknown
  durationMs?: unknown
}

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

function walkNodes(snapshot: unknown): ToolNode[] {
  const root = asRecord(snapshot)
  if (root === undefined) return []
  const nodes = root.nodes
  if (nodes instanceof Map) {
    const order = Array.isArray(root.order) ? root.order as readonly string[] : [...nodes.keys()]
    const out: ToolNode[] = []
    for (const key of order) {
      const node = nodes.get(key)
      if (node !== undefined) out.push(node as ToolNode)
    }
    return out
  }
  if (nodes != null && typeof nodes === 'object' && 'get' in nodes && typeof (nodes as { get: unknown }).get === 'function' && Array.isArray(root.order)) {
    const out: ToolNode[] = []
    const store = nodes as { get: (key: string) => unknown }
    for (const key of root.order as readonly string[]) {
      const node = store.get(key)
      if (node !== undefined) out.push(node as ToolNode)
    }
    if (out.length > 0) return out
  }
  if (nodes != null && typeof nodes === 'object' && 'values' in nodes && typeof (nodes as { values: unknown }).values === 'function') {
    return [...(nodes as { values: () => Iterable<ToolNode> }).values()]
  }
  if (Array.isArray(nodes)) return nodes as ToolNode[]
  const legacy = asRecord(root.legacy)
  if (Array.isArray(legacy?.nodes)) return legacy.nodes as ToolNode[]
  return []
}

function toolNameOf(node: ToolNode): string | undefined {
  const data = asRecord(node.data) ?? {}
  const call = asRecord(data.call) ?? asRecord(node.call)
  return asString(data.name)
    ?? asString(call?.name)
    ?? asString(node.name)
}

function callIdOf(node: ToolNode): string | undefined {
  const data = asRecord(node.data) ?? {}
  return asString(data.callId) ?? asString(node.callId)
}

function durationOf(node: ToolNode): number | undefined {
  const data = asRecord(node.data) ?? {}
  const explicit = asNumber(data.durationMs) ?? asNumber(node.durationMs)
  if (explicit !== undefined) return explicit
  const time = asNumber(data.time) ?? asNumber(node.time)
  const callTime = asNumber(data.callTime) ?? asNumber(node.callTime)
  if (time !== undefined && callTime !== undefined) return Math.max(0, time - callTime)
  return undefined
}

function isToolKind(kind: string | undefined): boolean {
  return kind === 'tool-call' || kind === 'tool-result'
}

function flattenToolNodes(snapshot: unknown): ToolNode[] {
  const out: ToolNode[] = []
  const root = asRecord(snapshot)
  const running = asRecord(root)?.legacy
  const runningCalls = asRecord(running)?.runningCalls
  if (Array.isArray(runningCalls)) out.push(...(runningCalls as ToolNode[]))
  for (const node of walkNodes(snapshot)) {
    const kind = node.kind ?? asString(asRecord(node.data)?.kind)
    if (isToolKind(kind)) {
      out.push(node)
      continue
    }
    const data = asRecord(node.data) ?? {}
    const blocks = data.blocks
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        const rec = asRecord(block)
        if (rec !== undefined && isToolKind(asString(rec.kind))) out.push(rec as ToolNode)
      }
    }
  }
  return out
}

/**
 * Count tool-call / result pairs per bucket and sum pair wall time.
 * Assistant / model durations are ignored.
 */
export function collectToolStats(snapshot: unknown): ToolBucketRow[] {
  const seen = new Map<string, { name: string; durationMs?: number }>()
  let anon = 0
  for (const node of flattenToolNodes(snapshot)) {
    const name = toolNameOf(node)
    if (name === undefined) continue
    const id = callIdOf(node) ?? `__anon_${anon++}`
    const prev = seen.get(id) ?? { name }
    const durationMs = durationOf(node)
    seen.set(id, {
      name: prev.name || name,
      durationMs: prev.durationMs ?? durationMs,
    })
  }
  const totals = new Map<ToolBucket, { count: number; totalMs: number; timed: boolean }>()
  for (const entry of seen.values()) {
    const bucket = classifyTool(entry.name)
    const row = totals.get(bucket) ?? { count: 0, totalMs: 0, timed: false }
    row.count += 1
    if (entry.durationMs !== undefined) {
      row.totalMs += entry.durationMs
      row.timed = true
    }
    totals.set(bucket, row)
  }
  const rows: ToolBucketRow[] = []
  for (const bucket of BUCKET_ORDER) {
    const row = totals.get(bucket)
    if (row === undefined) continue
    rows.push(row.timed ? { bucket, count: row.count, totalMs: row.totalMs } : { bucket, count: row.count })
  }
  return rows
}
