# dsh-session-desk v2 Implementation Plan（看板图表化 + 废纸篓侧栏级联）

> **For agentic workers:** Pick the execution skill from using-superpowers
> Execution Routing (S = this session, no SDD; M = executing-plans;
> L = subagent-driven-development). Do not default to SDD. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Class:** M — two features of one plugin increment (board charts, trash sidebar+cascade) threaded through several modules; one shippable unit (shared `lib/client.js` + git history), not two independently-shippable subsystems.

**Goal:** Make the conversation 看板 render real charts, and add a sidebar-footer 废纸篓 with drag-to-delete + cascade (parent + `origin: 'subagent'` descendants into one trash entry).

**Architecture:** Board is client-only — extend `collectModelSamples` to carry `turn`, add pure chart-data helpers in `src/board/chart-data.ts`, render div/`conic-gradient` charts in `src/client/board/charts.tsx`. Trash is a `sidebar.footer.action` client entry + a host multi-member trash store (client resolves the subagent subtree from `useSessions`, host moves dirs).

**Tech Stack:** TypeScript, React (JSX), esbuild (`node build.mjs`), vitest, node:fs/promises. No npm chart library.

**Spec:** `docs/superpowers/specs/2026-08-20-session-desk-v2-design.md`

## Global Constraints

- 零运行时 npm 依赖：图表用 `div` + `conic-gradient`，不引 recharts/d3/chart.js。
- 配色走 DSW 别名变量（`--dsw-alias-brand-primary`、`--dsw-alias-border-l2`、`--dsw-alias-bg-layer-3`、`--dsw-alias-label-secondary/tertiary` 等）。
- 级联判定唯一依据 `origin === 'subagent'`；fork 会话（有 `parentId` 无 `origin`）不入废纸篓。
- 单成员废纸篓 manifest **不带** `members`，保持向后兼容。
- 构建用 `node build.mjs`（勿用 `pnpm run build`，TTY-less 会 abort）；测试用 `./node_modules/.bin/vitest run <file>`。
- 文案走 `src/client/locales.ts` 的 `NS = 'session-desk'` 命名空间，中英两套。

---

### Task 1: 看板数据层（model-stats 带 turn + chart-data 纯函数）

**Files:**
- Modify: `src/board/model-stats.ts`
- Create: `src/board/chart-data.ts`
- Test: `tests/model-stats.spec.ts`, `tests/board-charts.spec.ts`

**Interfaces:**
- Consumes: `BoardTokenBuckets` (`src/board/workspace-stats.ts`), `ModelCallSample` (`src/board/model-stats.ts`).
- Produces:
  - `ModelCallSample` 增字段 `turn?: number`
  - `perTurnCallCounts(samples: readonly ModelCallSample[]): TurnCallCount[]`（`TurnCallCount = { turn: number; calls: number }`）
  - `tokenSegments(buckets: BoardTokenBuckets | undefined): TokenSegment[]`（`TokenSegment = { key: 'input'|'output'|'cacheRead'|'cacheWrite'; value: number }`）

- [ ] **Step 1: Write failing tests**

`tests/model-stats.spec.ts` 追加：

```ts
it('carries the turn number on assistant samples', () => {
  const nodes = new Map([
    ['a1', { kind: 'assistant', turn: 2, data: { durationMs: 11 } }],
    ['a2', { kind: 'assistant', data: { durationMs: 22 } }],
  ])
  expect(collectModelSamples({ order: ['a1', 'a2'], nodes })).toEqual([
    { durationMs: 11, turn: 2 },
    { durationMs: 22 },
  ])
})
```

新 `tests/board-charts.spec.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { perTurnCallCounts, tokenSegments } from '../src/board/chart-data.ts'

describe('perTurnCallCounts', () => {
  it('counts samples per turn, dropping turn-less samples, sorted by turn', () => {
    expect(perTurnCallCounts([
      { turn: 3 }, { turn: 1 }, { turn: 3 }, { durationMs: 5 }, { turn: 2 },
    ])).toEqual([
      { turn: 1, calls: 1 },
      { turn: 2, calls: 1 },
      { turn: 3, calls: 2 },
    ])
  })

  it('returns [] when no sample carries a turn', () => {
    expect(perTurnCallCounts([{ durationMs: 1 }])).toEqual([])
  })
})

describe('tokenSegments', () => {
  it('keeps only non-zero buckets in fixed order', () => {
    expect(tokenSegments({ input: 10, output: 0, cacheRead: 5 }))
      .toEqual([{ key: 'input', value: 10 }, { key: 'cacheRead', value: 5 }])
  })

  it('returns [] for undefined', () => {
    expect(tokenSegments(undefined)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to confirm fail**

Run: `./node_modules/.bin/vitest run tests/board-charts.spec.ts`
Expected: FAIL — `../src/board/chart-data.ts` 不存在（module not found）。

- [ ] **Step 3: Add `turn` to model-stats**

In `src/board/model-stats.ts`, extend the interface and the sample builder. Find `export interface ModelCallSample` and add `turn?: number`. In the function that maps a node to a sample (the `collectModelSamples` mapping, near where `durationMs`/`ttftMs`/`modelKey` are read), add:

```ts
const turn = asNumber(payload.turn)
// ...in the returned sample object, append:
...(turn === undefined ? {} : { turn }),
```

(`payload` is the merged `{ ...node, ...data }` already used for the other fields; `asNumber` already exists in the file.)

- [ ] **Step 4: Create `src/board/chart-data.ts`**

```ts
import type { BoardTokenBuckets } from './workspace-stats.ts'
import type { ModelCallSample } from './model-stats.ts'

export interface TurnCallCount {
  turn: number
  calls: number
}

/** Count model-call samples per turn; samples without a finite turn are dropped. */
export function perTurnCallCounts(samples: readonly ModelCallSample[]): TurnCallCount[] {
  const byTurn = new Map<number, number>()
  for (const sample of samples) {
    if (sample.turn === undefined || !Number.isFinite(sample.turn)) continue
    byTurn.set(sample.turn, (byTurn.get(sample.turn) ?? 0) + 1)
  }
  return [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, calls]) => ({ turn, calls }))
}

export type TokenSegmentKey = 'input' | 'output' | 'cacheRead' | 'cacheWrite'

export interface TokenSegment {
  key: TokenSegmentKey
  value: number
}

/** Non-zero token buckets in fixed display order. */
export function tokenSegments(buckets: BoardTokenBuckets | undefined): TokenSegment[] {
  if (buckets === undefined) return []
  const order: readonly TokenSegmentKey[] = ['input', 'output', 'cacheRead', 'cacheWrite']
  return order
    .map(key => ({ key, value: buckets[key] ?? 0 }))
    .filter(segment => segment.value > 0)
}
```

- [ ] **Step 5: Run both suites**

Run: `./node_modules/.bin/vitest run tests/model-stats.spec.ts tests/board-charts.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/board/model-stats.ts src/board/chart-data.ts tests/model-stats.spec.ts tests/board-charts.spec.ts
git commit -m "feat(board): carry turn on model samples and add chart data helpers"
```

---

### Task 2: 看板图表渲染（charts.tsx + BoardView 接入 + 样式）

**Files:**
- Create: `src/client/board/charts.tsx`
- Modify: `src/client/board/BoardView.tsx`, `src/client/board/board-styles.ts`

**Interfaces:**
- Consumes: `perTurnCallCounts`, `tokenSegments` (Task 1); `ModelCallSample`, `collectModelSamples`/`aggregateModelCalls` (`src/board/model-stats.ts`); `ToolBucketRow` (`src/board/classify.ts`); `BoardTokenBuckets` (`src/board/workspace-stats.ts`); `collectTurnTimings` (in `BoardView.tsx`).
- Produces: four exported components `PerTurnCallsChart`, `ModelBars`, `TurnTimingChart`, `TokenDonut`, consumed by `BoardView`.

- [ ] **Step 1: Create `src/client/board/charts.tsx`**

```tsx
import type { ReactNode } from 'react'
import { perTurnCallCounts, tokenSegments, type TokenSegmentKey } from '../../board/chart-data.ts'
import type { ModelCallSample } from '../../board/model-stats.ts'
import type { BoardTokenBuckets } from '../../board/workspace-stats.ts'

const SEGMENT_COLOR: Record<TokenSegmentKey, string> = {
  input: 'var(--dsw-alias-brand-primary, #4176e6)',
  output: 'var(--dsw-alias-brand-secondary, #22c55e)',
  cacheRead: 'var(--dsw-alias-info, #0ea5e9)',
  cacheWrite: 'var(--dsw-alias-warning, #f59e0b)',
}

export function PerTurnCallsChart({ samples }: { samples: readonly ModelCallSample[] }): ReactNode {
  const points = perTurnCallCounts(samples)
  if (points.length === 0) return null
  const max = Math.max(...points.map(p => p.calls), 1)
  return (
    <div className="dsd-chart dsd-chart--cols" role="img" aria-label="model calls per turn">
      {points.map(p => (
        <div key={p.turn} className="dsd-chart__col" title={`${p.turn} · ${p.calls}`}>
          <div className="dsd-chart__col-bar" style={{ height: `${Math.max(4, Math.round((p.calls / max) * 100))}%` }} />
          <span className="dsd-chart__col-x">{p.turn}</span>
        </div>
      ))}
    </div>
  )
}

export function ModelBars({ rows }: {
  rows: readonly { label: string; count: number; totalMs?: number }[]
}): ReactNode {
  if (rows.length === 0) return null
  const max = Math.max(...rows.map(r => r.totalMs ?? r.count), 1)
  return (
    <div className="dsd-chart dsd-chart--bars" role="img" aria-label="model calls by model">
      {rows.map(row => (
        <div key={row.label} className="dsd-chart__bar-row">
          <span className="dsd-chart__bar-label">{row.label}</span>
          <div className="dsd-chart__bar-track">
            <div className="dsd-chart__bar-fill" style={{ width: `${Math.round(((row.totalMs ?? row.count) / max) * 100)}%` }} />
          </div>
          <span className="dsd-chart__bar-value">{row.count} × {row.totalMs === undefined ? '—' : `${Math.round(row.totalMs / 1e3 * 10) / 10}s`}</span>
        </div>
      ))}
    </div>
  )
}

export function TurnTimingChart({ points }: {
  points: readonly { turn: number; wallMs?: number; ttftMs?: number }[]
}): ReactNode {
  const withWall = points.filter(p => p.wallMs !== undefined)
  if (withWall.length === 0) return null
  const max = Math.max(...withWall.map(p => p.wallMs ?? 0), 1)
  return (
    <div className="dsd-chart dsd-chart--cols" role="img" aria-label="turn wall clock">
      {withWall.map(p => (
        <div key={p.turn} className="dsd-chart__col" title={`回合 ${p.turn} · 墙钟 ${Math.round((p.wallMs ?? 0) / 1e3 * 10) / 10}s${p.ttftMs === undefined ? '' : ` · TTFT ${Math.round(p.ttftMs / 1e3 * 10) / 10}s`}`}>
          <div className="dsd-chart__col-bar" style={{ height: `${Math.max(4, Math.round(((p.wallMs ?? 0) / max) * 100))}%` }} />
          {p.ttftMs !== undefined && (
            <div className="dsd-chart__col-ttft" style={{ bottom: `${Math.max(4, Math.round((p.ttftMs / max) * 100))}%` }} />
          )}
          <span className="dsd-chart__col-x">{p.turn}</span>
        </div>
      ))}
    </div>
  )
}

export function TokenDonut({ buckets }: { buckets: BoardTokenBuckets | undefined }): ReactNode {
  const segments = tokenSegments(buckets)
  if (segments.length === 0) return null
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  let acc = 0
  const stops = segments.map(s => {
    const from = (acc / total) * 360
    acc += s.value
    const to = (acc / total) * 360
    return `${SEGMENT_COLOR[s.key]} ${from}deg ${to}deg`
  }).join(', ')
  return (
    <div className="dsd-chart__donut-wrap">
      <div className="dsd-chart__donut" style={{ background: `conic-gradient(${stops})` }} role="img" aria-label="token composition" />
      <div className="dsd-chart__donut-center">{total >= 1000 ? `${Math.round(total / 1000)}K` : total}</div>
      <div className="dsd-chart__legend">
        {segments.map(s => (
          <span key={s.key} className="dsd-chart__legend-item">
            <i style={{ background: SEGMENT_COLOR[s.key] }} />{s.key} {Math.round((s.value / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire into `BoardView.tsx`**

Import the four components and replace the key/value bodies. Model-call block: render `<PerTurnCallsChart samples={samples} />` (session mode only) then `<ModelBars rows={modelRows} />` (build `modelRows` from `aggregateModelCalls(...).byModel.map(r => ({ label: r.label, count: r.count, totalMs: r.totalMs }))`, plus an "全部" row). Token block: `<TokenDonut buckets={shownTokens} />`. 分类 block: `<ModelBars rows={buckets.map(b => ({ label: bucketLabel(b.bucket), count: b.count, totalMs: b.totalMs }))} />`. 对话级耗时 block: `<TurnTimingChart points={collectTurnTimings(chat, top)} />`. Keep the existing `<details>` wrappers, the 本会话/本工作区 toggle, and the numeric `<StatRow>` details (charts sit above the folded numeric rows).

- [ ] **Step 3: Add chart CSS to `board-styles.ts`**

Append to `cssText` (inside the existing template literal, before the final backtick):

```css
.dsd-chart { display: flex; align-items: flex-end; gap: 6px; margin: 8px 0 4px; }
.dsd-chart--cols { height: 96px; align-items: flex-end; }
.dsd-chart__col { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 3px; }
.dsd-chart__col-bar { width: 100%; max-width: 28px; border-radius: 4px 4px 0 0; background: var(--dsw-alias-brand-primary, #4176e6); min-height: 2px; }
.dsd-chart__col-ttft { position: absolute; width: 100%; max-width: 28px; height: 2px; background: var(--dsw-alias-warning, #f59e0b); }
.dsd-chart__col-x { font-size: 10px; color: var(--dsw-alias-label-tertiary, #94a3b8); line-height: 1; }
.dsd-chart--bars { flex-direction: column; align-items: stretch; }
.dsd-chart__bar-row { display: grid; grid-template-columns: 96px 1fr auto; gap: 8px; align-items: center; }
.dsd-chart__bar-label { font-size: 12px; color: var(--dsw-alias-label-secondary, #475569); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsd-chart__bar-track { height: 10px; border-radius: 5px; background: var(--dsw-alias-bg-layer-3, #f1f5f9); overflow: hidden; }
.dsd-chart__bar-fill { height: 100%; border-radius: 5px; background: var(--dsw-alias-brand-primary, #4176e6); }
.dsd-chart__bar-value { font-size: 11px; color: var(--dsw-alias-label-tertiary, #94a3b8); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dsd-chart__donut-wrap { display: flex; align-items: center; gap: 12px; margin: 8px 0 4px; }
.dsd-chart__donut { position: relative; width: 72px; height: 72px; border-radius: 50%; flex: none; }
.dsd-chart__donut::after { content: ""; position: absolute; inset: 16px; border-radius: 50%; background: var(--dsw-alias-bg-layer-3, #fff); }
.dsd-chart__donut-center { position: absolute; margin-left: -72px; width: 72px; text-align: center; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsd-chart__legend { display: flex; flex-wrap: wrap; gap: 6px 12px; }
.dsd-chart__legend-item { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary, #475569); }
.dsd-chart__legend-item i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
```

- [ ] **Step 4: Build**

Run: `node build.mjs`
Expected: `lib/client.js` regenerates with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/board/charts.tsx src/client/board/BoardView.tsx src/client/board/board-styles.ts
git commit -m "feat(board): render charts instead of plain key/value rows"
```

---

### Task 3: 级联判定纯函数（cascade.ts）

**Files:**
- Create: `src/trash/cascade.ts`
- Test: `tests/cascade.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `collectDescendants(root: string, input: CascadeInput): string[]`，`CascadeRow` / `CascadeCatalogEntry` / `CascadeInput`。Task 5 consumes this.

- [ ] **Step 1: Write failing tests**

`tests/cascade.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { collectDescendants } from '../src/trash/cascade.ts'

describe('collectDescendants', () => {
  it('collects direct and nested subagents via byId', () => {
    const byId = {
      main: { id: 'main' },
      c1: { id: 'c1', parentId: 'main', origin: 'subagent' },
      c2: { id: 'c2', parentId: 'c1', origin: 'subagent' },
    }
    expect(collectDescendants('main', { byId })).toEqual(['c1', 'c2'])
  })

  it('excludes fork sessions (parentId without origin subagent)', () => {
    const byId = {
      main: { id: 'main' },
      fork: { id: 'fork', parentId: 'main' },
      c1: { id: 'c1', parentId: 'main', origin: 'subagent' },
    }
    expect(collectDescendants('main', { byId })).toEqual(['c1'])
  })

  it('merges byId and catalog children without duplicates', () => {
    const byId = { main: { id: 'main' }, c1: { id: 'c1', parentId: 'main', origin: 'subagent' } }
    const subagentsByParent = { main: { entries: [{ id: 'c1', kind: 'child' }, { id: 'c2', kind: 'child' }] } }
    expect(collectDescendants('main', { byId, subagentsByParent })).toEqual(['c1', 'c2'])
  })

  it('terminates on a parent cycle', () => {
    const byId = {
      a: { id: 'a', parentId: 'b', origin: 'subagent' },
      b: { id: 'b', parentId: 'a', origin: 'subagent' },
    }
    const result = collectDescendants('a', { byId })
    expect(result.includes('b')).toBe(true)
    expect(result).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to confirm fail**

Run: `./node_modules/.bin/vitest run tests/cascade.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/trash/cascade.ts`**

```ts
export interface CascadeRow {
  id: string
  parentId?: string
  origin?: 'subagent' | string
}

export interface CascadeCatalogEntry {
  id: string
  kind?: string
}

export interface CascadeInput {
  byId?: Record<string, CascadeRow | undefined>
  subagentsByParent?: Record<string, { entries?: readonly CascadeCatalogEntry[] } | undefined>
}

/** Transitive subagent descendants of `root`, deduped, excluding `root` itself. */
export function collectDescendants(root: string, input: CascadeInput): string[] {
  const byId = input.byId ?? {}
  const catalogs = input.subagentsByParent ?? {}
  const out: string[] = []
  const seen = new Set<string>([root])
  const queue: string[] = [root]
  while (queue.length > 0) {
    const current = queue.shift()!
    const children = new Set<string>()
    for (const row of Object.values(byId)) {
      if (row !== undefined && row.parentId === current && row.origin === 'subagent') children.add(row.id)
    }
    const entries = catalogs[current]?.entries ?? []
    for (const entry of entries) if (entry.kind === 'child') children.add(entry.id)
    for (const child of children) {
      if (seen.has(child)) continue
      seen.add(child)
      out.push(child)
      queue.push(child)
    }
  }
  return out
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `./node_modules/.bin/vitest run tests/cascade.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/trash/cascade.ts tests/cascade.spec.ts
git commit -m "feat(trash): add subagent-descendant cascade resolver"
```

---

### Task 4: 多成员废纸篓（types + store + http）

**Files:**
- Modify: `src/trash/types.ts`, `src/trash/store.ts`, `src/http.ts`
- Test: `tests/trash-store.spec.ts`, `tests/http-host.spec.ts`

**Interfaces:**
- Consumes: `liveSessionDir`, `encodeSessionSegment` (`src/session-path.ts`); `makeTrashId`, `dirSize`, `moveTree`, `restoreDestination`, `nestedSessionDir`, `readManifest` (existing store internals).
- Produces:
  - `TrashMember = { sessionId: string; originalPath: string; cwd?: string }`
  - `TrashManifest.members?: TrashMember[]`（仅多成员时写）
  - `trash(input: { sessionId: string; cwd?: string; title: string; sessionIds?: string[] })`
  - `listTrash()` rows 增 `memberCount?: number`（子代理数 = members.length - 1）
  - `restore()` 支持多成员整棵还原

- [ ] **Step 1: Extend `src/trash/types.ts`**

```ts
export interface TrashMember {
  sessionId: string
  originalPath: string
  cwd?: string
}

export interface TrashManifest {
  version: 1
  sessionId: string
  cwd: string
  title: string
  deletedAt: number
  originalPath: string
  bytes: number
  members?: TrashMember[]
}
```

- [ ] **Step 2: Write failing store tests**

`tests/trash-store.spec.ts` 追加（复用现有 `setup()` 建一个主代理，再建两个子代理目录）：

```ts
it('trashes parent + subagents into one entry with members', async () => {
  const { cwd, sessionId, store } = await setup()
  const childId = 'session-cccccccc-cccc-cccc-cccc-cccccccccccc'
  const grandId = 'session-dddddddd-dddd-dddd-dddd-dddddddddddd'
  const childLive = liveSessionDir(root, cwd, childId)
  const grandLive = liveSessionDir(root, cwd, grandId)
  await mkdir(childLive, { recursive: true }); await writeFile(join(childLive, 'c.jsonl'), 'c')
  await mkdir(grandLive, { recursive: true }); await writeFile(join(grandLive, 'g.jsonl'), 'g')

  const result = await store.trash({ sessionId, cwd, title: 'root', sessionIds: [sessionId, childId, grandId] })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  const manifest = JSON.parse(await readFile(join(root, '.trash', result.trashId, 'manifest.json'), 'utf8'))
  expect(manifest.members).toHaveLength(3)
  expect(manifest.members[0].sessionId).toBe(sessionId)
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
  await mkdir(childLive, { recursive: true }); await writeFile(join(childLive, 'c.jsonl'), 'c')

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
```

- [ ] **Step 3: Run to confirm fail**

Run: `./node_modules/.bin/vitest run tests/trash-store.spec.ts`
Expected: FAIL — `memberCount` undefined / `members` undefined.

- [ ] **Step 4: Implement multi-member in `src/trash/store.ts`**

`readManifest` 追加 members 透传：

```ts
      bytes: typeof raw.bytes === 'number' ? raw.bytes : 0,
      ...(Array.isArray(raw.members) ? { members: raw.members as TrashMember[] } : {}),
```

把 `trash` 与 `trashAt` 改为多成员版（单成员路径不写 `members`）：

```ts
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
      const cwd = i === 0 ? input.cwd : undefined
      const path = await resolveLive(sessionId, cwd)
      if (path === undefined) return { ok: false, code: 'not-found', message: '磁盘上已不在，刷新列表' }
      members.push({ sessionId, path })
    }
    return trashMembers(members, input)
  }

  async function trashMembers(members: Array<{ sessionId: string; path: string }>, input: { cwd?: string; title: string }): Promise<TrashResult> {
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
      return { ok: true, trashId }
    } catch (error) {
      for (const member of members) {
        if (await exists(member.path)) continue
        const dest = join(entryDir, relative(root, member.path))
        if (await exists(dest)) await moveTree(dest, member.path).catch(() => undefined)
      }
      await rm(entryDir, { recursive: true, force: true }).catch(() => undefined)
      return ioFail(error)
    }
  }
```

`listTrash` 追加 `memberCount`：

```ts
      const memberCount = manifest.members !== undefined ? manifest.members.length - 1 : 0
      rows.push({ ...manifest, trashId: entry.name, memberCount })
```

`restore` 增分支（在 `readManifest` 之后、现有单成员逻辑之前）：

```ts
    if (manifest.members !== undefined && manifest.members.length > 0) {
      return restoreMembers(root, entryDir, manifest)
    }
```

并新增 `restoreMembers`（放 `nestedSessionDir` 之后）：

```ts
  async function restoreMembers(root: string, entryDir: string, manifest: TrashManifest): Promise<RestoreResult> {
    try {
      const members = manifest.members!
      const dests: string[] = []
      for (const member of members) {
        const nested = join(entryDir, relative(root, member.originalPath))
        if (!await exists(nested)) return { ok: false, code: 'not-found', message: '磁盘上已不在，刷新列表' }
        const dest = await restoreDestination(member.originalPath, pathTaken)
        if (!isInsideSessionsRoot(root, dest)) return { ok: false, code: 'io', message: 'restore destination escaped sessions root' }
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
```

删除旧的 `trashAt`（被 `trashMembers` 取代）。注意 `pathTaken` 在 `restore` 闭包里已有同名函数，`restoreMembers` 需引用它——把 `restoreMembers` 定义为 `createTrashStore` 内的函数即可访问 `pathTaken`（若 `pathTaken` 是外层模块函数也同理可用，保持现有作用域）。

- [ ] **Step 5: Update `src/http.ts` trash route**

把 `/trash` 路由改为接受 `sessionIds`：

```ts
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
        await switchAwayIfCurrent(opts.sessions, sessionId, cwd)
        const result = await opts.store.trash({ sessionId, cwd, title, ...(sessionIds.length > 0 ? { sessionIds } : {}) })
        if (!result.ok) {
          writeJson(res, result.code === 'not-found' ? 404 : 500, { ok: false, error: result.message, code: result.code })
          return
        }
        for (const id of new Set(sessionIds.length > 0 ? sessionIds : [sessionId])) probeSessionForget(opts.sessions, id)
        writeJson(res, 200, { ok: true, data: { trashId: result.trashId } })
        return
      }
```

- [ ] **Step 6: Run store + host suites**

Run: `./node_modules/.bin/vitest run tests/trash-store.spec.ts tests/http-host.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/trash/types.ts src/trash/store.ts src/http.ts tests/trash-store.spec.ts tests/http-host.spec.ts
git commit -m "feat(trash): multi-member trash entry with cascade restore"
```

---

### Task 5: 客户端废纸篓入口（api + TrashFooter + 注册 + 文案）

**Files:**
- Modify: `src/client/api.ts`, `src/client/index.ts`, `src/client/locales.ts`
- Create: `src/client/trash/TrashFooter.tsx`

**Interfaces:**
- Consumes: `collectDescendants` (Task 3); `api.trash`/`listTrash`/`restore`/`purge`/`purgeAll` (`src/client/api.ts`); `useSessions` global standard prop; `sessions.refreshSubagents`/`setSubagentCatalogOpen` on `ctx.sessions`.
- Produces: `TrashFooter` component registered into `sidebar.footer.action`（id `session-desk-trash`）。

- [ ] **Step 1: Widen `api.trash` in `src/client/api.ts`**

```ts
export interface TrashRow extends TrashManifest { trashId: string; memberCount?: number }
export async function trash(input: { sessionId: string; cwd?: string; title?: string; sessionIds?: string[] }): Promise<{ trashId: string }> {
  // body 直接透传 sessionIds（现有实现已 JSON.stringify(input)）；只改签名类型。
}
```

（把 `TrashRow` 从 `type` 改为 `interface` 并加 `memberCount`，`listTrash` 返回类型沿用。）

- [ ] **Step 2: Add locale keys**

`src/client/locales.ts` 的 `zh` 增：

```ts
  'trash.members': '含 {n} 个子代理',
  'trash.confirmCascade': '确定把该会话及其子代理一起移入废纸篓？',
```

`en` 增：

```ts
  'trash.members': '{n} subagent(s)',
  'trash.confirmCascade': 'Move this session and its subagents to the trash?',
```

- [ ] **Step 3: Create `src/client/trash/TrashFooter.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { listTrash, restore, purge, purgeAll, trash as apiTrash, type TrashRow } from '../api.ts'
import { collectDescendants } from '../../trash/cascade.ts'

interface SessionsSnapshot {
  current?: string
  byId?: Record<string, { id?: string; parentId?: string; origin?: string } | undefined>
  subagentsByParent?: Record<string, { entries?: readonly { id: string; kind?: string }[] } | undefined>
}

export interface TrashFooterProps {
  wide: boolean
  t?: (key: string, vars?: Record<string, string | number>) => string
  useSessions?: <T>(select: (snapshot: SessionsSnapshot) => T) => T
  sessions?: {
    refreshSubagents?: (parentSessionId: string) => Promise<void>
    setSubagentCatalogOpen?: (parentSessionId: string, open: boolean) => void
  }
}

export function TrashFooter(props: TrashFooterProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<TrashRow[]>([])
  const [notice, setNotice] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const snap = props.useSessions ? props.useSessions(s => s) : undefined
  const t = props.t ?? ((key: string) => key)

  const refresh = async (): Promise<void> => {
    try { setRows(await listTrash()) } catch { setRows([]) }
  }
  useEffect(() => { void refresh() }, [])

  const openSession = async (id: string): Promise<void> => {
    try { void props.sessions?.refreshSubagents?.(id); void props.sessions?.setSubagentCatalogOpen?.(id, true) } catch { /* best-effort */ }
    const byId = snap?.byId ?? {}
    const catalogs = snap?.subagentsByParent ?? {}
    const descendants = collectDescendants(id, { byId, subagentsByParent: catalogs })
    const ids = [id, ...descendants]
    const title = byId[id]?.id ?? id
    if (!window.confirm(descendants.length > 0 ? t('trash.confirmCascade') : t('sessions.confirmDelete'))) return
    try {
      await apiTrash({ sessionId: id, sessionIds: ids, title })
      await refresh()
    } catch (error) {
      setNotice(t('action.failed', { error: error instanceof Error ? error.message : String(error) }))
    }
  }

  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    setDragOver(false)
    const id = event.dataTransfer.getData('text/plain')
    if (id !== '') void openSession(id)
  }

  const popStyle = useMemo(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    return {
      left: rect ? Math.min(rect.left, Math.max(0, (typeof window === 'undefined' ? 1280 : window.innerWidth) - 300)) : 0,
      bottom: typeof window === 'undefined' ? 0 : window.innerHeight - (rect?.top ?? 0),
    }
  }, [open, props.wide])

  const label = t('tab.trash')
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`dsd-trash-foot${dragOver ? ' dsd-trash-foot--over' : ''}`}
        onClick={() => { setOpen(v => !v); void refresh() }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        title={label}
      >
        <span className="dsd-trash-foot__icon" aria-hidden="true">🗑</span>
        {props.wide && <span className="dsd-trash-foot__label">{label}</span>}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="dsd-trash-pop" role="dialog" style={popStyle}>
          {rows.length === 0 && <div className="dsd-trash-pop__empty">{t('trash.empty')}</div>}
          {rows.map(row => (
            <div key={row.trashId} className="dsd-trash-pop__row">
              <div className="dsd-trash-pop__meta">
                <div className="dsd-trash-pop__title">{row.title}</div>
                <div className="dsd-trash-pop__sub">
                  {row.memberCount ? `${t('trash.members', { n: row.memberCount })} · ` : ''}
                  {row.deletedAt ? t('trash.daysLeft', { n: Math.max(0, Math.ceil((row.deletedAt + 30 * 86_400_000 - Date.now()) / 86_400_000)) }) : ''}
                </div>
              </div>
              <button type="button" onClick={() => { void restore(row.trashId).then(refresh) }}>{t('trash.restore')}</button>
              <button type="button" onClick={() => { void purge({ trashId: row.trashId }).then(refresh) }}>{t('trash.purge')}</button>
            </div>
          ))}
          {rows.length > 0 && <button type="button" className="dsd-trash-pop__all" onClick={() => { void purgeAll().then(refresh) }}>{t('trash.purgeAll')}</button>}
          {notice !== '' && <div className="dsd-trash-pop__notice">{notice}</div>}
        </div>,
        document.body,
      )}
    </>
  )
}
```

（图标用内联 SVG 或 emoji 均可；`sessions.confirmDelete` 文案已在 locales 存在。）

- [ ] **Step 4: Add CSS + register in `src/client/index.ts`**

在 `index.ts` 注入一段 `adoptTrashStyles()`（或复用现有 style 注入模式，新增 `src/client/trash/trash-styles.ts`，样式含 `.dsd-trash-foot`、`.dsd-trash-pop`、`.dsd-trash-foot--over` 的定位/配色）。然后在 `apply()` 里新增 effect：

```ts
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'session-desk-trash',
    order: 40,
    locale: NS,
    inject: () => ({ t, sessions: ctx.sessions }),
  }, TrashFooter)), 'dsh-session-desk: trash footer')
```

并在文件顶部 `import { TrashFooter } from './trash/TrashFooter.tsx'`、引入样式。`ctx.sessions` 的 `ClientContext` 类型已含 `refreshSubagents`/`setSubagentCatalogOpen`。

- [ ] **Step 5: Build**

Run: `node build.mjs`
Expected: `lib/client.js` regenerates with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/api.ts src/client/index.ts src/client/locales.ts src/client/trash/TrashFooter.tsx
git commit -m "feat(trash): sidebar footer trash entry with drag-to-delete cascade"
```

---

## Self-Review

- **Spec coverage**: A 每回合柱状 + 按模型条形（Task 1/2）、对话级耗时柱（Task 2）、Token 环形（Task 2）、调用分类条形（Task 2）；B 入口（Task 5）、拖拽（Task 5）、级联判定（Task 3）、多成员 host（Task 4）、`trash.members` 文案（Task 5）。全部覆盖。
- **Placeholder scan**: 无 TBD/TODO；每个 code step 都有具体实现。
- **Type consistency**: `collectDescendants` 在 Task 3 定义、Task 5 使用，签名一致；`perTurnCallCounts`/`tokenSegments` Task 1 定义、Task 2 使用；`trash({ sessionId, sessionIds })` Task 4/5 一致；`memberCount` 在 Task 4 store 与 Task 5 `TrashRow` 一致。
