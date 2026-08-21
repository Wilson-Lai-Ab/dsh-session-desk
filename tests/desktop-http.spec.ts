import { describe, expect, it } from 'vitest'
import { createDesktopPetHandler, PET_DESKTOP_PREFIX } from '../src/desktop/http.ts'
import { createDesktopPetController } from '../src/desktop/lifecycle.ts'

function handlerWith(overrides = {}) {
  const state = { pendingOpen: null as { id: string; at: number } | null }
  const controller = {
    ...createDesktopPetController(),
    spawn: async () => { controller.active = true },
    isActive: () => Boolean(controller.active),
  }
  const handler = createDesktopPetHandler({
    sessions: {},
    controller,
    getPetSettings: () => ({ petImage: 'x.png' }),
    token: 'tok',
    state,
    ...overrides,
  } as never)
  return { handler, state, controller }
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

describe('desktop-pet endpoints', () => {
  it('GET /status returns active', async () => {
    const { handler, controller } = handlerWith()
    controller.spawn('http://x', 'tok').catch(() => {})
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/status`)
    expect(r.status).toBe(200)
    expect(r.body.active).toBe(true)
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
})