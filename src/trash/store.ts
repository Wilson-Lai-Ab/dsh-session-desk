/**
  * Sessions-root trash: rename a live session tree into `.trash/<id>/`,
  * restore it, and sweep expired entries. Never follows symlinks.
  */
import { cp, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { encodeSessionSegment, liveSessionDir } from '../session-path.ts'
import type {
  LiveSessionRow,
  PurgeResult,
  RestoreResult,
  TrashManifest,
  TrashMember,
  TrashResult,
} from './types.ts'

export type { LiveSessionRow, TrashManifest } from './types.ts'

const TRASH_DIR = '.trash'
const MANIFEST = 'manifest.json'
const DAY_MS = 86_400_000

export interface TrashStoreOptions {
  root: () => string
  retentionDays: () => number
  now?: () => number
}

function nowMs(opts: TrashStoreOptions): number {
  return opts.now ? opts.now() : Date.now()
}

function ioFail(error: unknown): { ok: false; code: 'io'; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, code: 'io', message }
}

/** UTC `YYYYMMDDTHHMMSS` plus `-` plus the last six `[A-Za-z0-9]` chars (left-padded with `x`). */
export function makeTrashId(deletedAt: number, sessionId: string): string {
  const iso = new Date(deletedAt).toISOString().replace(/[-:]/g, '').slice(0, 15)
  const safe = [...sessionId].filter(ch => /[A-Za-z0-9]/.test(ch)).join('')
  const short = safe.slice(-6).padStart(6, 'x')
  return `${iso}-${short}`
}

/** Inverse of `encodeSessionSegment`; unknown `~` sequences stay literal. */
export function decodeSessionSegment(encoded: string): string {
  let out = ''
  for (let i = 0; i < encoded.length; i += 1) {
    const ch = encoded[i]!
    if (ch === '~' && i + 4 < encoded.length) {
      const hex = encoded.slice(i + 1, i + 5)
      if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
        out += String.fromCharCode(Number.parseInt(hex, 16))
        i += 4
        continue
      }
    }
    out += ch
  }
  return out
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function pathTaken(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

function isInsideSessionsRoot(root: string, dest: string): boolean {
  const rel = relative(root, dest)
  return rel !== '' && !rel.startsWith('..')
}

async function jsonlSize(sessionDir: string): Promise<number> {
  for (const name of ['session.jsonl.zstd', 'session.jsonl']) {
    try {
      const info = await lstat(join(sessionDir, name))
      if (info.isSymbolicLink()) continue
      if (info.isFile()) return info.size
    } catch {
      /* missing encoding */
    }
  }
  return 0
}

async function dirSize(path: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(path, entry.name)
    try {
      const info = await lstat(full)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) total += await dirSize(full)
      else total += info.size
    } catch {
      /* skip unreadable */
    }
  }
  return total
}

async function moveTree(src: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  try {
    await rename(src, dest)
    return
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined
    if (code !== 'EXDEV') throw error
  }
  try {
    await cp(src, dest, { recursive: true, errorOnExist: true })
  } catch (error) {
    await rm(dest, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  await rm(src, { recursive: true, force: true })
}

function trashRoot(root: string): string {
  return join(root, TRASH_DIR)
}

function trashEntryDir(root: string, trashId: string): string {
  return join(trashRoot(root), trashId)
}

function isSafeTrashId(trashId: string): boolean {
  return trashId.length > 0 && !trashId.includes('/') && !trashId.includes('\\') && trashId !== '.' && trashId !== '..'
}

async function readManifest(dir: string): Promise<TrashManifest | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')) as Partial<TrashManifest>
    if (raw.version !== 1 || typeof raw.sessionId !== 'string' || typeof raw.originalPath !== 'string') return undefined
    return {
      version: 1,
      sessionId: raw.sessionId,
      cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
      title: typeof raw.title === 'string' ? raw.title : '',
      deletedAt: typeof raw.deletedAt === 'number' ? raw.deletedAt : 0,
      originalPath: raw.originalPath,
      bytes: typeof raw.bytes === 'number' ? raw.bytes : 0,
      ...(Array.isArray(raw.members) ? { members: raw.members as TrashMember[] } : {}),
    }
  } catch {
    return undefined
  }
}

async function nestedSessionDir(entryDir: string, originalPath: string, root: string): Promise<string | undefined> {
  const rel = relative(root, originalPath)
  if (rel && !rel.startsWith('..') && !rel.startsWith(`..${sep}`)) {
    const candidate = join(entryDir, rel)
    if (await exists(candidate)) return candidate
  }
  let projects
  try {
    projects = await readdir(entryDir, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const project of projects) {
    if (!project.isDirectory() || project.name === MANIFEST) continue
    const projectDir = join(entryDir, project.name)
    let sessions
    try {
      sessions = await readdir(projectDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const session of sessions) {
      if (session.isDirectory()) return join(projectDir, session.name)
    }
  }
  return undefined
}

function restoreDestination(originalPath: string, taken: (path: string) => Promise<boolean>): Promise<string> {
  return (async () => {
    if (!await taken(originalPath)) return originalPath
    const first = `${originalPath}-restored`
    if (!await taken(first)) return first
    for (let n = 2; n < 10_000; n += 1) {
      const next = `${originalPath}-restored-${n}`
      if (!await taken(next)) return next
    }
    throw new Error('could not allocate a restore path')
  })()
}

export function createTrashStore(opts: TrashStoreOptions) {
  async function listLive(): Promise<LiveSessionRow[]> {
    const root = opts.root()
    const rows: LiveSessionRow[] = []
    let projects
    try {
      projects = await readdir(root, { withFileTypes: true })
    } catch {
      return rows
    }
    for (const project of projects) {
      if (!project.isDirectory() || project.name === TRASH_DIR) continue
      const projectDir = join(root, project.name)
      let sessions
      try {
        sessions = await readdir(projectDir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const session of sessions) {
        if (!session.isDirectory()) continue
        const path = join(projectDir, session.name)
        let sessionId = session.name
        try {
          sessionId = decodeSessionSegment(session.name)
        } catch {
          sessionId = session.name
        }
        rows.push({
          sessionId,
          cwd: '',
          path,
          bytes: await dirSize(path),
          jsonlBytes: await jsonlSize(path),
        })
      }
    }
    return rows
  }

  async function resolveLive(sessionId: string, cwd: string | undefined): Promise<string | undefined> {
    const root = opts.root()
    const direct = cwd !== undefined ? liveSessionDir(root, cwd, sessionId) : undefined
    if (direct !== undefined && await exists(direct)) return direct
    const encoded = encodeSessionSegment(sessionId)
    const found = (await listLive()).find(row => row.sessionId === sessionId || row.path.endsWith(`${sep}${encoded}`))
    return found?.path
  }

  async function trash(input: { sessionId: string; cwd?: string; title: string; sessionIds?: string[] }): Promise<TrashResult> {
    const ids = Array.isArray(input.sessionIds) && input.sessionIds.length > 0 ? input.sessionIds : [input.sessionId]
    const members: Array<{ sessionId: string; path: string }> = []
    for (let i = 0; i < ids.length; i += 1) {
      const sessionId = ids[i]!
      const cwd = sessionId === input.sessionId ? input.cwd : undefined
      const path = await resolveLive(sessionId, cwd)
      if (path === undefined) continue
      members.push({ sessionId, path })
    }
    if (members.length === 0 || members.every(member => member.sessionId !== input.sessionId)) {
      return { ok: false, code: 'not-found', message: '磁盘上已不在，刷新列表' }
    }
    return trashMembers(members, input)
  }

  async function trashMembers(
    members: Array<{ sessionId: string; path: string }>,
    input: { cwd?: string; title: string },
  ): Promise<TrashResult> {
    const root = opts.root()
    const deletedAt = nowMs(opts)
    const rootId = members[0]?.sessionId ?? ''
    const trashId = makeTrashId(deletedAt, rootId)
    const entryDir = trashEntryDir(root, trashId)
    try {
      let bytes = 0
      for (const member of members) bytes += await dirSize(member.path)
      await mkdir(entryDir, { recursive: true })
      for (const member of members) {
        await moveTree(member.path, join(entryDir, relative(root, member.path)))
      }
      const manifest: TrashManifest = {
        version: 1,
        sessionId: rootId,
        cwd: input.cwd ?? '',
        title: input.title,
        deletedAt,
        originalPath: members[0]?.path ?? '',
        bytes,
        ...(members.length > 1 ? { members: members.map(m => ({ sessionId: m.sessionId, originalPath: m.path })) } : {}),
      }
      await writeFile(join(entryDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      return { ok: true, trashId, sessionIds: members.map(member => member.sessionId) }
    } catch (error) {
      let restored = true
      for (const member of members) {
        if (await exists(member.path)) continue
        const dest = join(entryDir, relative(root, member.path))
        if (await exists(dest)) {
          try {
            await moveTree(dest, member.path)
          } catch {
            restored = false
          }
        }
      }
      if (restored) await rm(entryDir, { recursive: true, force: true }).catch(() => undefined)
      return ioFail(error)
    }
  }

  async function listTrash(): Promise<Array<TrashManifest & { trashId: string; memberCount: number; kind: 'entry' | 'orphan' }>> {
    const root = opts.root()
    const base = trashRoot(root)
    let entries
    try {
      entries = await readdir(base, { withFileTypes: true })
    } catch {
      return []
    }
    const rows: Array<TrashManifest & { trashId: string; memberCount: number; kind: 'entry' | 'orphan' }> = []
    for (const entry of entries) {
      if (!isSafeTrashId(entry.name)) continue
      const entryDir = join(base, entry.name)
      let info
      try {
        info = await lstat(entryDir)
      } catch {
        continue
      }
      if (info.isSymbolicLink() || !info.isDirectory()) continue
      const manifest = await readManifest(entryDir)
      if (manifest !== undefined) {
        const memberCount = manifest.members !== undefined ? manifest.members.length - 1 : 0
        rows.push({ ...manifest, trashId: entry.name, memberCount, kind: 'entry' })
        continue
      }
      const bytes = await dirSize(entryDir)
      rows.push({
        version: 1,
        sessionId: '',
        cwd: '',
        title: entry.name,
        deletedAt: info.mtimeMs,
        originalPath: '',
        bytes,
        trashId: entry.name,
        memberCount: 0,
        kind: 'orphan',
      })
    }
    rows.sort((a, b) => b.deletedAt - a.deletedAt)
    return rows
  }

  async function restore(trashId: string): Promise<RestoreResult> {
    if (!isSafeTrashId(trashId)) return { ok: false, code: 'not-found', message: '磁盘上已不在，刷新列表' }
    const root = opts.root()
    const entryDir = trashEntryDir(root, trashId)
    const manifest = await readManifest(entryDir)
    if (manifest === undefined) return { ok: false, code: 'not-found', message: '磁盘上已不在，刷新列表' }
    if (manifest.members !== undefined && manifest.members.length > 0) {
      return restoreMembers(root, entryDir, manifest)
    }
    const nested = await nestedSessionDir(entryDir, manifest.originalPath, root)
    if (nested === undefined) return { ok: false, code: 'not-found', message: '磁盘上已不在，刷新列表' }
    try {
      const base = isInsideSessionsRoot(root, manifest.originalPath)
        ? manifest.originalPath
        : liveSessionDir(root, manifest.cwd, manifest.sessionId)
      const dest = await restoreDestination(base, pathTaken)
      if (!isInsideSessionsRoot(root, dest)) {
        return { ok: false, code: 'io', message: 'restore destination escaped sessions root' }
      }
      await moveTree(nested, dest)
      await rm(entryDir, { recursive: true, force: true })
      return { ok: true, path: dest }
    } catch (error) {
      return ioFail(error)
    }
  }

  async function restoreMembers(root: string, entryDir: string, manifest: TrashManifest): Promise<RestoreResult> {
    try {
      const members = manifest.members!
      const dests: string[] = []
      for (const member of members) {
        const nested = join(entryDir, relative(root, member.originalPath))
        if (!await exists(nested)) return { ok: false, code: 'not-found', message: '磁盘上已不在，刷新列表' }
        const dest = await restoreDestination(member.originalPath, pathTaken)
        if (!isInsideSessionsRoot(root, dest)) {
          return { ok: false, code: 'io', message: 'restore destination escaped sessions root' }
        }
        dests.push(dest)
      }
      for (let i = 0; i < members.length; i += 1) {
        await moveTree(join(entryDir, relative(root, members[i]!.originalPath)), dests[i]!)
      }
      await rm(entryDir, { recursive: true, force: true })
      return { ok: true, path: dests[0]! }
    } catch (error) {
      return ioFail(error)
    }
  }

  async function purge(trashId: string): Promise<PurgeResult> {
    if (!isSafeTrashId(trashId)) return { ok: false, code: 'not-found', message: '磁盘上已不在，刷新列表' }
    const entryDir = trashEntryDir(opts.root(), trashId)
    if (!await exists(entryDir)) return { ok: false, code: 'not-found', message: '磁盘上已不在，刷新列表' }
    try {
      await rm(entryDir, { recursive: true, force: true })
      return { ok: true }
    } catch (error) {
      return ioFail(error)
    }
  }

  async function purgeAll(): Promise<{ ok: true; removed: number; orphanRemoved: number; bytesFreed: number }> {
    const rows = await listTrash()
    let removed = 0
    let orphanRemoved = 0
    let bytesFreed = 0
    for (const row of rows) {
      const result = await purge(row.trashId)
      if (!result.ok) continue
      removed += 1
      bytesFreed += row.bytes
      if (row.kind === 'orphan') orphanRemoved += 1
    }
    return { ok: true, removed, orphanRemoved, bytesFreed }
  }

  async function sweepExpired(): Promise<{ removed: number }> {
    const retention = opts.retentionDays()
    const cutoff = nowMs(opts)
    const rows = await listTrash()
    let removed = 0
    for (const row of rows) {
      if (row.deletedAt + retention * DAY_MS > cutoff) continue
      try {
        const result = await purge(row.trashId)
        if (result.ok) removed += 1
        else console.error(`[dsh-session-desk] sweep failed for ${row.trashId}: ${result.message}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[dsh-session-desk] sweep failed for ${row.trashId}: ${message}`)
      }
    }
    return { removed }
  }

  return { listLive, trash, listTrash, restore, purge, purgeAll, sweepExpired }
}
