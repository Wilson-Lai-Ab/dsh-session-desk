/**
 * Answer-pet live engine tests: the engine subscribes to a `session/event`
 * feed and folds REAL titles / progress / trajectory from the actual event
 * vocabulary (turn/step edges, assistant/chunk token deltas, session/title,
 * tool/call|result) — the path that produces non-zero progress and friendly
 * titles (the former snapshot-only route could not).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createAnswerPetEngine, type AnswerPetEngine } from '../src/answer/engine.ts'

interface FakeFeed {
  engine: AnswerPetEngine
  emit(sessionId: string, event: Record<string, unknown>): void
  dispose: () => void
}

function mount(): FakeFeed {
  let handler: ((session: unknown, event: unknown) => void) | null = null
  let t = 10_000
  const sessionsMap = new Map<string, { id: string; events: Record<string, unknown>[] }>()
  const engine = createAnswerPetEngine({
    on: (h) => {
      handler = h
      return () => { handler = null }
    },
    sessions: {
      get: (id: string) => sessionsMap.get(id),
    },
    now: () => t,
  })
  const emit = (sessionId: string, event: Record<string, unknown>) => {
    const rec = sessionsMap.get(sessionId) ?? { id: sessionId, events: [] }
    sessionsMap.set(sessionId, rec)
    rec.events.push(event)
    if (typeof event.time === 'number') t = event.time
    handler?.(rec, { ...event, seq: rec.events.length })
  }
  return { engine, emit, dispose: () => { handler = null } }
}

describe('answer-pet engine', () => {
  beforeEach(() => {})

  it('folds session/title into a friendly title and exposes it as active', () => {
    const { engine, emit } = mount()
    const sessionId = 'session-abc'
    emit(sessionId, { type: 'session/title', data: { title: '调研插件核心实现' }, time: 10_000 })
    emit(sessionId, { type: 'turn/start', data: { turn: 1 }, time: 10_000 })
    emit(sessionId, { type: 'step/start', data: { step: 1 }, time: 10_100 })
    const snap = engine.snapshot(10_200)
    expect(snap.active).toBe(true)
    expect(snap.session?.title).toBe('调研插件核心实现')
    expect(snap.view.phase).toBe('think')
  })

  it('yields non-zero progress from assistant/chunk token deltas', () => {
    const { engine, emit } = mount()
    emit('main', { type: 'session/title', data: { title: '回答中会话' }, time: 10_000 })
    emit('main', { type: 'turn/start', data: { turn: 1 }, time: 10_000 })
    emit('main', { type: 'step/start', data: { step: 1 }, time: 10_000 })
    // streaming text-delta chunks
    for (let i = 0; i < 5; i++) {
      emit('main', { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '你好世界你好世界' } }, time: 10_000 + i })
    }
    const snap = engine.snapshot(10_100)
    expect(snap.view.phase).toBe('stream')
    expect(snap.view.outputTokens).toBeGreaterThan(0)
    expect(snap.view.chunkCount).toBe(5)
    // stream phase should report progress above idle's frozen 0
    expect(snap.view.progress).toBeGreaterThan(0)
  })

  it('runs a tool phase and records toolCount + trajectory', () => {
    const { engine, emit } = mount()
    emit('main', { type: 'turn/start', data: { turn: 1 }, time: 10_000 })
    emit('main', { type: 'tool/call', data: { name: 'bash', callId: 'c1' }, time: 10_000 })
    const during = engine.snapshot(10_100)
    expect(during.view.phase).toBe('tool')
    expect(during.view.toolName).toBe('bash')
    expect(during.view.toolCount).toBe(1)
    emit('main', { type: 'tool/result', data: { callId: 'c1' }, time: 10_200 })
    const after = engine.snapshot(10_300)
    expect(after.trace.some((item) => item?.label === '调用 bash')).toBe(true)
  })

  it('exposes only running sessions in the running list (idle excluded)', () => {
    const { engine, emit } = mount()
    emit('run-a', { type: 'session/title', data: { title: '活跃A' }, time: 10_000 })
    emit('run-a', { type: 'turn/start', data: { turn: 1 }, time: 10_000 })
    emit('run-b', { type: 'session/title', data: { title: '待命B' }, time: 10_000 })
    const snap = engine.snapshot(10_500)
    const ids = snap.running.map((card) => card.id)
    expect(ids).toContain('run-a')
    expect(ids).not.toContain('run-b')
  })

  it('emits state-change edges on turn/start through subscribeEdges', () => {
    const { engine, emit } = mount()
    const edges: string[] = []
    engine.subscribeEdges((edge) => edges.push(`${edge.type}:${edge.phase}`))
    emit('main', { type: 'turn/start', data: { turn: 1 }, time: 10_000 })
    emit('main', { type: 'step/start', data: { step: 1 }, time: 10_100 })
    expect(edges).toContain('turn/start:turn')
  })
})
