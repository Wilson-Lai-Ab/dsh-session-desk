import { describe, expect, it } from 'vitest'
import { collectDescendants } from '../src/trash/cascade.ts'

describe('collectDescendants', () => {
  it('collects direct and nested subagents via byId', () => {
    const byId = {
      main: { id: 'main' },
      c1: { id: 'c1', parentId: 'main', origin: 'subagent' },
      c2: { id: 'c2', parentId: 'c1', origin: 'subagent' },
    }
    expect(collectDescendants('main', { byId })).toEqual(['c1', 'c2'])
  })

  it('excludes fork sessions (parentId without origin subagent)', () => {
    const byId = {
      main: { id: 'main' },
      fork: { id: 'fork', parentId: 'main' },
      c1: { id: 'c1', parentId: 'main', origin: 'subagent' },
    }
    expect(collectDescendants('main', { byId })).toEqual(['c1'])
  })

  it('merges byId and catalog children without duplicates', () => {
    const byId = {
      main: { id: 'main' },
      c1: { id: 'c1', parentId: 'main', origin: 'subagent' },
    }
    const subagentsByParent = {
      main: { entries: [{ id: 'c1', kind: 'child' }, { id: 'c2', kind: 'child' }] },
    }
    expect(collectDescendants('main', { byId, subagentsByParent })).toEqual(['c1', 'c2'])
  })

  it('terminates on a parent cycle', () => {
    const byId = {
      a: { id: 'a', parentId: 'b', origin: 'subagent' },
      b: { id: 'b', parentId: 'a', origin: 'subagent' },
    }
    const result = collectDescendants('a', { byId })
    expect(result.includes('b')).toBe(true)
    expect(result).toHaveLength(1)
  })
})
