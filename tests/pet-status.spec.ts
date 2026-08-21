import { describe, expect, it } from 'vitest'
import {
  activityOf,
  aggregatePetKind,
  clampPetPosition,
  completedRows,
  defaultPetPosition,
  foldPetList,
  foldPetRows,
  idlePhraseIndex,
  isSubagentRow,
  petKindOf,
  resolvePetImage,
  sessionKindFromRow,
  subagentDetailRows,
  toolOf,
} from '../src/client/pet/status.ts'
import { WHALE_SVG } from '../src/client/pet/whale.ts'

describe('petKindOf', () => {
  it('maps streaming / running / generating to running (case-insensitive exact)', () => {
    expect(petKindOf('streaming')).toBe('running')
    expect(petKindOf('Running')).toBe('running')
    expect(petKindOf('GENERATING')).toBe('running')
  })

  it('maps error / failed to error', () => {
    expect(petKindOf('error')).toBe('error')
    expect(petKindOf('FAILED')).toBe('error')
  })

  it('maps only awaiting_input / needs_permission / blocked to awaiting', () => {
    expect(petKindOf('awaiting_input')).toBe('awaiting')
    expect(petKindOf('Needs_Permission')).toBe('awaiting')
    expect(petKindOf('BLOCKED')).toBe('awaiting')
  })

  it('treats idle / streaming-adjacent / tool-running / thinking as idle, not awaiting', () => {
    expect(petKindOf(undefined)).toBe('idle')
    expect(petKindOf('')).toBe('idle')
    expect(petKindOf('idle')).toBe('idle')
    expect(petKindOf('open')).toBe('idle')
    expect(petKindOf('tool-running')).toBe('idle')
    expect(petKindOf('tool_running')).toBe('idle')
    expect(petKindOf('thinking')).toBe('idle')
    expect(petKindOf('awaiting')).toBe('idle')
  })

  it('does not treat chat text containing 「确认」 as awaiting', () => {
    expect(petKindOf('请确认后再继续')).toBe('idle')
    expect(petKindOf('确认')).toBe('idle')
    expect(petKindOf('idle')).toBe('idle')
    expect(petKindOf('streaming')).not.toBe('awaiting')
  })
})

describe('sessionKindFromRow', () => {
  it('prefers openState when present', () => {
    expect(sessionKindFromRow({ openState: 'awaiting_input', running: true })).toBe('awaiting')
    expect(sessionKindFromRow({ openState: 'streaming' })).toBe('running')
  })

  it('maps pendingInteraction to awaiting without scanning chat text', () => {
    expect(sessionKindFromRow({ pendingInteraction: 'approval' })).toBe('awaiting')
    expect(sessionKindFromRow({ pendingInteraction: 'question', title: '请确认' })).toBe('awaiting')
    expect(sessionKindFromRow({ title: '请确认' })).toBe('idle')
  })

  it('maps running true to running and failed/error flags to error', () => {
    expect(sessionKindFromRow({ running: true })).toBe('running')
    expect(sessionKindFromRow({ error: true })).toBe('error')
    expect(sessionKindFromRow({ failed: true })).toBe('error')
    expect(sessionKindFromRow({ running: false })).toBe('idle')
  })
})

describe('resolvePetImage', () => {
  it('returns null for empty petImage so the default whale is used', () => {
    expect(resolvePetImage('')).toBeNull()
    expect(resolvePetImage('   ')).toBeNull()
  })

  it('returns a sanitized http(s) / data:image / same-origin path', () => {
    expect(resolvePetImage('https://cdn.example/whale.png')).toBe('https://cdn.example/whale.png')
    expect(resolvePetImage('/pets/me.png')).toBe('/pets/me.png')
  })

  it('rejects javascript: and data:text and falls back to default', () => {
    expect(resolvePetImage('javascript:alert(1)')).toBeNull()
    expect(resolvePetImage('data:text/html,hi')).toBeNull()
  })
})

describe('clampPetPosition', () => {
  it('clamps a square pet inside the viewport', () => {
    expect(clampPetPosition(-20, -4, 48, 48, 200, 100)).toEqual({ x: 0, y: 0 })
    expect(clampPetPosition(400, 400, 48, 48, 200, 100)).toEqual({ x: 152, y: 52 })
  })

  it('clamps a wide 16:9 pet with its own height', () => {
    expect(clampPetPosition(1000, 1000, 462, 260, 800, 600)).toEqual({ x: 338, y: 340 })
  })
})

describe('aggregatePetKind', () => {
  it('prefers awaiting, then error, then running, else idle', () => {
    expect(aggregatePetKind(['idle', 'running', 'awaiting'])).toBe('awaiting')
    expect(aggregatePetKind(['idle', 'error'])).toBe('error')
    expect(aggregatePetKind(['idle', 'running'])).toBe('running')
    expect(aggregatePetKind(['idle', 'subagent'])).toBe('subagent')
    expect(aggregatePetKind(['running', 'subagent'])).toBe('subagent')
    expect(aggregatePetKind(['idle'])).toBe('idle')
    expect(aggregatePetKind([])).toBe('idle')
  })
})

describe('foldPetRows', () => {
  it('drops subagent rows and reports a running child as the parent executing a subagent', () => {
    const parent = { id: 'main', title: '会话管理插件', running: false }
    const child = {
      id: 'child',
      title: 'You are reviewing one task',
      parentId: 'main',
      origin: 'subagent' as const,
      running: true,
    }
    expect(isSubagentRow(child)).toBe(true)
    const folded = foldPetRows([parent, child])
    expect(folded.map(row => row.id)).toEqual(['main'])
    expect(folded[0]!.kind).toBe('subagent')
    expect(folded[0]!.title).toBe('会话管理插件')
  })

  it('keeps a parent awaiting state ahead of a running child', () => {
    const folded = foldPetRows([
      { id: 'main', openState: 'awaiting_input' },
      { id: 'child', parentId: 'main', origin: 'subagent', running: true },
    ])
    expect(folded).toHaveLength(1)
    expect(folded[0]!.kind).toBe('awaiting')
  })

  it('folds nested subagents onto the top-level parent', () => {
    const folded = foldPetRows([
      { id: 'main', title: 'root' },
      { id: 'mid', parentId: 'main', origin: 'subagent' },
      { id: 'leaf', parentId: 'mid', origin: 'subagent', running: true },
    ])
    expect(folded.map(row => row.id)).toEqual(['main'])
    expect(folded[0]!.kind).toBe('subagent')
  })

  it('reads parentSessionId / sessionId from the live list shape', () => {
    const folded = foldPetRows([
      { id: 'main', title: '会话管理插件' },
      { sessionId: 'child', parentSessionId: 'main', origin: 'subagent', running: true },
    ])
    expect(folded.map(row => row.id)).toEqual(['main'])
    expect(folded[0]!.kind).toBe('subagent')
  })

  it('stays idle when both the parent and its children are idle', () => {
    const folded = foldPetRows([
      { id: 'main', title: '会话管理插件', running: false },
      { id: 'child', parentId: 'main', origin: 'subagent', running: false },
    ])
    expect(folded[0]!.kind).toBe('idle')
  })

  it('keeps a running parent as running when leftover children are idle', () => {
    const folded = foldPetRows([
      { id: 'main', title: '会话管理插件', running: true },
      { id: 'child', parentId: 'main', origin: 'subagent', running: false },
    ])
    expect(folded[0]!.kind).toBe('running')
  })
})

describe('foldPetList', () => {
  it('marks the parent as subagent from a running jobsBySession subagent job', () => {
    const folded = foldPetList({
      ids: ['main'],
      byId: { main: { id: 'main', title: '会话管理插件', running: false } },
      jobsBySession: {
        main: [{ kind: 'subagent', status: 'running', label: 'Review Task 3' }],
      },
    })
    expect(folded).toHaveLength(1)
    expect(folded[0]!.kind).toBe('subagent')
  })

  it('marks the parent as subagent from a running catalog child', () => {
    const folded = foldPetList({
      ids: ['main'],
      byId: { main: { id: 'main', title: '会话管理插件' } },
      subagentsByParent: {
        main: { entries: [{ kind: 'child', id: 'child', activity: 'running', hasChildren: false, mode: 'one-shot' }] },
      },
    })
    expect(folded[0]!.kind).toBe('subagent')
  })

  it('folds a running child that lives only in byId, not ids', () => {
    const folded = foldPetList({
      ids: ['main'],
      byId: {
        main: { id: 'main', title: '会话管理插件', running: true },
        child: { id: 'child', parentId: 'main', origin: 'subagent', running: true },
      },
    })
    expect(folded.map(row => row.id)).toEqual(['main'])
    expect(folded[0]!.kind).toBe('subagent')
  })
})

describe('defaultPetPosition', () => {
  it('rests bottom-right above the composer (~96px bottom, 16px right)', () => {
    expect(defaultPetPosition(800, 600, 48, 48)).toEqual({ x: 800 - 48 - 16, y: 600 - 48 - 96 })
  })

  it('accounts for a wide pet height', () => {
    expect(defaultPetPosition(800, 600, 462, 260)).toEqual({ x: 800 - 462 - 16, y: 600 - 260 - 96 })
  })
})

describe('default whale', () => {
  it('is an inline SVG with no network image fetch', () => {
    expect(WHALE_SVG).toContain('<svg')
    expect(WHALE_SVG).not.toMatch(/src=/i)
    expect(WHALE_SVG).not.toMatch(/href="https?:/i)
  })
})

describe('activityOf', () => {
  it('maps openState streaming / generating / running to a short activity', () => {
    expect(activityOf({ openState: 'streaming' })).toBe('streaming')
    expect(activityOf({ openState: 'generating' })).toBe('generating')
    expect(activityOf({ openState: 'running' })).toBe('running')
  })

  it('falls back to running for running-without-openState and unknown values', () => {
    expect(activityOf(undefined)).toBe('running')
    expect(activityOf({ running: true })).toBe('running')
    expect(activityOf({ openState: 'thinking' })).toBe('running')
  })
})

describe('toolOf', () => {
  it('returns the trimmed pendingInteraction', () => {
    expect(toolOf({ pendingInteraction: 'bash' })).toBe('bash')
    expect(toolOf({ pendingInteraction: '  write  ' })).toBe('write')
  })

  it('returns undefined when there is no pendingInteraction', () => {
    expect(toolOf({})).toBeUndefined()
    expect(toolOf({ pendingInteraction: '   ' })).toBeUndefined()
  })
})

describe('idlePhraseIndex', () => {
  it('wraps tick around the phrase count', () => {
    expect(idlePhraseIndex(0, 8)).toBe(0)
    expect(idlePhraseIndex(8, 8)).toBe(0)
    expect(idlePhraseIndex(15, 8)).toBe(7)
  })

  it('returns 0 for an empty phrase list', () => {
    expect(idlePhraseIndex(3, 0)).toBe(0)
  })
})

describe('completedRows', () => {
  it('detects sessions that finished (running/subagent → idle) between two snapshots', () => {
    const prev = [
      { id: 'a', title: 'A', kind: 'running' as const },
      { id: 'b', title: 'B', kind: 'subagent' as const },
      { id: 'c', title: 'C', kind: 'idle' as const },
    ]
    const next = [
      { id: 'a', title: 'A', kind: 'idle' as const },
      { id: 'b', title: 'B', kind: 'idle' as const },
      { id: 'c', title: 'C', kind: 'idle' as const },
    ]
    expect(completedRows(prev, next).map(e => e.id)).toEqual(['a', 'b'])
  })

  it('does not count running→awaiting/error, or still-running sessions', () => {
    const prev = [
      { id: 'a', title: 'A', kind: 'running' as const },
      { id: 'b', title: 'B', kind: 'running' as const },
    ]
    const next = [
      { id: 'a', title: 'A', kind: 'awaiting' as const },
      { id: 'b', title: 'B', kind: 'running' as const },
    ]
    expect(completedRows(prev, next)).toEqual([])
  })

  it('returns [] for an empty previous snapshot', () => {
    const next = [{ id: 'a', title: 'A', kind: 'idle' as const }]
    expect(completedRows([], next)).toEqual([])
  })
})

describe('subagentDetailRows', () => {
  it('lists only running subagent children (not parents, not idle children)', () => {
    const snap = {
      items: [
        { id: 'main', title: 'Main task', running: true },
        { id: 'child1', origin: 'subagent', parentId: 'main', title: 'Sub 1', running: true },
        { id: 'child2', parentId: 'main', title: 'Sub 2', openState: 'running' },
        { id: 'child3', parentId: 'main', title: 'Sub 3 done' },
        { id: 'other', title: 'Other' },
      ],
    }
    const rows = subagentDetailRows(snap)
    expect(rows.map(r => r.id)).toEqual(['child1', 'child2'])
    expect(rows.map(r => r.title)).toEqual(['Sub 1', 'Sub 2'])
  })

  it('returns [] when there are no running subagents', () => {
    expect(subagentDetailRows(undefined)).toEqual([])
    expect(subagentDetailRows({ items: [{ id: 'a', title: 'A' }] })).toEqual([])
  })
})
