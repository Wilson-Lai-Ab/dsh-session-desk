import { describe, expect, it } from 'vitest'
import {
  applyRowWash,
  cssText as rowWashCss,
  isSessionTreeRow,
  matchSessionRows,
  paintsBySession,
  progressVars,
  rememberOpenedTerminal,
  rowWashKind,
  type WashElement,
} from '../src/client/workspace/row-wash.ts'

function el(init: { role?: string; expanded?: string; selected?: string } = {}): {
  role: string | null
  expanded: string | null
  selected: string | null
} {
  return {
    role: init.role ?? 'treeitem',
    expanded: init.expanded ?? null,
    selected: init.selected ?? null,
  }
}

function washTarget(): WashElement & { attrs: Record<string, string>; vars: Record<string, string> } {
  const attrs: Record<string, string> = {}
  const vars: Record<string, string> = {}
  return {
    attrs,
    vars,
    getAttribute(name) { return attrs[name] ?? null },
    setAttribute(name, value) { attrs[name] = value },
    removeAttribute(name) { delete attrs[name] },
    style: {
      setProperty(name, value) { vars[name] = value },
      removeProperty(name) { delete vars[name]; return '' },
    },
  }
}

describe('rowWashKind', () => {
  it('leaves idle rows unpainted', () => {
    expect(rowWashKind({ kind: 'idle' })).toBe('idle')
  })

  it('keeps busy kinds even when the row is the open session', () => {
    expect(rowWashKind({ kind: 'running', current: true })).toBe('running')
    expect(rowWashKind({ kind: 'subagent', current: true })).toBe('subagent')
    expect(rowWashKind({ kind: 'awaiting', current: true })).toBe('awaiting')
  })

  it('paints a completion reminder only until the session is opened', () => {
    expect(rowWashKind({ kind: 'idle', completed: true })).toBe('completed')
    expect(rowWashKind({ kind: 'idle', completed: true, current: true })).toBe('idle')
  })

  it('clears error wash after the failed session is opened', () => {
    expect(rowWashKind({ kind: 'error' })).toBe('error')
    expect(rowWashKind({ kind: 'error', current: true })).toBe('idle')
  })

  it('keeps terminal wash off after the session was opened once', () => {
    expect(rowWashKind({ kind: 'error', seen: true })).toBe('idle')
    expect(rowWashKind({ kind: 'idle', completed: true, seen: true })).toBe('idle')
  })

  it('repaints a later completion after the session runs again', () => {
    const seen = new Set<string>(['a'])
    rememberOpenedTerminal(seen, 'a', 'running', true)
    expect(seen.has('a')).toBe(false)
    expect(rowWashKind({ kind: 'idle', completed: true, seen: false })).toBe('completed')
  })

  it('lets live activity outrank a leftover completion flag', () => {
    expect(rowWashKind({ kind: 'running', completed: true })).toBe('running')
  })
})

describe('progressVars', () => {
  it('does not emit a percent that would replace the relative time', () => {
    expect(progressVars({ kind: 'running', progress: 42 })).toEqual({
      progress: 42,
      indeterminate: false,
      phase: undefined,
    })
  })

  it('uses an indeterminate bar when running has no percent yet', () => {
    expect(progressVars({ kind: 'running' }).indeterminate).toBe(true)
    expect(progressVars({ kind: 'awaiting' }).indeterminate).toBe(true)
  })

  it('fills the bar on an unseen completion and skips it once opened', () => {
    expect(progressVars({ kind: 'completed' })).toEqual({
      progress: 100,
      indeterminate: false,
      phase: undefined,
    })
    expect(progressVars({ kind: 'idle' }).progress).toBeUndefined()
  })

  it('recolors the bar only (not the wash) during a tool phase', () => {
    expect(progressVars({ kind: 'running', progress: 68, phase: 'tool' }).phase).toBe('tool')
  })
})

describe('matchSessionRows', () => {
  it('maps unique titles onto list ids and prefers the selected row for current', () => {
    const matched = matchSessionRows(
      [
        { title: '调研插件核心实现', selected: true },
        { title: '闲置草稿', selected: false },
      ],
      [
        { id: 'a', title: '调研插件核心实现' },
        { id: 'b', title: '闲置草稿' },
      ],
      'a',
    )
    expect(matched).toEqual([
      { index: 0, id: 'a' },
      { index: 1, id: 'b' },
    ])
  })

  it('binds the selected tree row to the current session even when titles differ', () => {
    const matched = matchSessionRows(
      [
        { title: '在测试下 2min', selected: true },
        { title: '闲置草稿 1d', selected: false },
      ],
      [
        { id: 'current', title: '在测试下' },
        { id: 'b', title: '闲置草稿' },
      ],
      'current',
    )
    expect(matched).toEqual([
      { index: 0, id: 'current' },
      { index: 1, id: 'b' },
    ])
  })

  it('skips workspace group rows that expose aria-expanded', () => {
    expect(isSessionTreeRow(el({ expanded: 'true' }))).toBe(false)
    expect(isSessionTreeRow(el({ expanded: 'false' }))).toBe(false)
    expect(isSessionTreeRow(el())).toBe(true)
  })
})

describe('paintsBySession', () => {
  it('paints awaiting from a live confirmation card even when the list row is only running', () => {
    const paints = paintsBySession(
      {
        ids: ['s1'],
        byId: { s1: { id: 's1', title: 'chat', running: true } },
      },
      new Map(),
      new Map([['s1', 'tool']]),
      new Set(),
      [{ id: 's1', pendingInteraction: 'bash', view: { phase: 'tool', toolName: 'bash' } }],
    )
    expect(paints.get('s1')?.kind).toBe('awaiting')
  })

  it('clears a completed wash once the session is current and keeps it off afterwards', () => {
    const seen = new Set<string>()
    const first = paintsBySession({
      current: 'other',
      ids: ['a'],
      byId: { a: { id: 'a', title: 'done', completed: true } },
    }, new Map(), new Map(), seen)
    expect(first.get('a')?.kind).toBe('completed')

    const opened = paintsBySession({
      current: 'a',
      ids: ['a'],
      byId: { a: { id: 'a', title: 'done', completed: true } },
    }, new Map(), new Map(), seen)
    expect(opened.get('a')?.kind).toBe('idle')

    const later = paintsBySession({
      current: 'other',
      ids: ['a'],
      byId: { a: { id: 'a', title: 'done', completed: true } },
    }, new Map(), new Map(), seen)
    expect(later.get('a')?.kind).toBe('idle')
  })
})

describe('applyRowWash', () => {
  it('stamps kind and progress on a busy row without a time label', () => {
    const target = washTarget()
    applyRowWash(target, { kind: 'running', progress: 42 })
    expect(target.attrs['data-dsd-kind']).toBe('running')
    expect(target.vars['--dsd-progress']).toBe('42%')
    expect(target.attrs['data-dsd-time']).toBeUndefined()
  })

  it('removes every wash attribute when the row returns to idle after being opened', () => {
    const target = washTarget()
    applyRowWash(target, { kind: 'completed', progress: 100 })
    applyRowWash(target, { kind: 'idle' })
    expect(target.attrs['data-dsd-kind']).toBeUndefined()
    expect(target.vars['--dsd-progress']).toBeUndefined()
  })
})

describe('row-wash stylesheet', () => {
  it('never restyles the host relative-time slot', () => {
    expect(rowWashCss).not.toMatch(/\[class\*=['\"]time['\"]\]/)
    expect(rowWashCss).toContain('[data-dsd-kind="running"]')
    expect(rowWashCss).toContain('--dsd-progress')
  })

  it('keeps the host gray selected fill instead of a status wash', () => {
    const selected = rowWashCss.match(/\[data-dsd-kind\]\[aria-selected="true"\][\s\S]*?\{[\s\S]*?\}/)?.[0] ?? ''
    expect(selected).toContain('var(--dsw-alias-interactive-bg-hover)')
    expect(selected).not.toContain('color-mix')
  })
})
