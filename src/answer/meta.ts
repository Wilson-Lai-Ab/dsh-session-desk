/**
 * Session metadata folding.
 *
 * Ported byte-faithfully from dsh-answer-pet `session-meta.mjs` (MIT, Nanki-nn)
 * into TypeScript. Derives `{ title, running }` from a session's event log.
 * Zero host dependencies; unit-testable.
 *
 * - title: `session/title` event `data.title` (last-wins fold).
 * - running: turn-edge fold — the last turn boundary in the seed log decides
 *   the initial running state; incremental transitions are the host's job.
 */

export interface SessionMeta {
  title: string | null
  running: boolean
}

export function foldSessionMeta(events: unknown): SessionMeta {
  let title: string | null = null
  let running = false
  if (Array.isArray(events)) {
    for (const e of events) {
      if (e === null || typeof e !== 'object') continue
      const rec = e as Record<string, unknown>
      if (rec.type === 'session/title' && typeof (rec.data as Record<string, unknown> | undefined)?.title === 'string') {
        title = (rec.data as { title: string }).title
      } else if (rec.type === 'turn/start') {
        running = true
      } else if (rec.type === 'turn/end') {
        running = false
      }
    }
  }
  return { title, running }
}
