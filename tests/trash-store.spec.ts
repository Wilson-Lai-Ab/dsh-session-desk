import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { liveSessionDir } from '../src/session-path.ts'
import { createTrashStore, makeTrashId } from '../src/trash/store.ts'

const { renameState } = vi.hoisted(() => ({ renameState: { calls: 0, failAfter: 0 } }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (src: string, dest: string): Promise<void> => {
      renameState.calls += 1
      if (renameState.failAfter > 0 && renameState.calls > renameState.failAfter) {
        throw Object.assign(new Error('simulated'), { code: 'EIO' })
      }
      await actual.rename(src, dest)
    },
  }
})

describe('trash store', () => {
  let root = ''
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  async function setup() {
    root = await mkdtemp(join(tmpdir(), 'desk-trash-'))
    const cwd = '/Users/laiweibin/work/workSoftware/dhs-plugins'
    const sessionId = 'session-edd31b4a-43ab-40ee-9d1c-20b30693decb'
    const live = liveSessionDir(root, cwd, sessionId)
    await mkdir(live, { recursive: true })
    await writeFile(join(live, 'session.jsonl.zstd'), 'x')
    const now = 1_720_000_000_000
    const store = createTrashStore({ root: () => root, retentionDays: () => 30, now: () => now })
    return { cwd, sessionId, live, now, store }
  }

  it('moves a session directory into .trash with a manifest', async () => {
    const { cwd, sessionId, live, now, store } = await setup()
    const result = await store.trash({ sessionId, cwd, title: 'hello' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.trashId).toBe(makeTrashId(now, sessionId))
    await expect(stat(live)).rejects.toThrow()
    const manifest = JSON.parse(await readFile(join(root, '.trash', result.trashId, 'manifest.json'), 'utf8'))
    expect(manifest.sessionId).toBe(sessionId)
    expect(manifest.originalPath).toBe(live)
    expect(manifest.title).toBe('hello')
    expect(manifest.version).toBe(1)
    expect(manifest.deletedAt).toBe(now)
    await stat(join(root, '.trash', result.trashId, live.slice(root.length + 1)))
  })

  it('listTrash returns the row and listLive no longer includes it', async () => {
    const { cwd, sessionId, store } = await setup()
    const before = await store.listLive()
    expect(before.some(row => row.sessionId === sessionId)).toBe(true)
    const result = await store.trash({ sessionId, cwd, title: 'hello' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const live = await store.listLive()
    expect(live.some(row => row.sessionId === sessionId)).toBe(false)
    const trash = await store.listTrash()
    expect(trash).toHaveLength(1)
    expect(trash[0]!.trashId).toBe(result.trashId)
    expect(trash[0]!.sessionId).toBe(sessionId)
    expect(trash[0]!.title).toBe('hello')
  })

  it('restore() moves back to originalPath', async () => {
    const { cwd, sessionId, live, store } = await setup()
    const trashed = await store.trash({ sessionId, cwd, title: 'hello' })
    expect(trashed.ok).toBe(true)
    if (!trashed.ok) return
    const restored = await store.restore(trashed.trashId)
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.path).toBe(live)
    await stat(join(live, 'session.jsonl.zstd'))
    expect(await store.listTrash()).toHaveLength(0)
    expect((await store.listLive()).some(row => row.sessionId === sessionId)).toBe(true)
  })

  it('restore when originalPath exists uses originalPath-restored', async () => {
    const { cwd, sessionId, live, store } = await setup()
    const trashed = await store.trash({ sessionId, cwd, title: 'hello' })
    expect(trashed.ok).toBe(true)
    if (!trashed.ok) return
    await mkdir(live, { recursive: true })
    await writeFile(join(live, 'kept.txt'), 'live')
    const restored = await store.restore(trashed.trashId)
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.path).toBe(`${live}-restored`)
    await stat(join(`${live}-restored`, 'session.jsonl.zstd'))
    expect(await readFile(join(live, 'kept.txt'), 'utf8')).toBe('live')
  })

  it('sweepExpired removes only rows older than retentionDays', async () => {
    const { cwd, sessionId, store } = await setup()
    const old = await store.trash({ sessionId, cwd, title: 'old' })
    expect(old.ok).toBe(true)
    const freshId = 'session-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const freshLive = liveSessionDir(root, cwd, freshId)
    await mkdir(freshLive, { recursive: true })
    await writeFile(join(freshLive, 'session.jsonl.zstd'), 'y')
    const later = createTrashStore({
      root: () => root,
      retentionDays: () => 30,
      now: () => 1_720_000_000_000 + 10 * 86_400_000,
    })
    const fresh = await later.trash({ sessionId: freshId, cwd, title: 'fresh' })
    expect(fresh.ok).toBe(true)
    const expired = createTrashStore({
      root: () => root,
      retentionDays: () => 30,
      now: () => 1_720_000_000_000 + 30 * 86_400_000,
    })
    const swept = await expired.sweepExpired()
    expect(swept.removed).toBe(1)
    const remaining = await expired.listTrash()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.title).toBe('fresh')
  })

  it('sweepExpired does not touch another project live dirs', async () => {
    const { cwd, sessionId, store } = await setup()
    await store.trash({ sessionId, cwd, title: 'gone' })
    const otherCwd = '/tmp/other-project'
    const otherId = 'session-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    const otherLive = liveSessionDir(root, otherCwd, otherId)
    await mkdir(otherLive, { recursive: true })
    await writeFile(join(otherLive, 'keep.jsonl'), 'z')
    const expired = createTrashStore({
      root: () => root,
      retentionDays: () => 1,
      now: () => 1_720_000_000_000 + 2 * 86_400_000,
    })
    await expired.sweepExpired()
    await stat(join(otherLive, 'keep.jsonl'))
    expect((await expired.listLive()).some(row => row.sessionId === otherId)).toBe(true)
  })

  it('builds trashId from UTC stamp and last six safe session chars', () => {
    expect(makeTrashId(1_720_000_000_000, 'session-edd31b4a-43ab-40ee-9d1c-20b30693decb'))
      .toBe('20240703T094640-93decb')
    expect(makeTrashId(1_720_000_000_000, 'ab')).toBe('20240703T094640-xxxxab')
  })

  it('restore ignores escaped originalPath and stays under sessionsRoot', async () => {
    const { cwd, sessionId, live, store } = await setup()
    const trashed = await store.trash({ sessionId, cwd, title: 'hello' })
    expect(trashed.ok).toBe(true)
    if (!trashed.ok) return
    const outsideRoot = await mkdtemp(join(tmpdir(), 'desk-trash-escape-'))
    const escaped = join(outsideRoot, 'cron.d', 'x')
    const manifestPath = join(root, '.trash', trashed.trashId, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    manifest.originalPath = escaped
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    const restored = await store.restore(trashed.trashId)
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    const rel = relative(root, restored.path)
    expect(rel).not.toBe('')
    expect(rel.startsWith('..')).toBe(false)
    expect(restored.path).toBe(live)
    await stat(join(live, 'session.jsonl.zstd'))
    await expect(stat(escaped)).rejects.toThrow()
    await rm(outsideRoot, { recursive: true, force: true })
  })

  it('trashes parent + subagents into one entry with members', async () => {
    const { cwd, sessionId, store } = await setup()
    const childId = 'session-cccccccc-cccc-cccc-cccc-cccccccccccc'
    const grandId = 'session-dddddddd-dddd-dddd-dddd-dddddddddddd'
    const childLive = liveSessionDir(root, cwd, childId)
    const grandLive = liveSessionDir(root, cwd, grandId)
    await mkdir(childLive, { recursive: true })
    await writeFile(join(childLive, 'c.jsonl'), 'c')
    await mkdir(grandLive, { recursive: true })
    await writeFile(join(grandLive, 'g.jsonl'), 'g')

    const result = await store.trash({ sessionId, cwd, title: 'root', sessionIds: [sessionId, childId, grandId] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const manifest = JSON.parse(await readFile(join(root, '.trash', result.trashId, 'manifest.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.members).toHaveLength(3)
    expect((manifest.members as Array<{ sessionId: string }>)[0]!.sessionId).toBe(sessionId)
    await expect(stat(childLive)).rejects.toThrow()
    await expect(stat(grandLive)).rejects.toThrow()

    const rows = await store.listTrash()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.memberCount).toBe(2)
  })

  it('restore() brings back every member', async () => {
    const { cwd, sessionId, live, store } = await setup()
    const childId = 'session-cccccccc-cccc-cccc-cccc-cccccccccccc'
    const childLive = liveSessionDir(root, cwd, childId)
    await mkdir(childLive, { recursive: true })
    await writeFile(join(childLive, 'c.jsonl'), 'c')

    const trashed = await store.trash({ sessionId, cwd, title: 'root', sessionIds: [sessionId, childId] })
    expect(trashed.ok).toBe(true)
    if (!trashed.ok) return
    const restored = await store.restore(trashed.trashId)
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.path).toBe(live)
    await stat(join(childLive, 'c.jsonl'))
    expect(await store.listTrash()).toHaveLength(0)
  })

  it('keeps moved members when rollback fails (no data loss)', async () => {
    const { cwd, sessionId, live, now, store } = await setup()
    const childId = 'session-cccccccc-cccc-cccc-cccc-cccc-cccccccccccc'
    const childLive = liveSessionDir(root, cwd, childId)
    await mkdir(childLive, { recursive: true })
    await writeFile(join(childLive, 'c.jsonl'), 'c')

    renameState.calls = 0
    renameState.failAfter = 1
    try {
      const result = await store.trash({ sessionId, cwd, title: 'root', sessionIds: [sessionId, childId] })
      expect(result.ok).toBe(false)
      // entryDir preserved (not rm'd): the already-moved root is still recoverable inside
      const trashId = makeTrashId(now, sessionId)
      await stat(join(root, '.trash', trashId, relative(root, live)))
      // child never moved, still live
      await stat(join(childLive, 'c.jsonl'))
    } finally {
      renameState.failAfter = 0
      renameState.calls = 0
    }
  })
})
