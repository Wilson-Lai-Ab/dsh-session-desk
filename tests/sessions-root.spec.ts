import { describe, expect, it } from 'vitest'
import { resolveSessionsRoot } from '../src/sessions-root.ts'

const home = () => '/Users/me'

describe('resolveSessionsRoot', () => {
  it('uses absolute settings.sessionsRoot first', () => {
    const r = resolveSessionsRoot({
      sessionsRoot: '/data/sessions',
      env: { DSH_SESSIONS_ROOT: '/env', DSH_HOME: '/home-dsh' },
      homedir: home,
    })
    expect(r).toEqual({ root: '/data/sessions', source: 'config' })
  })

  it('expands a leading ~ in settings.sessionsRoot', () => {
    const r = resolveSessionsRoot({ sessionsRoot: '~/alt', env: {}, homedir: home })
    expect(r).toEqual({ root: '/Users/me/alt', source: 'config' })
  })

  it('ignores empty and relative settings.sessionsRoot', () => {
    expect(resolveSessionsRoot({ sessionsRoot: '', env: { DSH_SESSIONS_ROOT: '/env' }, homedir: home }))
      .toEqual({ root: '/env', source: 'env' })
    expect(resolveSessionsRoot({ sessionsRoot: 'relative/path', env: { DSH_SESSIONS_ROOT: '/env' }, homedir: home }))
      .toEqual({ root: '/env', source: 'env' })
  })

  it('falls through env → DSH_HOME/sessions → ~/.dsh/sessions', () => {
    expect(resolveSessionsRoot({ env: { DSH_HOME: '/opt/dsh' }, homedir: home }))
      .toEqual({ root: '/opt/dsh/sessions', source: 'home' })
    expect(resolveSessionsRoot({ env: {}, homedir: home }))
      .toEqual({ root: '/Users/me/.dsh/sessions', source: 'default' })
  })
})
