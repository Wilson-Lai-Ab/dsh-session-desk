import { describe, expect, it } from 'vitest'
import {
  MAX_TRACE_ITEMS, initialTraceState, startTraceTurn,
  applyTraceEvent, deriveTrace, foldTrace, summarizeToolArguments,
} from '../src/answer/trace.ts'

const t0 = 1_700_000_000_000
const ev = (type: string, data: Record<string, unknown> = {}, time = t0) => ({ type, seq: 0, time, data })

describe('phase folding', () => {
  it('folds step/reason/answer without duplicating chunks', () => {
    const s = startTraceTurn({ turn: 1 }, t0)
    applyTraceEvent(s, ev('step/start', { turn: 1, step: 0 }, t0 + 10), t0 + 10)
    applyTraceEvent(s, ev('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'reasoning-delta', text: 'a' } }, t0 + 20), t0 + 20)
    applyTraceEvent(s, ev('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'reasoning-delta', text: 'b' } }, t0 + 30), t0 + 30)
    applyTraceEvent(s, ev('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', text: 'answer' } }, t0 + 40), t0 + 40)
    const trace = deriveTrace(s, t0 + 50)
    expect(trace.map(i => i.label)).toEqual(['开始处理请求', '分析任务', '推理与规划', '组织回答'])
    expect(trace.at(-1)?.status).toBe('running')
    expect(trace.at(-2)?.status).toBe('done')
  })
})

describe('tool calls', () => {
  it('shows tool name and safe detail; result updates status and duration', () => {
    const s = startTraceTurn({ turn: 1 }, t0)
    applyTraceEvent(s, ev('tool/call', {
      turn: 1, step: 0, callId: 'c1', name: 'grep',
      arguments: JSON.stringify({ pattern: 'SessionEvent', command: 'secret-token' }),
    }, t0 + 100), t0 + 100)
    let trace = deriveTrace(s, t0 + 600)
    expect(trace.at(-1)?.label).toBe('调用 grep')
    expect(trace.at(-1)?.detail).toBe('SessionEvent')
    expect(trace.at(-1)?.status).toBe('running')
    expect(JSON.stringify(trace).includes('secret-token')).toBe(false)

    applyTraceEvent(s, ev('tool/result', { callId: 'c1', message: {} }, t0 + 1100), t0 + 1100)
    trace = deriveTrace(s, t0 + 1200)
    expect(trace.at(-1)?.status).toBe('done')
    expect(trace.at(-1)?.durationMs).toBe(1000)
  })

  it('pairs tool failure and nested code dispatch', () => {
    const s = initialTraceState()
    applyTraceEvent(s, ev('tool/code-dispatch-start', {
      subCallId: 'sub1', name: 'read', arguments: { file_path: 'src/app.mjs' },
    }, t0), t0)
    applyTraceEvent(s, ev('tool/code-dispatch', { subCallId: 'sub1', isError: true }, t0 + 50), t0 + 50)
    const item = deriveTrace(s, t0 + 100).at(-1)
    expect(item?.label).toBe('调用 read')
    expect(item?.detail).toBe('src/app.mjs')
    expect(item?.status).toBe('error')
  })
})

describe('summary privacy', () => {
  it('reads only whitelisted fields and truncates', () => {
    expect(summarizeToolArguments('{"command":"rm -rf /"}')).toBeNull()
    expect(summarizeToolArguments({ description: '执行测试', command: 'hidden' })).toBe('执行测试')
    expect(summarizeToolArguments({ query: 'x'.repeat(200) })?.endsWith('…')).toBe(true)
  })
})

describe('bounded length', () => {
  it('keeps at most MAX_TRACE_ITEMS items', () => {
    const s = startTraceTurn({ turn: 1 }, t0)
    for (let step = 0; step < 10; step += 1) {
      applyTraceEvent(s, ev('step/start', { turn: 1, step }, t0 + step + 1), t0 + step + 1)
    }
    expect(deriveTrace(s, t0 + 20).length).toBe(MAX_TRACE_ITEMS)
  })
})

describe('foldTrace', () => {
  it('recovers the current trajectory from history events', () => {
    const events = [
      ev('turn/start', { turn: 2 }, t0),
      ev('step/start', { turn: 2, step: 0 }, t0 + 10),
      ev('tool/call', { turn: 2, step: 0, callId: 'c2', name: 'web_search', arguments: '{"query":"DSH"}' }, t0 + 20),
    ]
    const trace = deriveTrace(foldTrace(events, t0 + 30), t0 + 30)
    expect(trace.at(-1)?.label).toBe('调用 web_search')
    expect(trace.at(-1)?.status).toBe('running')
  })
})
