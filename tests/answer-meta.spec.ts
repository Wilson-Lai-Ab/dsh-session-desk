import { describe, expect, it } from 'vitest'
import { foldSessionMeta } from '../src/answer/meta.ts'

const ev = (type: string, data: Record<string, unknown> = {}) => ({ type, seq: 0, time: 0, data })

describe('foldSessionMeta', () => {
  it('no events → title null, running false', () => {
    const m = foldSessionMeta([])
    expect(m.title).toBeNull()
    expect(m.running).toBe(false)
  })

  it('session/title last-wins', () => {
    const m = foldSessionMeta([
      ev('session/title', { title: '旧标题' }),
      ev('session/title', { title: '新标题' }),
    ])
    expect(m.title).toBe('新标题')
  })

  it('open turn in seed → running true', () => {
    const m = foldSessionMeta([
      ev('turn/start', { turn: 1 }),
      ev('step/start', { turn: 1, step: 0 }),
      ev('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: 'x' } }),
    ])
    expect(m.running).toBe(true)
  })

  it('closed turns → running false', () => {
    const m = foldSessionMeta([
      ev('turn/start', { turn: 1 }),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
      ev('turn/start', { turn: 2 }),
      ev('turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ])
    expect(m.running).toBe(false)
  })

  it('tolerates junk (null / non-object / missing data)', () => {
    const m = foldSessionMeta([null, 'junk', ev('session/title', {}), ev('turn/end', undefined)])
    expect(m.title).toBeNull()
    expect(m.running).toBe(false)
  })
})
