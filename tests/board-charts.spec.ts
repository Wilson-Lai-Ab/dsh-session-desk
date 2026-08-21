import { describe, expect, it } from 'vitest'
import { perTurnCallCounts, tokenSegments } from '../src/board/chart-data.ts'

describe('perTurnCallCounts', () => {
  it('counts samples per turn, dropping turn-less samples, sorted by turn', () => {
    expect(perTurnCallCounts([
      { turn: 3 }, { turn: 1 }, { turn: 3 }, { durationMs: 5 }, { turn: 2 },
    ])).toEqual([
      { turn: 1, calls: 1 },
      { turn: 2, calls: 1 },
      { turn: 3, calls: 2 },
    ])
  })

  it('returns [] when no sample carries a turn', () => {
    expect(perTurnCallCounts([{ durationMs: 1 }])).toEqual([])
  })
})

describe('tokenSegments', () => {
  it('keeps only non-zero buckets in fixed order', () => {
    expect(tokenSegments({ input: 10, output: 0, cacheRead: 5 }))
      .toEqual([{ key: 'input', value: 10 }, { key: 'cacheRead', value: 5 }])
  })

  it('returns [] for undefined', () => {
    expect(tokenSegments(undefined)).toEqual([])
  })
})
