import { describe, expect, it } from 'vitest'
import {
  readTokenUsage,
  sumSessionStats,
  sumTokenUsage,
} from '../src/board/workspace-stats.ts'

describe('sumSessionStats', () => {
  it('does not fill missing llmMs/toolMs with 0 when a projection object is present', () => {
    const sum = sumSessionStats([
      { id: 'a', projectionValues: { sessionStats: { turns: 1 } } },
    ])
    expect(sum).toEqual({ turns: 1 })
    expect(sum?.llmMs).toBeUndefined()
    expect(sum?.toolMs).toBeUndefined()
    expect(sum?.steps).toBeUndefined()
  })

  it('sums only fields peers actually contributed', () => {
    const sum = sumSessionStats([
      { id: 'a', projectionValues: { sessionStats: { turns: 1, llmMs: 100 } } },
      { id: 'b', projectionValues: { sessionStats: { turns: 2, toolMs: 40 } } },
      { id: 'c' },
    ])
    expect(sum).toEqual({ turns: 3, llmMs: 100, toolMs: 40 })
    expect(sum?.steps).toBeUndefined()
  })

  it('returns undefined when no peer has sessionStats', () => {
    expect(sumSessionStats([{ id: 'a' }])).toBeUndefined()
  })

  it('keeps explicit zeros', () => {
    const sum = sumSessionStats([
      { id: 'a', projectionValues: { sessionStats: { turns: 0, llmMs: 0 } } },
    ])
    expect(sum).toEqual({ turns: 0, llmMs: 0 })
  })
})

describe('sumTokenUsage', () => {
  it('does not fill missing token fields with 0', () => {
    const sum = sumTokenUsage([
      { id: 'a', projectionValues: { tokenUsage: { outputTokens: 12 } } },
    ])
    expect(sum).toEqual({ output: 12 })
    expect(sum?.input).toBeUndefined()
    expect(sum?.cacheRead).toBeUndefined()
    expect(sum?.cacheWrite).toBeUndefined()
  })

  it('sums only defined buckets across peers', () => {
    const sum = sumTokenUsage([
      { id: 'a', projectionValues: { tokenUsage: { uncachedInputTokens: 3, outputTokens: 1 } } },
      { id: 'b', projectionValues: { tokenUsage: { cacheReadTokens: 7 } } },
    ])
    expect(sum).toEqual({ input: 3, output: 1, cacheRead: 7 })
    expect(sum?.cacheWrite).toBeUndefined()
  })
})

describe('readTokenUsage', () => {
  it('maps provider field names without inventing zeros', () => {
    expect(readTokenUsage({ uncachedInputTokens: 4 })).toEqual({ input: 4 })
    expect(readTokenUsage({})).toBeUndefined()
    expect(readTokenUsage(undefined)).toBeUndefined()
  })
})
