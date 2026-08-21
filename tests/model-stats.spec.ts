import { describe, expect, it } from 'vitest'
import {
  aggregateModelCalls,
  collectModelSamples,
} from '../src/board/model-stats.ts'

describe('aggregateModelCalls', () => {
  it('does not invent a median from session llmMs', () => {
    const r = aggregateModelCalls([], 18_000)
    expect(r.all.totalMs).toBe(18_000)
    expect(r.all.fallbackSessionTotal).toBe(true)
    expect(r.all.medianMs).toBeUndefined()
    expect(r.all.medianTtftMs).toBeUndefined()
  })

  it('uses sample durations for total, median, and max', () => {
    const r = aggregateModelCalls([
      { durationMs: 10, ttftMs: 2, modelKey: 'a:one' },
      { durationMs: 30, ttftMs: 4, modelKey: 'a:one' },
      { durationMs: 20, modelKey: 'b:two' },
    ])
    expect(r.all.count).toBe(3)
    expect(r.all.totalMs).toBe(60)
    expect(r.all.medianMs).toBe(20)
    expect(r.all.maxMs).toBe(30)
    expect(r.all.medianTtftMs).toBe(3)
    expect(r.all.fallbackSessionTotal).toBe(false)
    expect(r.byModel.map(row => row.label)).toEqual(['a:one', 'b:two'])
    expect(r.byModel[0]).toMatchObject({ count: 2, totalMs: 40, medianMs: 20 })
  })

  it('averages the two middle durations for an even sample', () => {
    const r = aggregateModelCalls([
      { durationMs: 10 },
      { durationMs: 20 },
      { durationMs: 40 },
      { durationMs: 50 },
    ])
    expect(r.all.medianMs).toBe(30)
  })

  it('hides TTFT when no sample has ttftMs', () => {
    const r = aggregateModelCalls([{ durationMs: 12 }])
    expect(r.all.medianTtftMs).toBeUndefined()
  })

  it('does not invent a median when samples lack durationMs even if sessionLlmMs is set', () => {
    const r = aggregateModelCalls([{ modelKey: 'x' }, { modelKey: 'y' }], 9_000)
    expect(r.all.count).toBe(2)
    expect(r.all.totalMs).toBe(9_000)
    expect(r.all.fallbackSessionTotal).toBe(true)
    expect(r.all.medianMs).toBeUndefined()
    expect(r.all.maxMs).toBeUndefined()
  })
})

describe('collectModelSamples', () => {
  it('reads durationMs, elapsedMs, timing.durationMs, ttft, and model fields', () => {
    const nodes = new Map([
      ['a1', { kind: 'assistant', data: { durationMs: 11, ttftMs: 3, model: 'p:m1' } }],
      ['a2', { kind: 'assistant', data: { elapsedMs: 22, firstTokenMs: 5, provider: 'p', modelName: 'm2' } }],
      ['a3', { kind: 'assistant', data: { timing: { durationMs: 33 } } }],
    ])
    expect(collectModelSamples({ order: ['a1', 'a2', 'a3'], nodes })).toEqual([
      { durationMs: 11, ttftMs: 3, modelKey: 'p:m1' },
      { durationMs: 22, ttftMs: 5, modelKey: 'p:m2' },
      { durationMs: 33 },
    ])
  })

  it('skips tool-call nodes even when they carry a duration', () => {
    const nodes = new Map([
      ['t1', { kind: 'tool-call', data: { durationMs: 500, name: 'bash' } }],
      ['r1', { kind: 'tool-result', data: { durationMs: 500, name: 'bash' } }],
      ['a1', { kind: 'assistant', data: { durationMs: 40 } }],
    ])
    expect(collectModelSamples({ order: ['t1', 'r1', 'a1'], nodes })).toEqual([
      { durationMs: 40 },
    ])
  })

  it('derives duration and TTFT from assistant timing start/end when explicit ms is absent', () => {
    const nodes = new Map([
      ['a1', {
        kind: 'assistant',
        data: {
          timing: { stepStartTime: 100, firstTokenTime: 130, completedTime: 250 },
          provenance: { provider: 'openai', model: 'gpt' },
        },
      }],
    ])
    expect(collectModelSamples({ order: ['a1'], nodes })).toEqual([
      { durationMs: 150, ttftMs: 30, modelKey: 'openai:gpt' },
    ])
  })

  it('carries the turn number on assistant samples', () => {
    const nodes = new Map([
      ['a1', { kind: 'assistant', turn: 2, data: { durationMs: 11 } }],
      ['a2', { kind: 'assistant', data: { durationMs: 22 } }],
    ])
    expect(collectModelSamples({ order: ['a1', 'a2'], nodes })).toEqual([
      { durationMs: 11, turn: 2 },
      { durationMs: 22 },
    ])
  })
})
