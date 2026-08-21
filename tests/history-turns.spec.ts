import { describe, expect, it } from 'vitest'
import {
  buildTurns,
  currentTurnKey,
  mergeVisibleTurns,
  previewOfNode,
  toHistorySnapshot,
  type HistoryTurn,
} from '../src/history/turns.ts'

function userNode(text: string, turn: number) {
  return {
    kind: 'user',
    data: { content: [{ type: 'text', text }] },
    location: { kind: 'turn', turn: { turn } },
  }
}

function makeTurns(count: number): HistoryTurn[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `u${i + 1}`,
    index: i + 1,
    question: `q${i + 1}`,
    turn: i + 1,
  }))
}

describe('buildTurns', () => {
  it('builds one row per user turn', () => {
    const nodes = new Map([
      ['u1', { kind: 'user', data: { content: [{ type: 'text', text: 'hello' }] }, location: { kind: 'turn', turn: { turn: 1 } } }],
      ['a1', { kind: 'assistant', data: { blocks: [] } }],
    ])
    const turns = buildTurns({ order: ['u1', 'a1'], nodes })
    expect(turns).toHaveLength(1)
    expect(turns[0]!.question).toBe('hello')
  })

  it('includes steering turns and skips assistant-only nodes', () => {
    const nodes = new Map([
      ['s1', { kind: 'steering', data: { content: [{ type: 'text', text: 'steer' }] }, location: { kind: 'turn', turn: { turn: 2 } } }],
      ['a1', { kind: 'assistant', data: { blocks: [{ kind: 'text', text: 'reply' }] } }],
    ])
    const turns = buildTurns({ order: ['s1', 'a1'], nodes })
    expect(turns).toHaveLength(1)
    expect(turns[0]!.question).toBe('steer')
    expect(turns[0]!.turn).toBe(2)
  })

  it('attaches turn start time from legacy timings when present', () => {
    const nodes = new Map([
      ['u1', userNode('timed', 4)],
    ])
    const turns = buildTurns({
      order: ['u1'],
      nodes,
      legacy: { turnTimings: new Map([[4, { startTime: 1_700_000_000_000 }]]) },
    })
    expect(turns[0]!.time).toBe(1_700_000_000_000)
  })

  it('reads nodes from a ChatNodeStore-shaped get() reader, not only Map', () => {
    const byKey = new Map([
      ['u1', userNode('from-store', 1)],
      ['a1', { kind: 'assistant', data: { blocks: [] } }],
    ])
    const store = {
      get(key: string) {
        return byKey.get(key)
      },
      values() {
        return [...byKey.values()]
      },
    }
    const turns = buildTurns(toHistorySnapshot({ order: ['u1', 'a1'], nodes: store }))
    expect(turns).toHaveLength(1)
    expect(turns[0]!.question).toBe('from-store')
  })
})

describe('previewOfNode', () => {
  it('caps previews at 60 characters with an ellipsis', () => {
    const text = 'x'.repeat(61)
    expect(previewOfNode('user', { content: [{ type: 'text', text }] })).toBe(`${'x'.repeat(60)}…`)
    expect(previewOfNode('user', { content: [{ type: 'text', text: 'short' }] })).toBe('short')
  })
})

describe('mergeVisibleTurns', () => {
  it('keeps pinned turns outside the last-N window', () => {
    const turns = makeTurns(10)
    const visible = mergeVisibleTurns(turns, 3, new Set([1]))
    expect(visible.map(row => row.turn)).toEqual([1, 8, 9, 10])
  })

  it('treats limit <= 0 as all, then hard-caps at 120', () => {
    const turns = makeTurns(130)
    const all = mergeVisibleTurns(turns, 0, new Set())
    expect(all).toHaveLength(120)
    expect(all[0]!.turn).toBe(11)
    expect(all.at(-1)!.turn).toBe(130)
  })

  it('hard-caps merged results at 120 even when pins expand the window', () => {
    const turns = makeTurns(200)
    const pins = new Set(Array.from({ length: 30 }, (_, i) => i + 1))
    const visible = mergeVisibleTurns(turns, 110, pins)
    expect(visible).toHaveLength(120)
    expect(visible.some(row => row.turn === 1)).toBe(true)
  })
})

describe('currentTurnKey', () => {
  it('returns null when no chat rows are mounted', () => {
    expect(currentTurnKey(['u1', 'u2'])).toBeNull()
  })
})
