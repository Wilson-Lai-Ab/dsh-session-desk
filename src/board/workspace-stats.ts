/**
 * Workspace-mode board folds: sum same-cwd sessionStats / tokenUsage without
 * filling missing projection fields with 0.
 */

export interface SessionStats {
  turns?: number
  steps?: number
  llmMs?: number
  toolMs?: number
}

export interface TokenUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  uncachedInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totals?: TokenUsage
}

export interface BoardTokenBuckets {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

export interface WorkspacePeer {
  id: string
  cwd?: string
  projectionValues?: {
    sessionStats?: SessionStats
    tokenUsage?: TokenUsage
  }
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function addDefined(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return current
  return (current ?? 0) + next
}

/** Map a token-usage projection (or totals wrapper) onto board buckets. */
export function readTokenUsage(usage: TokenUsage | undefined): BoardTokenBuckets | undefined {
  if (usage === undefined) return undefined
  const nested = usage.totals ?? usage
  const input = asNumber(nested.input) ?? asNumber(nested.uncachedInputTokens)
  const output = asNumber(nested.output) ?? asNumber(nested.outputTokens)
  const cacheRead = asNumber(nested.cacheRead) ?? asNumber(nested.cacheReadTokens)
  const cacheWrite = asNumber(nested.cacheWrite) ?? asNumber(nested.cacheWriteTokens)
  if (input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) {
    return undefined
  }
  return { input, output, cacheRead, cacheWrite }
}

/**
 * Sum sessionStats across peers. A field is omitted unless at least one peer
 * actually published it — never `?? 0` for a missing key.
 */
export function sumSessionStats(peers: readonly WorkspacePeer[]): SessionStats | undefined {
  let present = false
  const sum: SessionStats = {}
  for (const row of peers) {
    const stats = row.projectionValues?.sessionStats
    if (stats === undefined) continue
    present = true
    sum.turns = addDefined(sum.turns, asNumber(stats.turns))
    sum.steps = addDefined(sum.steps, asNumber(stats.steps))
    sum.llmMs = addDefined(sum.llmMs, asNumber(stats.llmMs))
    sum.toolMs = addDefined(sum.toolMs, asNumber(stats.toolMs))
  }
  return present ? sum : undefined
}

/**
 * Sum tokenUsage across peers. Same rule: only buckets that appeared on at
 * least one peer are defined on the result.
 */
export function sumTokenUsage(peers: readonly WorkspacePeer[]): BoardTokenBuckets | undefined {
  let present = false
  const sum: BoardTokenBuckets = {}
  for (const row of peers) {
    const usage = readTokenUsage(row.projectionValues?.tokenUsage)
    if (usage === undefined) continue
    present = true
    sum.input = addDefined(sum.input, usage.input)
    sum.output = addDefined(sum.output, usage.output)
    sum.cacheRead = addDefined(sum.cacheRead, usage.cacheRead)
    sum.cacheWrite = addDefined(sum.cacheWrite, usage.cacheWrite)
  }
  return present ? sum : undefined
}
