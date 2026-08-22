import { header, routeOf, writeJson, readJsonBody, mutationAllowed, asRecord, validateLoopbackHost, listedSessions, type DeskHttpRequest, type DeskHttpResponse } from '../http.ts'
import { readFile } from 'node:fs/promises'
import type { SessionDeskSettings } from '../shared.ts'
import type { DesktopPetController } from './lifecycle.ts'

export const PET_DESKTOP_PREFIX = '/session-desk/pet-desktop'

export interface DesktopPetHandlerOptions {
  sessions: object
  controller: DesktopPetController
  getPetSettings: () => Partial<SessionDeskSettings>
  updatePetSetting: (patch: Partial<SessionDeskSettings>) => Promise<void>
  token: string
  state: { pendingOpen: { id: string; at: number } | null }
  shellAssets?: { rendererHtml: string; rendererJs: string }
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
      writeJson(res, 200, { ok: true, sessions: { items: listedSessions(opts.sessions) }, settings: opts.getPetSettings() })
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