import { header, routeOf, writeJson, readJsonBody, mutationAllowed, asRecord, validateLoopbackHost, listedSessions, type DeskHttpRequest, type DeskHttpResponse } from '../http.ts'
import type { SessionDeskSettings } from '../shared.ts'
import type { DesktopPetController } from './lifecycle.ts'

export const PET_DESKTOP_PREFIX = '/session-desk/pet-desktop'

export interface DesktopPetHandlerOptions {
  sessions: object
  controller: DesktopPetController
  getPetSettings: () => Partial<SessionDeskSettings>
  token: string
  state: { pendingOpen: { id: string; at: number } | null }
}

export function createDesktopPetHandler(opts: DesktopPetHandlerOptions) {
  return async (req: DeskHttpRequest, res: DeskHttpResponse): Promise<void> => {
    if (!validateLoopbackHost(header(req, 'host'))) { writeJson(res, 403, { ok: false, error: 'forbidden host' }); return }
    const method = (req.method ?? 'GET').toUpperCase()
    const path = routeOf(req.url)
    const token = new URL(req.url ?? '', 'http://x').searchParams.get('token') ?? header(req, 'x-pet-token') ?? ''

    if (method === 'GET' && path === `${PET_DESKTOP_PREFIX}/status`) {
      writeJson(res, 200, { ok: true, active: opts.controller.isActive(), pendingOpen: opts.state.pendingOpen })
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
      await opts.controller.spawn(`http://${host}`, opts.token)
      writeJson(res, 200, { ok: true, active: true })
      return
    }
    if (path === `${PET_DESKTOP_PREFIX}/close`) {
      opts.controller.close()
      writeJson(res, 200, { ok: true, active: false })
      return
    }
    if (path === `${PET_DESKTOP_PREFIX}/open`) {
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