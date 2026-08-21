/**
 * Answer-progress derivation pure logic.
 *
 * Ported byte-faithfully from dsh-answer-pet `progress.mjs` (MIT, Nanki-nn)
 * into TypeScript. Folds session events into an answer-progress state machine.
 * Zero host dependencies; unit-testable.
 *
 * Phases: idle → turn(开始处理) → think(思考) → stream(输出) ⇄ tool(工具) →
 * done(完成)/error.
 *
 * Progress model (hybrid): phase weights + token fill.
 * - Authoritative tokens come from assistant/chunk `usage`; during streaming we
 *   estimate by text length / 4 (mixed zh/en heuristic).
 * - With maxTokens: out/max linear fill (10%→90%). Without: saturating curve
 *   1-exp(-out/600) so progress never stalls.
 * - Monotone non-decreasing within a turn; tool freezes current progress.
 * - done = 100, error/idle = 0.
 */
export const PHASES = {
  IDLE: 'idle', TURN: 'turn', THINK: 'think', STREAM: 'stream',
  TOOL: 'tool', DONE: 'done', ERROR: 'error',
} as const
export type Phase = typeof PHASES[keyof typeof PHASES]

export const PHASE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  idle: '待命', turn: '开始处理', think: '思考中', stream: '回答中',
  tool: '使用工具', done: '完成', error: '出错',
})

/** 4 chars ≈ 1 token (mixed zh/en heuristic; usage overrides once known). */
export const CHARS_PER_TOKEN = 4

export function estimateTokens(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN)
}

/** Empty progress state (idle baseline). */
export interface ProgressState {
  phase: Phase
  turn: number | null
  step: number | null
  inputTokens: number
  usageOutputTokens: number | null
  estOutputTokens: number
  reasoningChars: number
  textChars: number
  chunkCount: number
  toolName: string | null
  toolCount: number
  startedAt: number | null
  firstChunkAt: number | null
  endedAt: number | null
  endReason: string | null
  maxTokens: number | null
  rate: number
  lastChunkAt: number | null
  textSnippet: string
  progress: number
}

export function initialProgressState(): ProgressState {
  return {
    phase: PHASES.IDLE,
    turn: null,
    step: null,
    inputTokens: 0,
    usageOutputTokens: null,
    estOutputTokens: 0,
    reasoningChars: 0,
    textChars: 0,
    chunkCount: 0,
    toolName: null,
    toolCount: 0,
    startedAt: null,
    firstChunkAt: null,
    endedAt: null,
    endReason: null,
    maxTokens: null,
    rate: 0,
    lastChunkAt: null,
    textSnippet: '',
    progress: 0,
  }
}

/** Start a new turn: reset the turn-scoped state. */
export function startTurn(data: { turn?: unknown } | undefined, now = Date.now()): ProgressState {
  const next = initialProgressState()
  next.phase = PHASES.TURN
  next.turn = typeof data?.turn === 'number' ? data.turn : null
  next.startedAt = now
  return next
}

/**
 * Apply one session event to the progress state (mutates in place, returns the
 * same object so the caller can compare phase changes). Non-progress events
 * leave it untouched (idempotent).
 */
export function applyEvent(state: ProgressState, event: { type?: string; data?: Record<string, unknown> } | null | undefined, now = Date.now()): ProgressState {
  const type = event?.type
  const data = event?.data ?? {}
  switch (type) {
    case 'step/start': {
      state.phase = PHASES.THINK
      state.step = typeof data.step === 'number' ? data.step : state.step
      state.toolName = null
      break
    }
    case 'request/header': {
      const m = (data?.config as Record<string, unknown> | undefined)?.maxTokens
      if (typeof m === 'number' && m > 0) state.maxTokens = m
      break
    }
    case 'assistant/chunk': {
      const chunk = (data?.chunk ?? {}) as Record<string, unknown>
      state.chunkCount += 1
      const chunkType = chunk.type
      let added = 0
      if (chunkType === 'text-delta') {
        const len = typeof chunk.text === 'string' ? chunk.text.length : 0
        state.textChars += len
        added = estimateTokens(len)
        state.estOutputTokens += added
        if (len > 0) state.textSnippet = (state.textSnippet + chunk.text).slice(-64)
      } else if (chunkType === 'reasoning-delta') {
        const len = typeof chunk.text === 'string' ? chunk.text.length : 0
        state.reasoningChars += len
        added = estimateTokens(len)
        state.estOutputTokens += added
      } else if (chunkType === 'usage') {
        const u = (chunk.usage ?? {}) as Record<string, unknown>
        if (typeof u.outputTokens === 'number') state.usageOutputTokens = u.outputTokens
        if (typeof u.inputTokens === 'number') state.inputTokens = u.inputTokens
        if (typeof u.cacheReadTokens === 'number') state.inputTokens += u.cacheReadTokens
        if (typeof u.cacheWriteTokens === 'number') state.inputTokens += u.cacheWriteTokens
      }
      if (state.phase === PHASES.THINK || state.phase === PHASES.TURN) {
        state.phase = PHASES.STREAM
        state.firstChunkAt = state.firstChunkAt ?? now
      }
      if (added > 0) {
        const dt = now - (state.lastChunkAt ?? now)
        if (dt > 0 && dt < 2000) {
          const inst = (added / dt) * 1000
          state.rate = state.rate === 0 ? inst : state.rate * 0.7 + inst * 0.3
        }
        state.lastChunkAt = now
      }
      break
    }
    case 'tool/call': {
      state.phase = PHASES.TOOL
      state.toolName = typeof data.name === 'string' ? data.name : state.toolName
      state.toolCount += 1
      break
    }
    case 'tool/result': {
      if (state.phase === PHASES.TOOL) state.phase = PHASES.STREAM
      state.toolName = null
      break
    }
    case 'step/end': {
      if (state.phase !== PHASES.TOOL) state.phase = PHASES.THINK
      break
    }
    case 'turn/end': {
      state.phase = PHASES.DONE
      state.endedAt = now
      state.endReason = typeof (data?.reason as Record<string, unknown> | undefined)?.kind === 'string'
        ? (data?.reason as { kind: string }).kind
        : 'completed'
      state.step = null
      break
    }
    default:
      break
  }
  return state
}

/**
 * Compute the progress percentage (0–100) and write it back. Monotone
 * non-decreasing within a turn (tool freezes; done=100, error/idle=0).
 */
export function computeProgress(state: ProgressState, now = Date.now()): number {
  if (state.phase === PHASES.DONE) {
    state.progress = 100
    return 100
  }
  if (state.phase === PHASES.ERROR || state.phase === PHASES.IDLE) {
    state.progress = 0
    return 0
  }
  let target: number
  switch (state.phase) {
    case PHASES.TURN:
      target = 2
      break
    case PHASES.THINK: {
      const s = state.startedAt !== null ? Math.max(0, now - state.startedAt) / 1000 : 0
      target = Math.min(10, 5 + s * 0.5)
      break
    }
    case PHASES.STREAM: {
      const out = state.usageOutputTokens ?? state.estOutputTokens
      const max = state.maxTokens
      const fill = max !== null && max > 0
        ? Math.min(1, out / max)
        : 1 - Math.exp(-out / 600)
      target = 10 + 80 * fill
      break
    }
    case PHASES.TOOL:
      target = state.progress
      break
    default:
      target = 0
  }
  const result = Math.max(state.progress, target)
  state.progress = result
  return result
}

/** Derived /state view (serialized to the client; client reads, does not interpret). */
export interface ProgressView {
  phase: Phase
  label: string
  progress: number
  outputTokens: number
  inputTokens: number
  reasoningTokens: number
  hasUsage: boolean
  rateTokS: number
  elapsedMs: number
  chunkCount: number
  toolName: string | null
  toolCount: number
  turn: number | null
  step: number | null
  maxTokens: number | null
  textSnippet: string
  endReason: string | null
}

export function deriveView(state: ProgressState, now = Date.now()): ProgressView {
  const progress = computeProgress(state, now)
  const outTokens = state.usageOutputTokens ?? state.estOutputTokens
  const elapsedMs = state.startedAt !== null ? Math.max(0, now - state.startedAt) : 0
  return {
    phase: state.phase,
    label: PHASE_LABELS[state.phase] ?? state.phase,
    progress: Math.round(progress * 10) / 10,
    outputTokens: outTokens,
    inputTokens: state.inputTokens,
    reasoningTokens: estimateTokens(state.reasoningChars),
    hasUsage: state.usageOutputTokens !== null,
    rateTokS: Math.round(state.rate),
    elapsedMs,
    chunkCount: state.chunkCount,
    toolName: state.toolName,
    toolCount: state.toolCount,
    turn: state.turn,
    step: state.step,
    maxTokens: state.maxTokens,
    textSnippet: state.textSnippet,
    endReason: state.endReason,
  }
}
