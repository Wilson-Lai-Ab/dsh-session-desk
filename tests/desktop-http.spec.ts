import { describe, expect, it, afterAll, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
})

/** Shared temp dir the renderer-route tests write fixture assets into. */
let assetsDir = ''
beforeAll(() => {
  assetsDir = mkdtempSync(join(tmpdir(), 'dsh-desktop-http-'))
})
afterAll(() => {
  rmSync(assetsDir, { recursive: true, force: true })
})