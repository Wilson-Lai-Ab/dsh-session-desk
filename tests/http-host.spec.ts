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
import { PET_DESKTOP_PREFIX } from '../src/desktop/http.ts'

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
  let eventHandler: ((session: unknown, event: unknown) => void) | null = null
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
    on: (_event: string, handler: (session: unknown, event: unknown) => void) => {
      eventHandler = handler
      return () => { eventHandler = null }
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
    /** Push a live session/event into the answer-pet engine (host event feed). */
    emit(sessionId: string, event: Record<string, unknown>) {
      eventHandler?.({ id: sessionId, events: [event] }, event)
    },
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

  it('unions live subagent descendants even when the client omits sessionIds', async () => {
    root = await mkdtemp(join(tmpdir(), 'desk-http-'))
    const cwd = '/Users/laiweibin/work/workSoftware/dhs-plugins'
    const parentId = 'session-edd31b4a-43ab-40ee-9d1c-20b30693decb'
    const childId = 'session-cccccccc-cccc-cccc-cccc-cccccccccccc'
    const missingChildId = 'session-eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
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
      sessions: {
        forget(id: string) { forgetCalls.push(id) },
        list() {
          return {
            byId: {
              [parentId]: { id: parentId },
              [childId]: { id: childId, parentId, origin: 'subagent' },
              [missingChildId]: { id: missingChildId, parentId, origin: 'subagent' },
            },
          }
        },
      },
    })
    try {
      const res = fakeRes()
      await api(req('POST', '/session-desk/api/trash', {
        host: '127.0.0.1',
        'content-type': 'application/json',
        'x-dsh-session-desk': '1',
      }, JSON.stringify({ sessionId: parentId, cwd, title: 'root' })), res)
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body).ok).toBe(true)
      expect(forgetCalls).toEqual([parentId, childId])
      const listed = fakeRes()
      await api(req('GET', '/session-desk/api/trash', { host: '127.0.0.1' }), listed)
      const body = JSON.parse(listed.body) as { ok: true; data: Array<{ sessionId: string; memberCount?: number }> }
      expect(body.data).toHaveLength(1)
      expect(body.data[0]!.memberCount).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('purgeAll forgets every member and live sessions whose dirs are gone', async () => {
    root = await mkdtemp(join(tmpdir(), 'desk-http-'))
    const cwd = '/Users/laiweibin/work/workSoftware/dhs-plugins'
    const parentId = 'session-edd31b4a-43ab-40ee-9d1c-20b30693decb'
    const childId = 'session-cccccccc-cccc-cccc-cccc-cccccccccccc'
    const zombieId = 'session-ffffffff-ffff-ffff-ffff-ffffffffffff'
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
      sessions: {
        forget(id: string) { forgetCalls.push(id) },
        list() {
          return {
            byId: {
              [parentId]: { id: parentId },
              [childId]: { id: childId, parentId, origin: 'subagent' },
              [zombieId]: { id: zombieId },
            },
          }
        },
      },
    })
    try {
      const trashed = fakeRes()
      await api(req('POST', '/session-desk/api/trash', {
        host: '127.0.0.1',
        'content-type': 'application/json',
        'x-dsh-session-desk': '1',
      }, JSON.stringify({ sessionId: parentId, sessionIds: [parentId, childId], cwd, title: 'root' })), trashed)
      expect(trashed.status).toBe(200)
      forgetCalls.length = 0
      const purged = fakeRes()
      await api(req('POST', '/session-desk/api/purge', {
        host: '127.0.0.1',
        'content-type': 'application/json',
        'x-dsh-session-desk': '1',
      }, '{"all":true}'), purged)
      expect(purged.status).toBe(200)
      expect(forgetCalls).toContain(parentId)
      expect(forgetCalls).toContain(childId)
      expect(forgetCalls).toContain(zombieId)
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

  it('GET answer-pet/state serves the live engine snapshot (real title + progress)', async () => {
    const { api, emit, cleanup } = mount()
    try {
      emit('main', { type: 'session/title', data: { title: '调研插件核心实现' }, time: 10_000 })
      emit('main', { type: 'turn/start', data: { turn: 1 }, time: 10_000 })
      emit('main', { type: 'step/start', data: { step: 1 }, time: 10_000 })
      emit('main', { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '你好世界你好世界' } }, time: 10_100 })

      const res = fakeRes()
      await api(req('GET', `${ANSWER_PET_PREFIX}/state`, { host: '127.0.0.1' }), res)
      expect(res.status).toBe(200)
      const body = JSON.parse(res.body) as {
        ok: true
        data: {
          active: boolean
          session: { id: string; title: string | null } | null
          running: Array<{ id: string; title: string | null; view: { phase: string; progress: number; chunkCount: number } }>
        }
      }
      expect(body.ok).toBe(true)
      expect(body.data.active).toBe(true)
      // real session title, not the UUID
      expect(body.data.session?.title).toBe('调研插件核心实现')
      // running card carries the friendly title and non-zero progress
      const card = body.data.running.find((c) => c.id === 'main')
      expect(card?.title).toBe('调研插件核心实现')
      expect(card?.view.chunkCount).toBe(1)
    } finally {
      cleanup()
    }
  })
})

describe('desktop-pet host settings writer', () => {
  it('POST /close persists after a late settings inject (does not keep the boot no-op)', async () => {
    const routes: Route[] = []
    const patches: unknown[] = []
    let injectCb: ((scope: {
      settings: { register: () => { get: () => { petDesktop: boolean }; update: (patch: unknown) => void } }
    }) => void) | undefined
    const ctx = {
      webServer: {
        register: (route: Route) => {
          routes.push(route)
          return () => {}
        },
      },
      sessions: {},
      effect: (fn: () => void | (() => void)) => { fn() },
      inject: (
        _deps: string[],
        callback: (scope: {
          settings: { register: () => { get: () => { petDesktop: boolean }; update: (patch: unknown) => void } }
        }) => void,
      ) => { injectCb = callback },
    }
    apply(ctx)
    const pet = routes.find(route => route.path === PET_DESKTOP_PREFIX)?.handler
    if (pet === undefined) throw new Error('test setup: pet-desktop was not registered')
    injectCb?.({
      settings: {
        register: () => ({
          get: () => ({ petDesktop: true }),
          update: (patch) => { patches.push(patch) },
        }),
      },
    })
    const res = fakeRes()
    await pet(req('POST', `${PET_DESKTOP_PREFIX}/close`, {
      host: '127.0.0.1',
      'x-dsh-session-desk': '1',
      'content-type': 'application/json',
    }, JSON.stringify({ petDesktop: false })), res)
    expect(res.status).toBe(200)
    expect(patches).toEqual([{ petDesktop: false }])
  })
})
