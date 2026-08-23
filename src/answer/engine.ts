/**
 * Answer-pet live engine: subscribes to the harness `session/event` feed
 * (the same source the original dsh-answer-pet uses) and folds real
 * per-session progress, trajectory and title through the ported pure
 * modules (progress.ts / trace.ts / meta.ts).
 *
 * Why this exists: the snapshot-only route (fold.ts) read `sessions.list()`
 * rows whose title/openState/running fields are all unpopulated in this
 * harness — so cards showed the raw UUID and a frozen 0%. The live feed is
 * the real data: turn/step edges, assistant/chunk token deltas, session/title
 * and tool/call|result. This engine is what makes titles, non-zero progress,
 * token rates and trajectory actually appear.
 *
 * Zero DSH writes: it only consumes the append feed and serves router data.
 */
import {
  applyEvent,
  deriveView,
  initialProgressState,
  startTurn,
  type Phase,
  type ProgressState,
  type ProgressView,
} from './progress.ts'
import {
  applyTraceEvent,
  deriveTrace,
  initialTraceState,
  startTraceTurn,
  type TraceState,
  type TraceViewItem,
} from './trace.ts'
import { type SessionMeta } from './meta.ts'

/** Events that should trigger an immediate "state changed" poke. */
export const EDGE_TYPES: ReadonlySet<string> = new Set([
  'turn/start', 'step/start', 'tool/call', 'tool/result',
  'tool/code-dispatch-start', 'tool/code-dispatch', 'step/end', 'turn/end',
  'assistant/chunk', 'session/title',
])

/** A session edge pushed out when its status changes. */
export interface AnswerPetEdge {
  type: string
  sessionId: string
  title: string | null
  phase: Phase
  progress: number
}

/** Live status card for one running session. */
export interface AnswerPetRunning {
  id: string
  title: string | null
  view: ProgressView
  trace: TraceViewItem[]
}

/** The full live snapshot served to /answer-pet/state. */
export interface AnswerPetSnapshot {
  /** Most-recently-active session's view (or idle when none). */
  view: ProgressView
  trace: TraceViewItem[]
  /** The active session identity (null when none within the window). */
  session: { id: string; title: string | null; running: boolean } | null
  /** Every running session's card, plus the active one even if briefly idle. */
  running: AnswerPetRunning[]
  active: boolean
}

export interface AnswerPetEngineOptions {
  /** `ctx.on('session/event', cb)` subscription — returns the disposer. */
  on?: (handler: (session: unknown, event: unknown) => void) => () => void
  /** `ctx.effect(() => dispose, label)` lifecycle registration. */
  effect?: (disposer: () => void, label?: string) => void
  /** How long a session without new events stays "active" (ms). */
  activeWindowMs?: number
  /** Clock override for tests. */
  now?: () => number
  /** Optional session store to replay durable logs (ctx.sessions.get). */
  sessions?: { get?: (id: string) => unknown }
  /** Optional initial session ids to hydrate titles from (durable replay). */
  seed?: readonly string[]
}

type EdgeSink = (edge: AnswerPetEdge) => void

/** Public face of the engine. */
export interface AnswerPetEngine {
  /** Snapshot of the live answer-pet view (idle when nothing active). */
  snapshot(now?: number): AnswerPetSnapshot
  /** The currently-active session identity, if within the window. */
  current(): { id: string; title: string | null; running: boolean } | null
  /** Last folded `session/title` for a live session, if any. */
  titleOf(id: string): string | null
  /** Subscribe to state-change edges (returns an unsubscribe). */
  subscribeEdges(sink: EdgeSink): () => void
}

const emptyMeta: SessionMeta = { title: null, running: false }

export function createAnswerPetEngine(opts: AnswerPetEngineOptions): AnswerPetEngine {
  const sessions = new Map<string, ProgressState>()
  const metas = new Map<string, SessionMeta>()
  const traces = new Map<string, TraceState>()
  let lastActiveId: string | null = null
  let lastActiveAt = 0

  const clock = opts.now ?? (() => Date.now())
  const windowMs = opts.activeWindowMs ?? 120_000
  const sinks = new Set<EdgeSink>()

  const touch = (id: string, state: ProgressState, meta: SessionMeta): void => {
    sessions.set(id, state)
    metas.set(id, meta)
    lastActiveId = id
    lastActiveAt = clock()
  }

  const current = (): { id: string; state: ProgressState; meta: SessionMeta; trace: TraceState } | null => {
    if (lastActiveId !== null && clock() - lastActiveAt < windowMs) {
      return {
        id: lastActiveId,
        state: sessions.get(lastActiveId) ?? emptyProgressState(),
        meta: metas.get(lastActiveId) ?? emptyMeta,
        trace: traces.get(lastActiveId) ?? initialTraceState(),
      }
    }
    return null
  }

  const publishEdge = (type: string, id: string, meta: SessionMeta, state: ProgressState): void => {
    const view = deriveView(state, clock())
    for (const sink of sinks) {
      try {
        sink({ type, sessionId: id, title: meta.title, phase: view.phase, progress: view.progress })
      } catch {
        /* a bad consumer must not break the feed */
      }
    }
  }

  const subscribeEdges = (sink: EdgeSink): (() => void) => {
    sinks.add(sink)
    return () => sinks.delete(sink)
  }

  if (typeof opts.on === 'function') {
    const disposer = opts.on((session, event) => {
      if (session === null || typeof session !== 'object') return
      if (event === null || typeof event !== 'object') return
      const id = typeof (session as { id?: unknown }).id === 'string'
        ? (session as { id: string }).id
        : null
      if (id === null) return
      const eventRec = event as { type?: unknown; data?: unknown; seq?: unknown; time?: unknown }
      const eventType = typeof eventRec.type === 'string' ? eventRec.type : ''
      const eventTime = typeof eventRec.time === 'number' ? eventRec.time : clock()

      // Incremental only: never read session.events. Mid-turn attach starts
      // at idle until the next turn/start; live progress stays accurate after that.
      let meta = metas.get(id)
      if (meta === undefined) {
        meta = { title: null, running: false }
        metas.set(id, meta)
      }

      let trace = traces.get(id)
      let state = sessions.get(id)
      if (trace === undefined) {
        trace = initialTraceState()
        traces.set(id, trace)
      }
      if (state === undefined) {
        state = initialProgressState()
        touch(id, state, meta)
      }

      if (eventType === 'turn/start') {
        meta.running = true
        const data = (eventRec.data ?? {}) as { turn?: unknown }
        const fresh = startTurn(data, eventTime)
        trace = startTraceTurn(data, eventTime)
        traces.set(id, trace)
        touch(id, fresh, meta)
        publishEdge('turn/start', id, meta, fresh)
        return
      }
      if (eventType === 'turn/end') {
        meta.running = false
      } else if (eventType === 'session/title' && typeof (eventRec.data as Record<string, unknown> | undefined)?.title === 'string') {
        meta.title = (eventRec.data as { title: string }).title
      }

      const before = state.phase
      const narrow = () => ({
        type: typeof eventRec.type === 'string' ? eventRec.type : undefined,
        data: eventRec.data !== null && typeof eventRec.data === 'object'
          ? (eventRec.data as Record<string, unknown>)
          : undefined,
      }) as { type?: string; data?: Record<string, unknown> }
      applyEvent(state, narrow(), eventTime)
      applyTraceEvent(trace, narrow(), eventTime)
      if (state.phase !== before || eventType === 'assistant/chunk') {
        // Route through touch so the active-id follows the busiest session.
        touch(id, state, meta)
      }
      if (EDGE_TYPES.has(eventType)) publishEdge(eventType, id, meta, state)
    })
    if (typeof opts.effect === 'function') {
      opts.effect(disposer, 'dsh-session-desk: answer-pet event engine')
    }
  }

  const runningCards = (now: number): AnswerPetRunning[] => {
    const out: AnswerPetRunning[] = []
    for (const [id, state] of sessions) {
      const meta = metas.get(id) ?? emptyMeta
      if (meta.running !== true) continue
      out.push({
        id,
        title: meta.title,
        view: deriveView(state, now),
        trace: deriveTrace(traces.get(id) ?? initialTraceState(), now),
      })
    }
    return out
  }

  const snapshot = (now = clock()): AnswerPetSnapshot => {
    const cur = current()
    const active = cur !== null
    const view = cur !== null ? deriveView(cur.state, now) : deriveView(emptyProgressState(), now)
    const trace = cur !== null ? deriveTrace(cur.trace, now) : deriveTrace(initialTraceState(), now)
    const session = cur !== null ? { id: cur.id, title: cur.meta.title, running: cur.meta.running } : null
    return {
      view,
      trace,
      session,
      running: runningCards(now),
      active,
    }
  }

  const titleOf = (id: string): string | null => metas.get(id)?.title ?? null

  return {
    snapshot,
    current: () => {
      const cur = current()
      return cur !== null ? { id: cur.id, title: cur.meta.title, running: cur.meta.running } : null
    },
    titleOf,
    subscribeEdges,
  }
}

function emptyProgressState(): ProgressState {
  return initialProgressState()
}