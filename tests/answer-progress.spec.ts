import { describe, expect, it } from 'vitest'
import {
  PHASES, PHASE_LABELS, CHARS_PER_TOKEN, estimateTokens,
  initialProgressState, startTurn, applyEvent, computeProgress, deriveView,
} from '../src/answer/progress.ts'

const t0 = 1_000_000_000_000
const ev = (type: string, data: Record<string, unknown> = {}, time = t0) => ({ type, seq: 0, time, data })

describe('initialProgressState', () => {
  it('is idle with progress 0', () => {
    const s = initialProgressState()
    expect(s.phase).toBe('idle')
    expect(computeProgress(s)).toBe(0)
  })
})

describe('startTurn', () => {
  it('resets turn state and enters turn phase', () => {
    const s = startTurn({ turn: 3 }, t0)
    expect(s.phase).toBe('turn')
    expect(s.turn).toBe(3)
    expect(s.startedAt).toBe(t0)
    expect(s.progress).toBe(0)
  })
})

describe('think progress', () => {
  it('step/start → think; think grows but caps at 10', () => {
    let s = startTurn({ turn: 1 }, t0)
    s = applyEvent(s, ev('step/start', { turn: 1, step: 0 }), t0)
    expect(s.phase).toBe('think')
    expect(computeProgress(s, t0)).toBe(5)
    expect(computeProgress(s, t0 + 5000)).toBe(7.5)
    expect(computeProgress(s, t0 + 60_000)).toBe(10)
  })
})

describe('stream progress', () => {
  it('text delta estimates tokens and fills monotonically', () => {
    let s = startTurn({ turn: 1 }, t0)
    s = applyEvent(s, ev('step/start', { turn: 1, step: 0 }), t0)
    s = applyEvent(s, ev('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: '你好世界Hello' } }), t0)
    expect(s.phase).toBe('stream')
    expect(s.estOutputTokens).toBe(estimateTokens('你好世界Hello'.length))
    const p = computeProgress(s, t0)
    expect(p).toBeGreaterThan(10)
    expect(p).toBeLessThan(90)
    s = applyEvent(s, ev('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: 'x'.repeat(400) } }), t0 + 100)
    const p2 = computeProgress(s, t0 + 100)
    expect(p2).toBeGreaterThanOrEqual(p)
  })

  it('fills by out/max when maxTokens is known', () => {
    let s = startTurn({ turn: 1 }, t0)
    s = applyEvent(s, ev('step/start', { turn: 1, step: 0 }), t0)
    s = applyEvent(s, ev('request/header', { header: {}, config: { maxTokens: 1000 } }), t0)
    s = applyEvent(s, ev('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: 'x'.repeat(1000) } }), t0)
    // est = 250/1000 = 25% → 10+80*0.25 = 30
    expect(computeProgress(s, t0)).toBe(30)
  })

  it('usage event provides authoritative tokens incl. cache reads/writes', () => {
    let s = startTurn({ turn: 1 }, t0)
    s = applyEvent(s, ev('assistant/chunk', {
      turn: 1, step: 0,
      chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 500, cacheReadTokens: 40, cacheWriteTokens: 10 } },
    }), t0)
    expect(s.usageOutputTokens).toBe(500)
    expect(s.inputTokens).toBe(150)
    const view = deriveView(s, t0)
    expect(view.outputTokens).toBe(500)
    expect(view.hasUsage).toBe(true)
  })
})

describe('tool progress', () => {
  it('tool/call → tool freezes progress; tool/result returns to stream', () => {
    let s = startTurn({ turn: 1 }, t0)
    s = applyEvent(s, ev('step/start', { turn: 1, step: 0 }), t0)
    s = applyEvent(s, ev('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: 'x'.repeat(400) } }), t0)
    const before = computeProgress(s, t0)
    s = applyEvent(s, ev('tool/call', { turn: 1, step: 0, callId: 'c1', name: 'bash', arguments: '{}' }), t0)
    expect(s.phase).toBe('tool')
    expect(s.toolName).toBe('bash')
    const during = computeProgress(s, t0 + 5000)
    expect(during).toBe(before)
    s = applyEvent(s, ev('tool/result', { turn: 1, step: 0, callId: 'c1', message: {} }), t0 + 6000)
    expect(s.phase).toBe('stream')
  })
})

describe('turn end', () => {
  it('turn/end → done 100%; reason.kind passes through', () => {
    let s = startTurn({ turn: 1 }, t0)
    s = applyEvent(s, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }), t0 + 5000)
    expect(s.phase).toBe('done')
    expect(s.endReason).toBe('completed')
    expect(computeProgress(s)).toBe(100)
  })

  it('blocked end is also 100 with kind passed through', () => {
    let s = startTurn({ turn: 2 }, t0)
    s = applyEvent(s, ev('turn/end', { turn: 2, reason: { kind: 'blocked' } }), t0 + 5000)
    expect(s.endReason).toBe('blocked')
    expect(computeProgress(s)).toBe(100)
  })
})

describe('rate EMA', () => {
  it('counts deltas inside a 2s window, ignores cross-request gaps', () => {
    let s = startTurn({ turn: 1 }, t0)
    s = applyEvent(s, ev('step/start', { turn: 1, step: 0 }), t0)
    s = applyEvent(s, ev('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: 'x'.repeat(40) } }), t0)
    expect(s.rate).toBe(0)
    s = applyEvent(s, ev('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: 'x'.repeat(400) } }), t0 + 500)
    expect(s.rate).toBeGreaterThan(150)
    expect(s.rate).toBeLessThan(250)
    const r = s.rate
    s = applyEvent(s, ev('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: 'x'.repeat(400) } }), t0 + 10_000)
    expect(s.rate).toBe(r)
  })
})

describe('idempotence', () => {
  it('non-progress events leave state unchanged', () => {
    let s = startTurn({ turn: 1 }, t0)
    const before = JSON.stringify(s)
    s = applyEvent(s, ev('user/message', { content: 'hi' }), t0)
    s = applyEvent(s, ev('compaction/start', {}), t0)
    s = applyEvent(s, ev('todo/write', { todos: [] }), t0)
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe('labels', () => {
  it('covers every phase', () => {
    for (const p of Object.values(PHASES)) {
      expect(typeof PHASE_LABELS[p]).toBe('string')
      expect((PHASE_LABELS[p] as string).length).toBeGreaterThan(0)
    }
  })
})

describe('estimateTokens', () => {
  it('uses CHARS_PER_TOKEN', () => {
    expect(CHARS_PER_TOKEN).toBe(4)
    expect(estimateTokens(8)).toBe(2)
  })
})
