import { header, routeOf, writeJson, readJsonBody, mutationAllowed, asRecord, validateLoopbackHost, listedSessions, sessionIdOf, type DeskHttpRequest, type DeskHttpResponse } from '../http.ts'
import { readFile } from 'node:fs/promises'
import type { SessionDeskSettings } from '../shared.ts'
import type { DesktopPetController } from './lifecycle.ts'
import { isConfirmationTool } from '../client/pet/status.ts'

export const PET_DESKTOP_PREFIX = '/session-desk/pet-desktop'

export interface DesktopPetHandlerOptions {
  sessions: object
  controller: DesktopPetController
  getPetSettings: () => Partial<SessionDeskSettings>
  updatePetSetting: (patch: Partial<SessionDeskSettings>) => Promise<void>
  token: string
  state: { pendingOpen: { id: string; at: number } | null }
  shellAssets?: { rendererHtml: string; rendererJs: string }
  getAnswerPet?: () => {
    running?: readonly { id?: string; title?: string | null }[]
    session?: { id?: string; title?: string | null } | null
    active?: boolean
  } | undefined
  subscribeEdges?: (sink: () => void) => () => void
}

export function createDesktopPetHandler(opts: DesktopPetHandlerOptions) {
  return async (req: DeskHttpRequest, res: DeskHttpResponse): Promise<void> => {
    if (!validateLoopbackHost(header(req, 'host'))) { writeJson(res, 403, { ok: false, error: 'forbidden host' }); return }
    const method = (req.method ?? 'GET').toUpperCase()
    const path = routeOf(req.url)
    const token = new URL(req.url ?? '', 'http://x').searchParams.get('token') ?? header(req, 'x-pet-token') ?? ''

    // Static shell assets (renderer.html + renderer.js) are GETs served before the
    // mutation gate, mirroring createPetAssetHandler's file-read + content-type +
    // cache-header pattern. No token required — these are inert web resources.
    if (method === 'GET' && path === `${PET_DESKTOP_PREFIX}/renderer.html`) {
      await serveFile(res, opts.shellAssets?.rendererHtml, 'text/html; charset=utf-8')
      return
    }
    if (method === 'GET' && path === `${PET_DESKTOP_PREFIX}/renderer.js`) {
      await serveFile(res, opts.shellAssets?.rendererJs, 'text/javascript; charset=utf-8')
      return
    }

    if (method === 'GET' && path === `${PET_DESKTOP_PREFIX}/status`) {
      writeJson(res, 200, {
        ok: true,
        active: opts.controller.isActive(),
        ready: opts.controller.isReady(),
        pendingOpen: opts.state.pendingOpen,
        download: opts.controller.downloadState(),
      })
      return
    }
    if (method === 'GET' && path === `${PET_DESKTOP_PREFIX}/snapshot`) {
      if (token !== opts.token) { writeJson(res, 403, { ok: false, error: 'bad token' }); return }
      writeJson(res, 200, desktopSnapshot(opts))
      return
    }
    if (method === 'GET' && path === `${PET_DESKTOP_PREFIX}/events`) {
      if (token !== opts.token) { writeJson(res, 403, { ok: false, error: 'bad token' }); return }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      const send = (): void => {
        res.write?.(`data: ${JSON.stringify(desktopSnapshot(opts))}\n\n`)
      }
      send()
      const unsub = opts.subscribeEdges?.(send) ?? (() => {})
      const onClose = (): void => { unsub() }
      res.on?.('close', onClose)
      return
    }
    if (method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
    const gate = mutationAllowed(req)
    if (!gate.ok) { writeJson(res, gate.status, { ok: false, error: gate.error }); return }
    const body = asRecord(await readJsonBody(req))

    if (path === `${PET_DESKTOP_PREFIX}/spawn`) {
      const host = header(req, 'host') ?? '127.0.0.1:3080'
      // Non-blocking: kick off the Electron download + shell launch in the
      // background and return 202 Accepted. Download progress and the final
      // ready/failed state are exposed via GET /status (downloadState).
      void opts.controller.spawn(`http://${host}`, opts.token)
      writeJson(res, 202, { ok: true, active: opts.controller.isActive(), downloading: true })
      return
    }
    if (path === `${PET_DESKTOP_PREFIX}/settings`) {
      if (token !== opts.token) { writeJson(res, 403, { ok: false, error: 'bad token' }); return }
      const patch: Partial<{ petDesktop: boolean; petX: number; petY: number }> = {}
      if (typeof body.petDesktop === 'boolean') patch.petDesktop = body.petDesktop
      if (typeof body.petX === 'number') patch.petX = body.petX
      if (typeof body.petY === 'number') patch.petY = body.petY
      if (Object.keys(patch).length === 0) { writeJson(res, 400, { ok: false, error: 'empty patch' }); return }
      await opts.updatePetSetting(patch)
      if (patch.petDesktop === false) opts.controller.close()
      writeJson(res, 200, { ok: true })
      return
    }
    if (path === `${PET_DESKTOP_PREFIX}/ready`) {
      if (token !== opts.token) { writeJson(res, 403, { ok: false, error: 'bad token' }); return }
      opts.controller.markReady()
      writeJson(res, 200, { ok: true, ready: opts.controller.isReady() })
      return
    }
    if (path === `${PET_DESKTOP_PREFIX}/close`) {
      opts.controller.close()
      // Persist browser mode when the desktop pet is being closed by the 浏览器
      // selector button (Fix 2): the browser pet's own update is a no-op here.
      if (body.petDesktop === false) await opts.updatePetSetting({ petDesktop: false })
      writeJson(res, 200, { ok: true, active: false })
      return
    }
    if (path === `${PET_DESKTOP_PREFIX}/open`) {
      if (token !== opts.token) { writeJson(res, 403, { ok: false, error: 'bad token' }); return }
      const id = typeof body.id === 'string' ? body.id : ''
      if (id === '') { writeJson(res, 400, { ok: false, error: 'missing id' }); return }
      opts.state.pendingOpen = { id, at: Date.now() }
      writeJson(res, 200, { ok: true })
      return
    }
    if (path === `${PET_DESKTOP_PREFIX}/ack-open`) {
      const at = typeof body.at === 'number' ? body.at : 0
      if (opts.state.pendingOpen?.at === at) opts.state.pendingOpen = null
      writeJson(res, 200, { ok: true })
      return
    }
    writeJson(res, 404, { ok: false, error: 'not found' })
  }
}

function confirmationToolOf(card: unknown): string | undefined {
  if (card === null || typeof card !== 'object') return undefined
  const rec = card as {
    pendingInteraction?: unknown
    toolName?: unknown
    view?: { phase?: unknown; toolName?: unknown }
  }
  const pending = typeof rec.pendingInteraction === 'string' ? rec.pendingInteraction.trim() : ''
  if (pending !== '') return pending
  const tool = typeof rec.view?.toolName === 'string' ? rec.view.toolName
    : typeof rec.toolName === 'string' ? rec.toolName
      : ''
  const trimmed = tool.trim()
  return isConfirmationTool(trimmed) ? trimmed : undefined
}

function desktopSnapshot(opts: DesktopPetHandlerOptions) {
  const answerPet = opts.getAnswerPet?.() ?? { running: [], active: false }
  const titles = titleIndex(answerPet)
  const runningIds = new Set((answerPet.running ?? []).map(card => card.id).filter((id): id is string => typeof id === 'string' && id !== ''))
  const awaitingById = new Map<string, string>()
  for (const card of answerPet.running ?? []) {
    const rec = card as { id?: unknown }
    if (typeof rec.id !== 'string' || rec.id === '') continue
    const tool = confirmationToolOf(card)
    if (tool !== undefined) awaitingById.set(rec.id, tool)
  }
  const items = listedSessions(opts.sessions).map(row => {
    const projected = projectDesktopSession(row)
    const id = typeof projected.id === 'string' ? projected.id : undefined
    if (id !== undefined && titles.has(id)) {
      projected.title = titles.get(id)
    } else if (id !== undefined && typeof projected.title !== 'string') {
      const folded = cachedTitleFromLog(id, row)
      if (folded !== undefined) projected.title = folded
    }
    if (id !== undefined && awaitingById.has(id)) {
      const next = { ...projected, pendingInteraction: projected.pendingInteraction ?? awaitingById.get(id) }
      delete next.running
      return next
    }
    if (id !== undefined && runningIds.has(id) && projected.running !== true) {
      return { ...projected, running: true }
    }
    return projected
  })
  const titleById = new Map<string, string>()
  for (const item of items) {
    if (typeof item.id === 'string' && typeof item.title === 'string' && item.title !== '') {
      titleById.set(item.id, item.title)
    }
  }
  const running = (answerPet.running ?? []).map(card => {
    if (card === null || typeof card !== 'object') return card
    const rec = card as { id?: string; title?: string | null }
    if (typeof rec.id !== 'string') return card
    if (typeof rec.title === 'string' && rec.title !== '') return card
    const title = titles.get(rec.id) ?? titleById.get(rec.id)
    return title === undefined ? card : { ...rec, title }
  })
  return { ok: true, sessions: { items }, settings: opts.getPetSettings(), answerPet: { ...answerPet, running } }
}

/** Last `session/title` per live session. Walks `log` once; never copies it into JSON. */
const titlesFromLog = new Map<string, string>()

function cachedTitleFromLog(id: string, row: unknown): string | undefined {
  const cached = titlesFromLog.get(id)
  if (cached !== undefined) return cached
  if (row === null || typeof row !== 'object') return undefined
  const log = (row as { log?: unknown }).log
  if (!Array.isArray(log)) return undefined
  let title: string | undefined
  for (const event of log) {
    if (event === null || typeof event !== 'object') continue
    const rec = event as { type?: unknown; data?: unknown }
    if (rec.type !== 'session/title') continue
    const data = rec.data
    if (data !== null && typeof data === 'object') {
      const next = (data as { title?: unknown }).title
      if (typeof next === 'string' && next !== '') title = next
    }
  }
  if (title !== undefined) titlesFromLog.set(id, title)
  return title
}

function titleIndex(answerPet: { running?: readonly { id?: string; title?: string | null }[]; session?: { id?: string; title?: string | null } | null }): Map<string, string> {
  const titles = new Map<string, string>()
  const take = (id: string | undefined, title: string | null | undefined): void => {
    if (typeof id !== 'string' || id === '') return
    if (typeof title !== 'string' || title === '') return
    titles.set(id, title)
  }
  take(answerPet.session?.id, answerPet.session?.title)
  for (const card of answerPet.running ?? []) take(card.id, card.title)
  return titles
}

/**
 * Pet overlay only needs identity + status flags. Host `sessions.list()` returns
 * live Session objects whose enumerable `log` / `events` are the full expanded
 * transcript — JSON.stringify of those on every assistant/chunk is the desktop
 * OOM path (Utf8Length / Buffer.byteLength).
 */
function projectDesktopSession(row: unknown): Record<string, unknown> {
  if (typeof row === 'string') return { id: row }
  if (row === null || typeof row !== 'object') return {}
  const rec = row as Record<string, unknown>
  const header = rec.header !== null && typeof rec.header === 'object'
    ? rec.header as Record<string, unknown>
    : undefined
  const out: Record<string, unknown> = {}
  const id = sessionIdOf(row)
  if (id !== undefined) out.id = id
  if (typeof rec.title === 'string' && rec.title !== '') out.title = rec.title
  if (typeof rec.displayTitle === 'string' && rec.displayTitle !== '') out.displayTitle = rec.displayTitle
  const openState = rec.openState ?? header?.openState
  if (typeof openState === 'string' && openState !== '') out.openState = openState
  if (rec.running === true) out.running = true
  const pending = rec.pendingInteraction ?? header?.pendingInteraction
  if (typeof pending === 'string' && pending !== '') out.pendingInteraction = pending
  if (rec.error === true || typeof rec.error === 'string') out.error = rec.error
  if (rec.failed === true) out.failed = true
  const origin = rec.origin ?? header?.origin
  if (typeof origin === 'string') out.origin = origin
  const parent = rec.parentId ?? rec.parentSessionId ?? header?.parentSession
  if (typeof parent === 'string' && parent !== '') out.parentSessionId = parent
  return out
}

/** Serve a static shell file verbatim, 404 when absent. Mirrors createPetAssetHandler. */
async function serveFile(res: DeskHttpResponse, file: string | undefined, contentType: string): Promise<void> {
  if (file === undefined) { res.writeHead(404); res.end(); return }
  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
}