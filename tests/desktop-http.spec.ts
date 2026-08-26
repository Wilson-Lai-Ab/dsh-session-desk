import { describe, expect, it, vi, afterAll, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDesktopPetHandler, PET_DESKTOP_PREFIX } from '../src/desktop/http.ts'
import { createDesktopPetController } from '../src/desktop/lifecycle.ts'

function handlerWith(overrides = {}) {
  const state = { pendingOpen: null as { id: string; at: number } | null }
  let ready = false
  const controller = {
    ...createDesktopPetController(),
    spawn: async () => { controller.active = true },
    isActive: () => Boolean(controller.active),
    isReady: () => ready,
    markReady: () => { if (controller.active) ready = true },
  }
  const updatePetSetting = vi.fn(async () => {})
  const handler = createDesktopPetHandler({
    sessions: {},
    controller,
    getPetSettings: () => ({ petImage: 'x.png' }),
    updatePetSetting,
    token: 'tok',
    state,
    ...overrides,
  } as never)
  return { handler, state, controller, updatePetSetting }
}

function call(handler: (req: never, res: never) => Promise<void>, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const chunks: string[] = []
  const res: {
    status: number
    writeHead: (s: number, h?: object) => void
    end: (b?: string) => void
    setHeader: () => void
  } = {
    status: 0,
    writeHead: (s: number) => { res.status = s },
    end: (b?: string) => { if (b) chunks.push(String(b)) },
    setHeader: () => {},
  }
  const req = {
    method,
    url: path,
    headers: { host: '127.0.0.1:3080', ...headers },
    [Symbol.asyncIterator]: async function* () {
      if (body !== undefined) yield JSON.stringify(body)
    },
  }
  return handler(req as never, res as never)
    .then(() => ({ status: res.status, body: chunks.length ? JSON.parse(chunks.join('')) : null }))
}

/** Captures the status line only (for raw-binary asset routes, which JSON.parse would choke on). */
function statusOf(handler: (req: never, res: never) => Promise<void>, method: string, path: string) {
  const res: { status: number; writeHead: (s: number) => void; end: (b?: string) => void } = {
    status: 0,
    writeHead: (s: number) => { res.status = s },
    end: () => {},
  }
  const req = {
    method,
    url: path,
    headers: { host: '127.0.0.1:3080' },
    [Symbol.asyncIterator]: async function* () {
      // no body
    },
  }
  return handler(req as never, res as never).then(() => res.status)
}

/** Headers that pass the mutation gate (x-dsh-session-desk: 1 + JSON content-type). */
const mutationHeaders = { 'x-dsh-session-desk': '1', 'content-type': 'application/json' }

describe('desktop-pet endpoints', () => {
  it('GET /status returns active', async () => {
    const { handler, controller } = handlerWith()
    controller.spawn('http://x', 'tok').catch(() => {})
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/status`)
    expect(r.status).toBe(200)
    expect(r.body.active).toBe(true)
    expect(r.body.ready).toBe(false)
  })

  it('GET /status ready is true only after POST /ready with the pet token', async () => {
    const { handler, controller } = handlerWith()
    controller.spawn('http://x', 'tok').catch(() => {})
    const before = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/status`)
    expect(before.body.ready).toBe(false)
    const denied = await call(handler, 'POST', `${PET_DESKTOP_PREFIX}/ready`, {}, mutationHeaders)
    expect(denied.status).toBe(403)
    expect((await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/status`)).body.ready).toBe(false)
    const ok = await call(handler, 'POST', `${PET_DESKTOP_PREFIX}/ready`, {}, { ...mutationHeaders, 'x-pet-token': 'tok' })
    expect(ok.status).toBe(200)
    expect((await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/status`)).body.ready).toBe(true)
  })

  it('rejects a non-loopback host', async () => {
    const { handler } = handlerWith()
    const chunks: string[] = []
    const res = { writeHead: (s: number) => { (res as never).status = s }, end: (b: string) => chunks.push(b) }
    await handler({ method: 'GET', url: `${PET_DESKTOP_PREFIX}/status`, headers: { host: 'evil.example.com' } } as never, res as never)
    expect((res as never).status).toBe(403)
  })

  it('/open records the pending session and /status exposes it via shared state', async () => {
    const { handler, state } = handlerWith()
    const headers = { 'x-dsh-session-desk': '1', 'content-type': 'application/json', 'x-pet-token': 'tok' }
    const r1 = await call(handler, 'POST', `${PET_DESKTOP_PREFIX}/open`, { id: 'sess-1' }, headers)
    expect(r1.status).toBe(200)
    expect(r1.body.ok).toBe(true)
    expect(state.pendingOpen).not.toBeNull()
    expect(state.pendingOpen!.id).toBe('sess-1')

    const r2 = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/status`)
    expect(r2.status).toBe(200)
    expect(r2.body.pendingOpen).not.toBeNull()
    expect(r2.body.pendingOpen.id).toBe('sess-1')
    expect(r2.body.pendingOpen.at).toBe(state.pendingOpen!.at)
  })

  it('/open rejects a wrong token and leaves pendingOpen unset', async () => {
    const { handler, state } = handlerWith()
    const r = await call(handler, 'POST', `${PET_DESKTOP_PREFIX}/open`, { id: 'sess-1' }, { 'x-dsh-session-desk': '1', 'content-type': 'application/json' })
    expect(r.status).toBe(403)
    expect(r.body.ok).toBe(false)
    expect(state.pendingOpen).toBeNull()
  })

  it('serves renderer.html from shellAssets', async () => {
    writeFileSync(join(assetsDir, 'renderer.html'), '<div id="root"></div>')
    const { handler } = handlerWith({
      shellAssets: { rendererHtml: join(assetsDir, 'renderer.html'), rendererJs: join(assetsDir, 'renderer.js') },
    })
    expect(await statusOf(handler, 'GET', `${PET_DESKTOP_PREFIX}/renderer.html`)).toBe(200)
  })

  it('serves renderer.js from shellAssets', async () => {
    writeFileSync(join(assetsDir, 'renderer.js'), '// bundle  ')
    const { handler } = handlerWith({
      shellAssets: { rendererHtml: join(assetsDir, 'renderer.html'), rendererJs: join(assetsDir, 'renderer.js') },
    })
    expect(await statusOf(handler, 'GET', `${PET_DESKTOP_PREFIX}/renderer.js`)).toBe(200)
  })

  it('404s a renderer route when shellAssets is absent', async () => {
    const { handler } = handlerWith()
    expect(await statusOf(handler, 'GET', `${PET_DESKTOP_PREFIX}/renderer.js`)).toBe(404)
  })

  it('404s a renderer route when the file is missing', async () => {
    const { handler } = handlerWith({ shellAssets: { rendererHtml: join(assetsDir, 'nope.html'), rendererJs: join(assetsDir, 'nope.js') } })
    expect(await statusOf(handler, 'GET', `${PET_DESKTOP_PREFIX}/renderer.js`)).toBe(404)
  })

  it('rejects POST to a static renderer route (mutation gate)', async () => {
    const { handler } = handlerWith({ shellAssets: { rendererHtml: join(assetsDir, 'renderer.html'), rendererJs: join(assetsDir, 'renderer.js') } })
    // A GET-only static route; a POST falls through to the mutation gate, which
    // rejects the missing mutation header with 403 before reaching it.
    expect(await statusOf(handler, 'POST', `${PET_DESKTOP_PREFIX}/renderer.js`)).toBe(403)
  })

  it('/spawn forwards the browser pet window origin to the controller', async () => {
    const spawn = vi.fn(async () => {})
    const { handler } = handlerWith({
      controller: {
        spawn,
        isActive: () => false,
        isReady: () => false,
        markReady: () => {},
        close: () => {},
        downloadState: () => ({ stage: 'idle', pct: null }),
      },
    })
    const r = await call(handler, 'POST', `${PET_DESKTOP_PREFIX}/spawn`, { x: 340, y: 264 }, mutationHeaders)
    expect(r.status).toBe(202)
    expect(spawn).toHaveBeenCalledWith('http://127.0.0.1:3080', 'tok', { x: 340, y: 264 })
  })

  it('/spawn returns 202 Accepted while the download is still in flight', async () => {
    const { handler, controller } = handlerWith()
    // A gate that never resolves: the handler must return 202 without awaiting it.
    controller.spawn = async () => { await new Promise<void>(() => {}) }
    const r = await call(handler, 'POST', `${PET_DESKTOP_PREFIX}/spawn`, {}, mutationHeaders)
    expect(r.status).toBe(202)
    expect(r.body).toEqual({ ok: true, active: false, downloading: true })
  })

  it('/spawn 404 returns non-2xx so the client can revert', async () => {
    const { handler } = handlerWith()
    const r = await call(handler, 'POST', `${PET_DESKTOP_PREFIX}/spawn-nope`, {}, mutationHeaders)
    expect(r.status).toBe(404)
  })

  it('/status publishes download progress', async () => {
    const { handler, controller } = handlerWith()
    ;(controller as { downloadState?: () => unknown }).downloadState = () => ({ stage: 'downloading', pct: null })
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/status`)
    expect(r.status).toBe(200)
    expect(r.body.download).toEqual({ stage: 'downloading', pct: null })
  })

  it('/status exposes a failed download with its error', async () => {
    const { handler, controller } = handlerWith()
    ;(controller as { downloadState?: () => unknown }).downloadState = () => ({ stage: 'failed', pct: null, error: 'no electron binary' })
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/status`)
    expect(r.status).toBe(200)
    expect(r.body.download).toEqual({ stage: 'failed', pct: null, error: 'no electron binary' })
  })

  it('GET /snapshot uses the session/title event as the display name without sending the log', async () => {
    const sessions = {
      list: () => [{
        id: 'session-ec761be4-7e4b-44bf-b368-3118157841e0',
        log: [
          { type: 'session', seq: 0 },
          { type: 'session/title', data: { title: '桌面宠物 OOM' } },
          { type: 'assistant/chunk', data: { text: 'x'.repeat(80) } },
        ],
      }],
    }
    const { handler } = handlerWith({
      sessions,
      getAnswerPet: () => ({ running: [{ id: 'session-ec761be4-7e4b-44bf-b368-3118157841e0' }], active: true }),
    })
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/snapshot?token=tok`)
    expect(r.status).toBe(200)
    expect(r.body.sessions.items[0].title).toBe('桌面宠物 OOM')
    expect(r.body.answerPet.running[0].title).toBe('桌面宠物 OOM')
    expect(JSON.stringify(r.body)).not.toContain('assistant/chunk')
  })

  it('GET /snapshot prefers the live answer-pet title over a missing row title', async () => {
    const { handler } = handlerWith({
      sessions: { list: () => [{ id: 's1' }] },
      getAnswerPet: () => ({ running: [{ id: 's1', title: '调研插件核心实现' }], active: true }),
    })
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/snapshot?token=tok`)
    expect(r.body.sessions.items[0]).toEqual({ id: 's1', title: '调研插件核心实现', running: true })
  })

  it('GET /snapshot projects live Session rows without log or events', async () => {
    const log = Array.from({ length: 50 }, (_, i) => ({ seq: i, type: 'assistant/chunk', data: { text: 'x'.repeat(200) } }))
    const sessions = {
      list: () => [{
        id: 's1',
        title: 'chat',
        log,
        events: log,
        eventsSnapshot: log,
        header: { id: 's1', origin: 'subagent', parentSession: 'parent-1' },
        surfaceManager: { huge: true },
      }],
    }
    const { handler } = handlerWith({ sessions })
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/snapshot?token=tok`)
    expect(r.status).toBe(200)
    expect(r.body.sessions.items).toEqual([
      { id: 's1', title: 'chat', origin: 'subagent', parentSessionId: 'parent-1' },
    ])
    const encoded = JSON.stringify(r.body)
    expect(encoded).not.toContain('assistant/chunk')
    expect(encoded.length).toBeLessThan(2000)
  })

  it('GET /snapshot marks listed sessions running from the live answer-pet engine', async () => {
    const sessions = {
      list: () => [{ id: 's1', title: 'chat' }, { id: 's2', title: 'other' }],
    }
    const { handler } = handlerWith({
      sessions,
      getAnswerPet: () => ({ running: [{ id: 's1' }], active: true }),
    })
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/snapshot?token=tok`)
    expect(r.status).toBe(200)
    expect(r.body.sessions.items).toEqual([
      { id: 's1', title: 'chat', running: true },
      { id: 's2', title: 'other' },
    ])
    expect(r.body.answerPet.running).toEqual([{ id: 's1', title: 'chat' }])
  })

  it('GET /snapshot hydrates an open approval/asked from the host session log', async () => {
    const log = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'approval/asked', data: { id: 'a1', toolName: 'bash' } },
    ]
    const { handler } = handlerWith({
      sessions: { list: () => [{ id: 's1', title: 'chat', log }] },
      getAnswerPet: () => ({
        running: [{ id: 's1', title: 'chat', view: { phase: 'tool', toolName: 'bash' } }],
        active: true,
      }),
    })
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/snapshot?token=tok`)
    expect(r.body.sessions.items[0].pendingInteraction).toBe('bash')
    expect(r.body.sessions.items[0].running).toBeUndefined()
  })

  it('GET /snapshot marks a sandbox approval wait as awaiting even when the tool is bash', async () => {
    const sessions = {
      list: () => [{ id: 's1', title: 'chat' }],
    }
    const { handler } = handlerWith({
      sessions,
      getAnswerPet: () => ({
        running: [{
          id: 's1',
          title: 'chat',
          view: { phase: 'tool', toolName: 'bash' },
          pendingInteraction: 'bash',
        }],
        active: true,
      }),
    })
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/snapshot?token=tok`)
    expect(r.body.sessions.items).toEqual([
      { id: 's1', title: 'chat', pendingInteraction: 'bash' },
    ])
    expect(r.body.sessions.items[0].running).toBeUndefined()
  })

  it('GET /snapshot marks a confirmation tool as awaiting, not merely running', async () => {
    const sessions = {
      list: () => [{ id: 's1', title: 'chat' }],
    }
    const { handler } = handlerWith({
      sessions,
      getAnswerPet: () => ({
        running: [{
          id: 's1',
          title: 'chat',
          view: { phase: 'tool', toolName: 'ask_user_question' },
          pendingInteraction: 'ask_user_question',
        }],
        active: true,
      }),
    })
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/snapshot?token=tok`)
    expect(r.status).toBe(200)
    expect(r.body.sessions.items).toEqual([
      { id: 's1', title: 'chat', pendingInteraction: 'ask_user_question' },
    ])
    expect(r.body.sessions.items[0].running).toBeUndefined()
  })

  it('GET /snapshot keeps pendingInteraction from the host session row', async () => {
    const sessions = {
      list: () => [{
        id: 's1',
        title: 'chat',
        header: { pendingInteraction: 'exit_plan_mode' },
        running: true,
      }],
    }
    const { handler } = handlerWith({ sessions })
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/snapshot?token=tok`)
    expect(r.body.sessions.items[0]).toEqual({
      id: 's1',
      title: 'chat',
      pendingInteraction: 'exit_plan_mode',
    })
    expect(r.body.sessions.items[0].running).toBeUndefined()
  })

  it('GET /events streams a snapshot and unsubscribes when the client closes', async () => {
    const unsub = vi.fn()
    const subscribeEdges = vi.fn(() => unsub)
    const { handler } = handlerWith({
      sessions: { list: () => [{ id: 's1', title: 'chat' }] },
      getAnswerPet: () => ({ running: [], active: false }),
      subscribeEdges,
    })
    const writes: string[] = []
    const listeners = new Map<string, () => void>()
    const res = {
      status: 0,
      headers: {} as Record<string, string>,
      writeHead(s: number, h?: Record<string, string>) {
        res.status = s
        res.headers = h ?? {}
      },
      write(chunk: string) { writes.push(String(chunk)); return true },
      end() {},
      on(event: string, listener: () => void) { listeners.set(event, listener) },
    }
    const req = {
      method: 'GET',
      url: `${PET_DESKTOP_PREFIX}/events?token=tok`,
      headers: { host: '127.0.0.1:3080' },
      [Symbol.asyncIterator]: async function* () {},
    }
    await handler(req as never, res as never)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(writes[0]).toMatch(/^data: /)
    expect(JSON.parse(writes[0]!.slice(5).trim()).sessions.items).toEqual([{ id: 's1', title: 'chat' }])
    expect(subscribeEdges).toHaveBeenCalled()
    listeners.get('close')?.()
    expect(unsub).toHaveBeenCalled()
  })

  it('GET /snapshot includes petDesktop so the overlay can highlight the current mode', async () => {
    const { handler } = handlerWith({
      getPetSettings: () => ({ petImage: 'x.png', petDesktop: true, petTheme: 'blue-whale' }),
    })
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/snapshot?token=tok`)
    expect(r.status).toBe(200)
    expect(r.body.settings.petDesktop).toBe(true)
    expect(r.body.settings.petTheme).toBe('blue-whale')
  })

  it('POST /settings persists petDesktop via updatePetSetting', async () => {
    const { handler, updatePetSetting } = handlerWith()
    const r = await call(handler, 'POST', `${PET_DESKTOP_PREFIX}/settings`, { petDesktop: true }, {
      ...mutationHeaders,
      'x-pet-token': 'tok',
    })
    expect(r.status).toBe(200)
    expect(updatePetSetting).toHaveBeenCalledWith({ petDesktop: true })
  })

  it('POST /settings rejects a wrong token', async () => {
    const { handler, updatePetSetting } = handlerWith()
    const r = await call(handler, 'POST', `${PET_DESKTOP_PREFIX}/settings`, { petDesktop: true }, mutationHeaders)
    expect(r.status).toBe(403)
    expect(updatePetSetting).not.toHaveBeenCalled()
  })

  it('/close without petDesktop:false does not persist the mode', async () => {
    const { handler, updatePetSetting } = handlerWith()
    const r = await call(handler, 'POST', `${PET_DESKTOP_PREFIX}/close`, {}, mutationHeaders)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, active: false })
    expect(updatePetSetting).not.toHaveBeenCalled()
  })

  it('/close with petDesktop:false persists browser mode via updatePetSetting', async () => {
    const { handler, updatePetSetting } = handlerWith()
    const r = await call(handler, 'POST', `${PET_DESKTOP_PREFIX}/close`, { petDesktop: false }, mutationHeaders)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, active: false })
    expect(updatePetSetting).toHaveBeenCalledWith({ petDesktop: false })
  })

  it('/close with petDesktop:false persists before killing the overlay', async () => {
    let persistResolved = false
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const updatePetSetting = vi.fn(async () => {
      await pending
      persistResolved = true
    })
    const close = vi.fn(() => {
      expect(persistResolved).toBe(true)
    })
    const { handler, controller } = handlerWith({ updatePetSetting })
    controller.close = close
    const done = call(handler, 'POST', `${PET_DESKTOP_PREFIX}/close`, { petDesktop: false }, mutationHeaders)
    await vi.waitFor(() => expect(updatePetSetting).toHaveBeenCalledWith({ petDesktop: false }))
    expect(close).not.toHaveBeenCalled()
    release()
    const r = await done
    expect(r.status).toBe(200)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('/close with petDesktop:true does not persist the mode', async () => {
    const { handler, updatePetSetting } = handlerWith()
    const r = await call(handler, 'POST', `${PET_DESKTOP_PREFIX}/close`, { petDesktop: true }, mutationHeaders)
    expect(r.status).toBe(200)
    expect(updatePetSetting).not.toHaveBeenCalled()
  })
})

/** Shared temp dir the renderer-route tests write fixture assets into. */
let assetsDir = ''
beforeAll(() => {
  assetsDir = mkdtempSync(join(tmpdir(), 'dsh-desktop-http-'))
})
afterAll(() => {
  rmSync(assetsDir, { recursive: true, force: true })
})