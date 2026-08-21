/**
  * Loopback-only `/session-desk/api` handler. Mutations also require the
  * plugin marker header and `application/json`.
  */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { createTrashStore } from './trash/store.ts'
import type { SessionsRootSource } from './sessions-root.ts'
import { foldSnapshotRows, type AnswerSessionRow } from './answer/fold.ts'

export const MUTATION_HEADER = 'x-dsh-session-desk'
export const API_PREFIX = '/session-desk/api'
export const PET_ASSET_PREFIX = '/session-desk/assets/pet'

/** Answer-status-card route prefix (a GET sub-route under the API prefix). */
export const ANSWER_PET_PREFIX = `${API_PREFIX}/answer-pet`

/** Allowed static pet asset extensions → content type. */
const PET_ASSET_CONTENT_TYPES: Record<string, string> = {
  '.webm': 'video/webm',
  '.gif': 'image/gif',
  '.png': 'image/png',
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i
const FORGET_NAMES = ['forget', 'unload', 'remove', 'unregister'] as const
const RELOAD_NAMES = ['reindex', 'reload'] as const

export interface DeskHttpRequest {
  url?: string
  method?: string
  headers?: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
}

export interface DeskHttpResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

export interface SessionDeskHandlerOptions {
  resolveRoot: () => { root: string; source: SessionsRootSource }
  store: ReturnType<typeof createTrashStore>
  sessions: object
  agents?: object
}

function header(req: DeskHttpRequest, name: string): string | undefined {
  const raw = req.headers?.[name] ?? req.headers?.[name.toLowerCase()]
  if (Array.isArray(raw)) return raw[0]
  return raw
}

/** True when `Host` is loopback (`localhost` / `127.0.0.1` / `[::1]`, optional port). */
export function validateLoopbackHost(hostHeader: string | undefined): boolean {
  if (hostHeader === undefined || hostHeader === '') return false
  return LOOPBACK_HOST.test(hostHeader.trim())
}

function firstNamedFn(
  target: object,
  names: readonly string[],
  minArity: number,
): ((...args: unknown[]) => unknown) | undefined {
  const rec = target as Record<string, unknown>
  for (const name of names) {
    const fn = rec[name]
    if (typeof fn === 'function' && fn.length >= minArity) return fn as (...args: unknown[]) => unknown
  }
  return undefined
}

/** Call a whitelisted forget-style method if one exists; never invent other APIs. */
export function probeSessionForget(sessions: object, sessionId: string): void {
  const fn = firstNamedFn(sessions, FORGET_NAMES, 1)
  if (fn === undefined) return
  try {
    fn.call(sessions, sessionId)
  } catch {
    /* probe only */
  }
}

/** Call a whitelisted reload-style method if one exists; never invent other APIs. */
export function probeSessionReload(sessions: object): void {
  const fn = firstNamedFn(sessions, RELOAD_NAMES, 0)
  if (fn === undefined) return
  try {
    fn.call(sessions)
  } catch {
    /* probe only */
  }
}

/**
 * Detach one live entry (session or agent) from its store so a subsequent
 * `session.list` re-pull stops reporting it. The host `SessionStore` and
 * `agents` registry keep a public `store` Map and a public `detachEntered`
 * method; detaching a session also emits `session/disposed`, which the
 * apiproxy turns into `host/session-removed` for the client.
 */
function detachLiveEntry(target: object | undefined, id: string): boolean {
  if (target === undefined) return false
  const rec = target as Record<string, unknown>
  const store = rec.store
  const detachEntered = rec.detachEntered
  if (store === null || typeof store !== 'object' || typeof detachEntered !== 'function') return false
  const get = (store as { get?: unknown }).get
  if (typeof get !== 'function') return false
  const entry = (get as (key: string) => unknown).call(store, id)
  if (entry === undefined) return false
  try {
    ;(detachEntered as (entry: unknown) => void).call(target, entry)
    return true
  } catch {
    return false
  }
}

/** Best-effort cancel a live agent's turn before detaching it. */
function cancelLiveAgent(agents: object | undefined, id: string): void {
  if (agents === undefined) return
  const get = (agents as Record<string, unknown>).get
  if (typeof get !== 'function') return
  let agent: unknown
  try {
    agent = (get as (key: string) => unknown).call(agents, id)
  } catch {
    return
  }
  if (agent === null || typeof agent !== 'object') return
  const cancel = (agent as Record<string, unknown>).cancel
  if (typeof cancel !== 'function') return
  try {
    ;(cancel as (opts: unknown) => void).call(agent, { kind: 'disposed' })
  } catch {
    /* best-effort */
  }
}

function sessionIdOf(row: unknown): string | undefined {
  if (typeof row === 'string') return row
  if (row === null || typeof row !== 'object') return undefined
  const rec = row as Record<string, unknown>
  if (typeof rec.id === 'string') return rec.id
  if (typeof rec.sessionId === 'string') return rec.sessionId
  const header = rec.header
  if (header !== null && typeof header === 'object' && typeof (header as { id?: unknown }).id === 'string') {
    return (header as { id: string }).id
  }
  return undefined
}

function cwdOf(row: unknown): string | undefined {
  if (row === null || typeof row !== 'object') return undefined
  const rec = row as Record<string, unknown>
  if (typeof rec.cwd === 'string') return rec.cwd
  const header = rec.header
  if (header !== null && typeof header === 'object' && typeof (header as { cwd?: unknown }).cwd === 'string') {
    return (header as { cwd: string }).cwd
  }
  return undefined
}

function listedSessions(sessions: object): unknown[] {
  const list = (sessions as { list?: unknown }).list
  if (typeof list !== 'function') return []
  try {
    const snap = list.call(sessions)
    if (Array.isArray(snap)) return snap
    if (snap !== null && typeof snap === 'object') {
      const rec = snap as Record<string, unknown>
      if (Array.isArray(rec.items)) return rec.items
      if (rec.byId !== null && typeof rec.byId === 'object') return Object.values(rec.byId as Record<string, unknown>)
    }
  } catch {
    return []
  }
  return []
}

function currentSessionId(sessions: object): string | undefined {
  const list = (sessions as { list?: unknown }).list
  if (typeof list !== 'function') return undefined
  try {
    const snap = list.call(sessions)
    if (snap !== null && typeof snap === 'object' && !Array.isArray(snap)) {
      const rec = snap as Record<string, unknown>
      if (typeof rec.current === 'string') return rec.current
      if (typeof rec.currentId === 'string') return rec.currentId
    }
  } catch {
    return undefined
  }
  return undefined
}

async function switchAwayIfCurrent(sessions: object, sessionId: string, cwd: string | undefined): Promise<void> {
  if (currentSessionId(sessions) !== sessionId) return
  const other = listedSessions(sessions).find((row) => {
    const id = sessionIdOf(row)
    if (id === undefined || id === sessionId) return false
    if (cwd === undefined || cwd === '') return true
    return cwdOf(row) === cwd
  })
  const rec = sessions as Record<string, unknown>
  try {
    if (other !== undefined && typeof rec.open === 'function') {
      await (rec.open as (id: string) => unknown)(sessionIdOf(other)!)
      return
    }
    if (typeof rec.create === 'function') {
      await (rec.create as (opts: { cwd?: string }) => unknown)({ cwd })
    }
  } catch {
    /* still rename */
  }
}

function writeJson(res: DeskHttpResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: DeskHttpRequest): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of req) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk
    total += bytes.byteLength
    if (total > 1 << 20) throw Object.assign(new Error('request body too large'), { statusCode: 413 })
    chunks.push(bytes)
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))))
  if (text.trim() === '') return {}
  return JSON.parse(text) as unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function routeOf(url: string | undefined): string {
  const pathname = new URL(url ?? '/', 'http://dsh.internal').pathname.replace(/\/+$/, '')
  return pathname === '' ? '/' : pathname
}

function mutationAllowed(req: DeskHttpRequest): { ok: true } | { ok: false; status: number; error: string } {
  if (header(req, MUTATION_HEADER) !== '1') {
    return { ok: false, status: 403, error: 'forbidden mutation request' }
  }
  const contentType = (header(req, 'content-type') ?? '').split(';', 1)[0]!.trim().toLowerCase()
  if (contentType !== 'application/json') {
    return { ok: false, status: 415, error: 'content-type must be application/json' }
  }
  return { ok: true }
}

function cwdMapFromSessions(sessions: object): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of listedSessions(sessions)) {
    const id = sessionIdOf(row)
    const cwd = cwdOf(row)
    if (id !== undefined && cwd !== undefined) map.set(id, cwd)
  }
  return map
}

/** Prefix handler for `/session-desk/assets/pet` — serves bundled dsh-pet assets. */
export function createPetAssetHandler(assetsDir: string) {
  return async (req: DeskHttpRequest, res: DeskHttpResponse): Promise<void> => {
    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    if (!pathname.startsWith(`${PET_ASSET_PREFIX}/`)) {
      res.writeHead(404)
      res.end()
      return
    }
    const name = pathname.slice(PET_ASSET_PREFIX.length + 1)
    const match = /^[a-z0-9-]+\.(webm|gif|png)$/i.exec(name)
    if (match === null) {
      res.writeHead(404)
      res.end()
      return
    }
    const contentType = PET_ASSET_CONTENT_TYPES[`.${match[1].toLowerCase()}`]
    try {
      const body = await readFile(join(assetsDir, name))
      res.writeHead(200, {
        'content-type': contentType,
        'cache-control': 'public, max-age=86400',
      })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end()
    }
  }
}

/** Prefix handler for `/session-desk/api`. */
export function createSessionDeskHandler(opts: SessionDeskHandlerOptions) {
  return async (req: DeskHttpRequest, res: DeskHttpResponse): Promise<void> => {
    if (!validateLoopbackHost(header(req, 'host'))) {
      writeJson(res, 403, { ok: false, error: 'forbidden host' })
      return
    }
    const method = (req.method ?? 'GET').toUpperCase()
    const path = routeOf(req.url)
    try {
      if (method === 'GET' && path === `${API_PREFIX}/root`) {
        writeJson(res, 200, { ok: true, data: opts.resolveRoot() })
        return
      }
      if (method === 'GET' && path === `${API_PREFIX}/sessions`) {
        const cwdById = cwdMapFromSessions(opts.sessions)
        const rows = (await opts.store.listLive()).map(row => ({
          ...row,
          cwd: row.cwd !== '' ? row.cwd : (cwdById.get(row.sessionId) ?? ''),
        }))
        writeJson(res, 200, { ok: true, data: rows })
        return
      }
      if (method === 'GET' && path === `${API_PREFIX}/trash`) {
        writeJson(res, 200, { ok: true, data: await opts.store.listTrash() })
        return
      }
      if (method === 'GET' && path === `${ANSWER_PET_PREFIX}/state`) {
        const rows = listedSessions(opts.sessions) as unknown[]
        writeJson(res, 200, { ok: true, data: foldSnapshotRows(rows as AnswerSessionRow[]) })
        return
      }
      if (method !== 'POST') {
        writeJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const gate = mutationAllowed(req)
      if (!gate.ok) {
        writeJson(res, gate.status, { ok: false, error: gate.error })
        return
      }
      const body = asRecord(await readJsonBody(req))
      if (path === `${API_PREFIX}/trash`) {
        const sessionIds = Array.isArray(body.sessionIds)
          ? (body.sessionIds as unknown[]).filter((id): id is string => typeof id === 'string' && id !== '')
          : []
        const sessionId = sessionIds[0] ?? (typeof body.sessionId === 'string' ? body.sessionId : '')
        if (sessionId === '') {
          writeJson(res, 400, { ok: false, error: 'missing sessionId' })
          return
        }
        const cwd = typeof body.cwd === 'string' ? body.cwd : undefined
        const title = typeof body.title === 'string' ? body.title : sessionId
        const allIds = [...new Set(sessionIds.length > 0 ? sessionIds : [sessionId])]
        for (const id of allIds) await switchAwayIfCurrent(opts.sessions, id, id === sessionId ? cwd : undefined)
        const result = await opts.store.trash({ sessionId, cwd, title, ...(sessionIds.length > 0 ? { sessionIds } : {}) })
        if (!result.ok) {
          writeJson(res, result.code === 'not-found' ? 404 : 500, { ok: false, error: result.message, code: result.code })
          return
        }
        for (const id of allIds) {
          probeSessionForget(opts.sessions, id)
          cancelLiveAgent(opts.agents, id)
          detachLiveEntry(opts.agents, id)
          detachLiveEntry(opts.sessions, id)
        }
        writeJson(res, 200, { ok: true, data: { trashId: result.trashId } })
        return
      }
      if (path === `${API_PREFIX}/restore`) {
        const trashId = typeof body.trashId === 'string' ? body.trashId : ''
        if (trashId === '') {
          writeJson(res, 400, { ok: false, error: 'missing trashId' })
          return
        }
        const result = await opts.store.restore(trashId)
        if (!result.ok) {
          writeJson(res, result.code === 'not-found' ? 404 : 500, { ok: false, error: result.message, code: result.code })
          return
        }
        probeSessionReload(opts.sessions)
        writeJson(res, 200, { ok: true, data: { path: result.path } })
        return
      }
      if (path === `${API_PREFIX}/purge`) {
        if (body.all === true) {
          const result = await opts.store.purgeAll()
          writeJson(res, 200, { ok: true, data: { removed: result.removed } })
          return
        }
        const trashId = typeof body.trashId === 'string' ? body.trashId : ''
        if (trashId === '') {
          writeJson(res, 400, { ok: false, error: 'missing trashId' })
          return
        }
        const result = await opts.store.purge(trashId)
        if (!result.ok) {
          writeJson(res, result.code === 'not-found' ? 404 : 500, { ok: false, error: result.message, code: result.code })
          return
        }
        writeJson(res, 200, { ok: true })
        return
      }
      writeJson(res, 404, { ok: false, error: `unknown method "${path}"` })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = error instanceof Error && 'statusCode' in error && typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 400
      writeJson(res, status, { ok: false, error: message })
    }
  }
}
