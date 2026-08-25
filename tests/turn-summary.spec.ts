import { describe, expect, it } from 'vitest'
import {
  indexTurnSummaries,
  latestTurn,
  type TurnSummary,
} from '../src/board/turn-summary.ts'

function snap(nodes: Map<string, unknown>, extra?: Record<string, unknown>): unknown {
  return { order: [...nodes.keys()], nodes, ...extra }
}

function summary(index: Map<number, TurnSummary>, turn: number): TurnSummary {
  const row = index.get(turn)
  if (row === undefined) throw new Error(`missing turn ${turn}`)
  return row
}

describe('indexTurnSummaries', () => {
  it('merges same-named tools within one turn and keeps turns isolated', () => {
    const nodes = new Map<string, unknown>([
      ['u1', { kind: 'user', data: { turn: 1 } }],
      ['a1', { kind: 'assistant', data: { turn: 1, durationMs: 100 } }],
      ['c1', { kind: 'tool-call', data: { turn: 1, callId: 'a', name: 'bash', durationMs: 400 } }],
      ['c2', { kind: 'tool-call', data: { turn: 1, callId: 'b', name: 'bash', durationMs: 200 } }],
      ['c3', { kind: 'tool-call', data: { turn: 1, callId: 'c', name: 'edit', durationMs: 50 } }],
      ['u2', { kind: 'user', data: { turn: 2 } }],
      ['a2', { kind: 'assistant', data: { turn: 2, durationMs: 30 } }],
      ['c4', { kind: 'tool-call', data: { turn: 2, callId: 'd', name: 'bash', durationMs: 900 } }],
    ])
    const index = indexTurnSummaries(snap(nodes))
    const t1 = summary(index, 1)
    expect(t1.modelMs).toBe(100)
    expect(t1.modelCount).toBe(1)
    expect(t1.toolCount).toBe(3)
    expect(t1.toolMs).toBe(650)
    expect(t1.question).toBeUndefined()
    expect(t1.tools).toEqual([
      { name: 'bash', count: 2, totalMs: 600 },
      { name: 'edit', count: 1, totalMs: 50 },
    ])
    const t2 = summary(index, 2)
    expect(t2.toolCount).toBe(1)
    expect(t2.toolMs).toBe(900)
    expect(t2.modelMs).toBe(30)
    expect(t2.tools).toEqual([{ name: 'bash', count: 1, totalMs: 900 }])
  })

  it('inherits turn from the preceding user message when later nodes omit turn', () => {
    const nodes = new Map<string, unknown>([
      ['u1', { kind: 'user', location: { kind: 'turn', turn: { turn: 4 } } }],
      ['a1', { kind: 'assistant', data: { durationMs: 12 } }],
      ['c1', { kind: 'tool-call', data: { callId: 'x', name: 'grep', durationMs: 8 } }],
    ])
    const index = indexTurnSummaries(snap(nodes))
    const t4 = summary(index, 4)
    expect(t4.modelMs).toBe(12)
    expect(t4.tools).toEqual([{ name: 'grep', count: 1, totalMs: 8 }])
  })

  it('omits tool totalMs when no call in the turn has a duration', () => {
    const nodes = new Map<string, unknown>([
      ['u1', { kind: 'user', data: { turn: 1 } }],
      ['c1', { kind: 'tool-call', data: { turn: 1, callId: 'a', name: 'bash' } }],
      ['c2', { kind: 'tool-call', data: { turn: 1, callId: 'b', name: 'bash' } }],
    ])
    const t1 = summary(indexTurnSummaries(snap(nodes)), 1)
    expect(t1.toolCount).toBe(2)
    expect(t1.toolMs).toBeUndefined()
    expect(t1.tools).toEqual([{ name: 'bash', count: 2 }])
  })

  it('splits reasoning duration out of the model wall and never mixes tool time into model', () => {
    const nodes = new Map<string, unknown>([
      ['u1', { kind: 'user', data: { turn: 1 } }],
      ['a1', {
        kind: 'assistant',
        data: { turn: 1, durationMs: 80, reasoningMs: 50 },
      }],
      ['c1', { kind: 'tool-call', data: { turn: 1, callId: 'a', name: 'bash', durationMs: 1000 } }],
    ])
    const t1 = summary(indexTurnSummaries(snap(nodes)), 1)
    expect(t1.modelMs).toBe(80)
    expect(t1.reasonMs).toBe(50)
    expect(t1.answerMs).toBe(30)
    expect(t1.toolMs).toBe(1000)
  })

  it('leaves reasonMs unset when reasoning text exists without a duration', () => {
    const nodes = new Map<string, unknown>([
      ['u1', { kind: 'user', data: { turn: 1 } }],
      ['a1', {
        kind: 'assistant',
        data: {
          turn: 1,
          durationMs: 40,
          blocks: [{ kind: 'reasoning', text: 'plan' }],
        },
      }],
    ])
    const t1 = summary(indexTurnSummaries(snap(nodes)), 1)
    expect(t1.reasonMs).toBeUndefined()
    expect(t1.answerMs).toBe(40)
    expect(t1.modelMs).toBe(40)
  })

  it('reads wall clock from turnTimings without inventing 0', () => {
    const timings = new Map([
      [1, { startTime: 1000, endTime: 2500, ttftMs: 120 }],
      [2, { startTime: 3000 }],
    ])
    const nodes = new Map<string, unknown>([
      ['u1', { kind: 'user', data: { turn: 1 } }],
      ['a1', { kind: 'assistant', data: { turn: 1, durationMs: 10 } }],
      ['u2', { kind: 'user', data: { turn: 2 } }],
    ])
    const index = indexTurnSummaries(snap(nodes, { legacy: { turnTimings: timings } }), timings)
    expect(summary(index, 1).wallMs).toBe(1500)
    expect(summary(index, 1).ttftMs).toBe(120)
    expect(summary(index, 2).wallMs).toBeUndefined()
  })

  it('ignores nodes that never attach to a turn', () => {
    const nodes = new Map<string, unknown>([
      ['a1', { kind: 'assistant', data: { durationMs: 99 } }],
      ['c1', { kind: 'tool-call', data: { callId: 'a', name: 'bash', durationMs: 5 } }],
    ])
    expect(indexTurnSummaries(snap(nodes)).size).toBe(0)
  })

  it('attaches in-flight runningCalls that already carry a turn', () => {
    const nodes = new Map<string, unknown>([
      ['u1', { kind: 'user', data: { turn: 3, content: [{ type: 'text', text: 'do it' }] } }],
    ])
    const index = indexTurnSummaries(snap(nodes, {
      legacy: { runningCalls: [{ kind: 'tool-call', data: { turn: 3, callId: 'live', name: 'bash', durationMs: 40 } }] },
    }))
    const t3 = summary(index, 3)
    expect(t3.question).toBe('do it')
    expect(t3.tools).toEqual([{ name: 'bash', count: 1, totalMs: 40 }])
  })

  it('reads live board nodes: assistant-step timing and tool-call root.callTime', () => {
    const nodes = new Map<string, unknown>([
      ['u1', { kind: 'user', data: { turn: 6, content: [{ type: 'text', text: '看看板' }] } }],
      ['a1', {
        kind: 'assistant-step',
        data: {
          turn: 6,
          step: 0,
          time: 2000,
          firstVisibleTime: 1000,
          firstTokenTime: 1300,
          blocks: [{ kind: 'reasoning', text: 'plan' }, { kind: 'text', text: 'ok' }],
          finalNode: {
            kind: 'assistant',
            timing: { stepStartTime: 1000, firstTokenTime: 1300, completedTime: 1800 },
          },
        },
      }],
      ['t1', {
        kind: 'tool-call',
        data: {
          root: {
            kind: 'tool-result',
            callId: 'c-read',
            name: 'read',
            time: 3400,
            callTime: 1000,
            call: { name: 'read', argsRaw: '{}' },
          },
        },
      }],
    ])
    const t6 = summary(indexTurnSummaries(snap(nodes)), 6)
    expect(t6.planMs).toBe(300)
    expect(t6.reasonMs).toBe(500)
    expect(t6.answerMs).toBeUndefined()
    expect(t6.modelMs).toBe(800)
    expect(t6.tools).toEqual([{ name: 'read', count: 1, totalMs: 2400 }])
  })

  it('derives duration from call.time and result.time when callTime is absent', () => {
    const nodes = new Map<string, unknown>([
      ['u1', { kind: 'user', data: { turn: 1 } }],
      ['c1', { kind: 'tool-call', data: { turn: 1, callId: 'a', name: 'read', time: 1000 } }],
      ['r1', { kind: 'tool-result', data: { turn: 1, callId: 'a', time: 3400 } }],
    ])
    expect(summary(indexTurnSummaries(snap(nodes)), 1).tools).toEqual([
      { name: 'read', count: 1, totalMs: 2400 },
    ])
  })

  it('pairs nested type:tool-call id with tool-result toolCallId', () => {
    const nodes = new Map<string, unknown>([
      ['u1', { kind: 'user', data: { turn: 1 } }],
      ['a1', {
        kind: 'assistant',
        data: {
          turn: 1,
          blocks: [{ type: 'tool-call', id: 'call-9', name: 'glob' }],
        },
      }],
      ['r1', {
        kind: 'tool-result',
        data: { turn: 1, message: { source: { callId: 'call-9' }, content: [{ type: 'tool-result', toolCallId: 'call-9' }] }, time: 500 },
      }],
      ['c1', { kind: 'tool-call', data: { turn: 1, callId: 'call-9', name: 'glob', time: 100 } }],
    ])
    expect(summary(indexTurnSummaries(snap(nodes)), 1).tools).toEqual([
      { name: 'glob', count: 1, totalMs: 400 },
    ])
  })

  it('pairs a duration-less tool-call with its result time/callTime', () => {
    const nodes = new Map<string, unknown>([
      ['u1', { kind: 'user', data: { turn: 1 } }],
      ['c1', { kind: 'tool-call', data: { turn: 1, callId: 'a', name: 'grep', time: 1000 } }],
      ['r1', { kind: 'tool-result', data: { turn: 1, callId: 'a', call: { name: 'grep' }, callTime: 1000, time: 1400 } }],
    ])
    expect(summary(indexTurnSummaries(snap(nodes)), 1).tools).toEqual([
      { name: 'grep', count: 1, totalMs: 400 },
    ])
  })

  it('counts nested assistant tool-call blocks', () => {
    const nodes = new Map<string, unknown>([
      ['u1', { kind: 'user', data: { turn: 1 } }],
      ['a1', {
        kind: 'assistant',
        data: {
          turn: 1,
          durationMs: 20,
          blocks: [{ kind: 'tool-call', callId: 'n1', name: 'edit', durationMs: 15 }],
        },
      }],
    ])
    const t1 = summary(indexTurnSummaries(snap(nodes)), 1)
    expect(t1.modelMs).toBe(20)
    expect(t1.tools).toEqual([{ name: 'edit', count: 1, totalMs: 15 }])
  })

  it('keeps mixed timed and untimed same-name tools without filling 0', () => {
    const nodes = new Map<string, unknown>([
      ['u1', { kind: 'user', data: { turn: 1 } }],
      ['c1', { kind: 'tool-call', data: { turn: 1, callId: 'a', name: 'bash', durationMs: 80 } }],
      ['c2', { kind: 'tool-call', data: { turn: 1, callId: 'b', name: 'bash' } }],
    ])
    const t1 = summary(indexTurnSummaries(snap(nodes)), 1)
    expect(t1.toolCount).toBe(2)
    expect(t1.toolMs).toBe(80)
    expect(t1.tools).toEqual([{ name: 'bash', count: 2, totalMs: 80 }])
  })
})

describe('latestTurn', () => {
  it('returns the highest turn key', () => {
    const index = indexTurnSummaries(snap(new Map([
      ['u1', { kind: 'user', data: { turn: 2 } }],
      ['u2', { kind: 'user', data: { turn: 9 } }],
      ['u3', { kind: 'user', data: { turn: 4 } }],
    ])))
    expect(latestTurn(index)).toBe(9)
  })

  it('returns undefined for an empty index', () => {
    expect(latestTurn(new Map())).toBeUndefined()
  })
})
