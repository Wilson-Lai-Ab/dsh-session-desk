import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-settings', () => ({
  settingsNamespace: (name: string) => name,
}))

vi.mock('@deepseek-ai/schemastery', () => {
  const schema = () => {
    const self = {
      default: () => self,
      min: () => self,
      max: () => self,
    }
    return self
  }
  return {
    default: {
      object: () => schema(),
      string: () => schema(),
      number: () => schema(),
      boolean: () => schema(),
      union: () => schema(),
      dict: () => schema(),
      array: () => schema(),
    },
  }
})

import { apply } from '../src/index.ts'
import { liveSessionDir } from '../src/session-path.ts'
import { probeSessionForget, probeSessionReload, validateLoopbackHost, ANSWER_PET_PREFIX } from '../src/http.ts'

interface FakeRes {
  status: number
  headers: Record<string, string>
  body: string
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

function fakeRes(): FakeRes {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      if (body !== undefined) this.body = body
    },
  }
}

function req(
  method: string,
  url: string,
  headers: Record<string, string>,
  body = '',
) {
  const chunks = body === '' ? [] : [Buffer.from(body)]
  return {
    method,
    url,
    headers,
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk
    },
  }
}

interface Route {
  kind: string
  path: string
  handler: (request: ReturnType<typeof req>, response: FakeRes) => void | Promise<void>
}

function mount(options?: {
  sessionsRoot?: string
  sessions?: object
  settings?: { sessionsRoot?: string; retentionDays?: number }
}) {
  const routes: Route[] = []
  const effects: Array<() => void> = []
  const settingsValue = {
    sessionsRoot: options?.settings?.sessionsRoot ?? options?.sessionsRoot ?? '',
    retentionDays: options?.settings?.retentionDays ?? 30,
  }
  const ctx = {
    webServer: {
      register: (route: Route) => {
        routes.push(route)
        return () => {}
      },
    },
    sessions: options?.sessions ?? {},
    effect: (fn: () => void | (() => void)) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') effects.push(cleanup)
    },
    inject: (_deps: string[], callback: (scope: { settings: { register: () => { get: () => typeof settingsValue } } }) => void) => {
      callback({
        settings: {
          register: () => ({ get: () => settingsValue }),
        },
      })
    },
  }
  apply(ctx, options?.sessionsRoot ? { sessionsRoot: options.sessionsRoot } : undefined)
  const api = routes.find(route => route.path === '/session-desk/api')?.handler
  if (api === undefined) throw new Error('test setup: /session-desk/api was not registered')
  return {
    api,
    cleanup: () => { for (const dispose of effects) dispose() },
  }
}

describe('validateLoopbackHost', () => {
  it('accepts loopback hosts and rejects others', () => {
    expect(validateLoopbackHost('127.0.0.1')).toBe(true)
    expect(validateLoopbackHost('127.0.0.1:3080')).toBe(true)
    expect(validateLoopbackHost('localhost:3080')).toBe(true)
    expect(validateLoopbackHost('[::1]')).toBe(true)
    expect(validateLoopbackHost('evil.com')).toBe(false)
    expect(validateLoopbackHost(undefined)).toBe(false)
  })
})

describe('session probes', () => {
  it('calls only whitelisted forget-style methods', () => {
    const forget = { called: '' }
    const sessions = {
      forget(id: string) { forget.called = id },
      delete() { throw new Error('must not call delete') },
    }
    probeSessionForget(sessions, 'sid-1')
    expect(forget.called).toBe('sid-1')
    const reload = { n: 0 }
    probeSessionReload({ reindex() { reload.n += 1 }, scan() { throw new Error('no') } })
    expect(reload.n).toBe(1)
  })
})

describe('session-desk host HTTP', () => {
  let root = ''
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  it('rejects Host: evil.com with 403', async () => {
    const { api, cleanup } = mount()
    try {
      const res = fakeRes()
      await api(req('GET', '/session-desk/api/root', { host: 'evil.com' }), res)
      expect(res.status).toBe(403)
    } finally {
      cleanup()
    }
  })

  it('rejects POST without x-dsh-session-desk: 1', async () => {
    const { api, cleanup } = mount()
    try {
      const res = fakeRes()
      await api(req('POST', '/session-desk/api/trash', {
        host: '127.0.0.1',
        'content-type': 'application/json',
      }, '{"sessionId":"missing"}'), res)
      expect(res.status).toBe(403)
    } finally {
      cleanup()
    }
  })

  it('returns 404 { ok: false } when POST trash cannot find the session', async () => {
    root = await mkdtemp(join(tmpdir(), 'desk-http-'))
    const { api, cleanup } = mount({ sessionsRoot: root })
    try {
      const res = fakeRes()
      await api(req('POST', '/session-desk/api/trash', {
        host: '127.0.0.1',
        'content-type': 'application/json',
        'x-dsh-session-desk': '1',
      }, '{"sessionId":"missing","title":"gone"}'), res)
      expect(res.status).toBe(404)
      expect(JSON.parse(res.body).ok).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('GET root on 127.0.0.1 returns { ok: true, data: { root, source } }', async () => {
    root = await mkdtemp(join(tmpdir(), 'desk-http-'))
    const { api, cleanup } = mount({
      sessionsRoot: root,
      settings: { sessionsRoot: root, retentionDays: 30 },
    })
    try {
      const res = fakeRes()
      await api(req('GET', '/session-desk/api/root', { host: '127.0.0.1' }), res)
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual({
        ok: true,
        data: { root, source: 'config' },
      })
    } finally {
      cleanup()
    }
  })

  it('trashes a live session and lists it under GET /trash', async () => {
    root = await mkdtemp(join(tmpdir(), 'desk-http-'))
    const cwd = '/Users/laiweibin/work/workSoftware/dhs-plugins'
    const sessionId = 'session-edd31b4a-43ab-40ee-9d1c-20b30693decb'
    const live = liveSessionDir(root, cwd, sessionId)
    await mkdir(live, { recursive: true })
    await writeFile(join(live, 'session.jsonl.zstd'), 'x')
    const forgetCalls: string[] = []
    const { api, cleanup } = mount({
      sessionsRoot: root,
      settings: { sessionsRoot: root, retentionDays: 30 },
      sessions: { forget(id: string) { forgetCalls.push(id) } },
    })
    try {
      const res = fakeRes()
      await api(req('POST', '/session-desk/api/trash', {
        host: '127.0.0.1:3080',
        'content-type': 'application/json',
        'x-dsh-session-desk': '1',
      }, JSON.stringify({ sessionId, cwd, title: 'hello' })), res)
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body).ok).toBe(true)
      expect(forgetCalls).toEqual([sessionId])
      const listed = fakeRes()
      await api(req('GET', '/session-desk/api/trash', { host: '127.0.0.1' }), listed)
      expect(listed.status).toBe(200)
      const body = JSON.parse(listed.body) as { ok: true; data: Array<{ sessionId: string }> }
      expect(body.ok).toBe(true)
      expect(body.data.some(row => row.sessionId === sessionId)).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('cascades sessionIds into one entry and forgets every member', async () => {
    root = await mkdtemp(join(tmpdir(), 'desk-http-'))
    const cwd = '/Users/laiweibin/work/workSoftware/dhs-plugins'
    const parentId = 'session-edd31b4a-43ab-40ee-9d1c-20b30693decb'
    const childId = 'session-cccccccc-cccc-cccc-cccc-cccccccccccc'
    const parentLive = liveSessionDir(root, cwd, parentId)
    const childLive = liveSessionDir(root, cwd, childId)
    await mkdir(parentLive, { recursive: true })
    await writeFile(join(parentLive, 'session.jsonl.zstd'), 'x')
    await mkdir(childLive, { recursive: true })
    await writeFile(join(childLive, 'session.jsonl.zstd'), 'y')
    const forgetCalls: string[] = []
    const { api, cleanup } = mount({
      sessionsRoot: root,
      settings: { sessionsRoot: root, retentionDays: 30 },
      sessions: { forget(id: string) { forgetCalls.push(id) } },
    })
    try {
      const res = fakeRes()
      await api(req('POST', '/session-desk/api/trash', {
        host: '127.0.0.1',
        'content-type': 'application/json',
        'x-dsh-session-desk': '1',
      }, JSON.stringify({ sessionId: parentId, sessionIds: [parentId, childId], cwd, title: 'root' })), res)
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body).ok).toBe(true)
      expect(forgetCalls).toEqual([parentId, childId])
      const listed = fakeRes()
      await api(req('GET', '/session-desk/api/trash', { host: '127.0.0.1' }), listed)
      const body = JSON.parse(listed.body) as { ok: true; data: Array<{ sessionId: string; memberCount?: number }> }
      expect(body.data).toHaveLength(1)
      expect(body.data[0]!.sessionId).toBe(parentId)
      expect(body.data[0]!.memberCount).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('GET answer-pet/state folds the sessions snapshot into status cards', async () => {
    const sessions = {
      list: () => [
        { id: 'main', title: '会话管理插件', openState: 'streaming', running: true },
        { id: 'child', parentId: 'main', openState: 'running', running: true, origin: 'subagent' },
        { id: 'idle-one', title: '待机会话', running: false },
      ],
    }
    const { api, cleanup } = mount({ sessions })
    try {
      const res = fakeRes()
      await api(req('GET', `${ANSWER_PET_PREFIX}/state`, { host: '127.0.0.1' }), res)
      expect(res.status).toBe(200)
      const body = JSON.parse(res.body) as { ok: true; data: Array<{ id: string; view: { phase: string } }> }
      expect(body.ok).toBe(true)
      // subagent child is folded away; only top-level sessions get cards
      expect(body.data.map(card => card.id).sort()).toEqual(['idle-one', 'main'])
      expect(body.data.find(card => card.id === 'main')?.view.phase).toBe('stream')
    } finally {
      cleanup()
    }
  })
})
