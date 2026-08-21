import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSessionDrag, registerSessionDragWatchers } from '../src/client/trash/drag-detect.ts'

type Listener = (event: unknown) => void

interface RegisteredListener {
  type: string
  handler: Listener
  capture: boolean
}

/**
 * Fake document that records listener registration. Used to pin the phase
 * contract of registerSessionDragWatchers — the regression that broke the
 * trash fly-in (a document-CAPTURE dragstart listener runs before the host's
 * row onDragStart populates the DataTransfer, so the session drag was never
 * recognized; the listener must be bubble-phase).
 */
function stubDocument(): { calls: RegisteredListener[] } {
  const calls: RegisteredListener[] = []
  const addEventListener = vi.fn((type: string, handler: Listener, capture = false) => {
    calls.push({ type, handler, capture })
  })
  const removeEventListener = vi.fn((type: string, handler: Listener, capture = false) => {
    const idx = calls.findIndex(c => c.type === type && c.handler === handler && c.capture === capture)
    if (idx >= 0) calls.splice(idx, 1)
  })
  vi.stubGlobal('document', { addEventListener, removeEventListener })
  return { calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isSessionDrag', () => {
  it('detects the host session drag signal (move + text/plain)', () => {
    expect(isSessionDrag({ effectAllowed: 'move', types: ['text/plain'] })).toBe(true)
  })

  it('rejects text-selection drags (copyMove)', () => {
    expect(isSessionDrag({ effectAllowed: 'copyMove', types: ['text/plain'] })).toBe(false)
  })

  it('rejects file drags', () => {
    expect(isSessionDrag({ effectAllowed: 'copy', types: ['Files'] })).toBe(false)
  })

  it('rejects move without a text/plain payload', () => {
    expect(isSessionDrag({ effectAllowed: 'move', types: [] })).toBe(false)
  })

  it('rejects null / undefined', () => {
    expect(isSessionDrag(null)).toBe(false)
    expect(isSessionDrag(undefined)).toBe(false)
  })
})

describe('registerSessionDragWatchers', () => {
  it('registers dragstart in the BUBBLE phase so it runs after the host row handler populates the DataTransfer', () => {
    const { calls } = stubDocument()
    const dispose = registerSessionDragWatchers({ onDragStart: () => {}, onDragEnd: () => {} })
    const dragstart = calls.find(c => c.type === 'dragstart')
    // Regression guard: a document-capture listener fires before the host's own
    // onDragStart (which sets effectAllowed='move' + text/plain), so it sees an
    // empty DataTransfer and the session drag is never recognized.
    expect(dragstart).toBeDefined()
    expect(dragstart?.capture).toBe(false)
    dispose()
    expect(calls.find(c => c.type === 'dragstart')).toBeUndefined()
  })

  it('registers dragend and removes both listeners symmetrically on dispose', () => {
    const { calls } = stubDocument()
    const dispose = registerSessionDragWatchers({ onDragStart: () => {}, onDragEnd: () => {} })
    expect(calls.find(c => c.type === 'dragend')?.capture).toBe(true)
    dispose()
    expect(calls).toEqual([])
  })
})
