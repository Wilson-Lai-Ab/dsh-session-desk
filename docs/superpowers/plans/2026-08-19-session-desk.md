# Session Desk Implementation Plan

> **For agentic workers:** Pick the execution skill from using-superpowers
> Execution Routing (S = this session, no SDD; M = executing-plans;
> L = subagent-driven-development). Do not default to SDD. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `dsh-session-desk`: session trash (30-day restore), hover-expand chat minimap, conversation-header 看板 tab (including model-call timings), copied appearance theme with `--dsd-*` + review fixes, and a draggable pet overlay.

**Architecture:** One web plugin, host + client, no harness edits, no npm dependency on `dsh-client-ui-custom`. Host owns `sessionsRoot` resolution, trash rename/restore/purge, hourly sweep, loopback HTTP. Client owns settings section, slots (`details`, `conversation.view`, `shell.overlay`, pin action), and theme apply. Pure functions (root, encode, trash, classify, model-stats, URL/CSS sanitize) live in `src/` and are unit-tested first.

**Tech Stack:** TypeScript, vitest, esbuild (same as `dsh-file-search`), React 18, `@deepseek-ai/dsh-settings` + `schemastery`, `ctx.webServer` prefix routes, `ctx.slots` / `ctx.locale`.

**Spec:** `docs/superpowers/specs/2026-08-19-session-desk-design.md`

## Global Constraints

- Package name `dsh-session-desk`; settings namespace `session-desk`; settings page title 会话管理.
- Do not edit DeepSeek Harness source. Do not add a dependency on `@ha-na-bi/dsh-client-ui-custom`.
- Do not implement workspace CRUD, synapse canvas, marketplace, shortcuts, or user-message Markdown.
- `projectKey` / `encodeSessionSegment` must match `DSH-better-sidebar/src/review/review-disk.ts` byte-for-byte (copy + lock with the same path vector).
- Live session dir: `join(root, projectKey(cwd) | '_no-cwd', encodeSessionSegment(sessionId))`.
- Trash lives at `<sessionsRoot>/.trash/<deletedAt-iso>-<shortId>/` with `manifest.json`; `trashId` is that folder name.
- Host mutations: loopback Host + header `x-dsh-session-desk: 1` + `content-type: application/json`.
- Theme tokens `--dsd-*`, gate `html[data-dsd-active]`, style id `dsh-session-desk-css`. Never register namespace `ui-custom`.
- Copy: UI Chinese + English locale dicts; code comments and JSDoc English.
- New package under `dhs-plugins/dsh-session-desk`. If that folder has no git repo, `git init` in Task 1 and commit there. Do not commit `node_modules`.
- After each task: `pnpm test` (and `pnpm build` once the build script exists) must be green.

## File map

```
dsh-session-desk/
  package.json, tsconfig.json, vitest.config.ts, build.mjs
  cordis.patch.yml, dsh.plugin.json
  src/shared.ts                 settings types + defaults
  src/sessions-root.ts          resolveSessionsRoot
  src/session-path.ts           encodeSessionSegment, projectKey, liveSessionDir
  src/sanitize.ts               wallpaper URL + customCss/customVars
  src/board/classify.ts         tool name → bucket
  src/board/model-stats.ts      model-call timing aggregate
  src/history/turns.ts          chat snapshot → minimap rows
  src/trash/types.ts            TrashManifest
  src/trash/store.ts            move/list/restore/purge/sweep
  src/http.ts                   loopback + marker + JSON helpers
  src/index.ts                  host apply: settings + routes + sweep
  src/client/index.ts           register section + gated slots
  src/client/locales.ts
  src/client/api.ts             fetch wrappers
  src/client/SettingsSection.tsx
  src/client/history/*          two-state strip + pin
  src/client/board/*            conversation.view 看板
  src/client/pet/*
  src/client/appearance/*       copied theme, --dsd-*
  tests/*.spec.ts
```

---

### Task 1: Package skeleton + sessionsRoot + path encoding + settings schema

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `build.mjs`, `cordis.patch.yml`, `dsh.plugin.json`
- Create: `src/shared.ts`, `src/sessions-root.ts`, `src/session-path.ts`, `src/index.ts`
- Create: `tests/sessions-root.spec.ts`, `tests/session-path.spec.ts`
- Create: `README.md` (one paragraph + install `dsh plugin --profile web add link:<abs-path>`)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `SESSION_DESK_NS = 'session-desk'`
  - `export interface SessionDeskSettings` (all keys from spec §5; appearance fields may be stubbed as optional strings/numbers with neutral defaults — Task 5 fills ThemeSection)
  - `export const DEFAULT_SETTINGS: SessionDeskSettings`
  - `export type SessionsRootSource = 'config' | 'env' | 'home' | 'default'`
  - `export function resolveSessionsRoot(input: { sessionsRoot?: string; env?: NodeJS.ProcessEnv; homedir: () => string }): { root: string; source: SessionsRootSource }`
  - `export function encodeSessionSegment(raw: string): string`
  - `export function projectKey(cwd: string): string`
  - `export function liveSessionDir(root: string, cwd: string | undefined, sessionId: string): string`
  - `export const name = 'dsh-session-desk'`
  - `export const inject = ['webServer', 'sessions', 'settings']`
  - `export function apply(ctx: unknown, config?: { sessionsRoot?: string }): void` — Task 1 only registers the settings namespace (copy `dsh-at-file/src/settings.ts` pattern). Routes come in Task 2.

- [ ] **Step 1: Write failing tests**

`tests/sessions-root.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveSessionsRoot } from '../src/sessions-root.ts'

const home = () => '/Users/me'

describe('resolveSessionsRoot', () => {
  it('uses absolute settings.sessionsRoot first', () => {
    const r = resolveSessionsRoot({
      sessionsRoot: '/data/sessions',
      env: { DSH_SESSIONS_ROOT: '/env', DSH_HOME: '/home-dsh' },
      homedir: home,
    })
    expect(r).toEqual({ root: '/data/sessions', source: 'config' })
  })

  it('expands a leading ~ in settings.sessionsRoot', () => {
    const r = resolveSessionsRoot({ sessionsRoot: '~/alt', env: {}, homedir: home })
    expect(r).toEqual({ root: '/Users/me/alt', source: 'config' })
  })

  it('ignores empty and relative settings.sessionsRoot', () => {
    expect(resolveSessionsRoot({ sessionsRoot: '', env: { DSH_SESSIONS_ROOT: '/env' }, homedir: home }))
      .toEqual({ root: '/env', source: 'env' })
    expect(resolveSessionsRoot({ sessionsRoot: 'relative/path', env: { DSH_SESSIONS_ROOT: '/env' }, homedir: home }))
      .toEqual({ root: '/env', source: 'env' })
  })

  it('falls through env → DSH_HOME/sessions → ~/.dsh/sessions', () => {
    expect(resolveSessionsRoot({ env: { DSH_HOME: '/opt/dsh' }, homedir: home }))
      .toEqual({ root: '/opt/dsh/sessions', source: 'home' })
    expect(resolveSessionsRoot({ env: {}, homedir: home }))
      .toEqual({ root: '/Users/me/.dsh/sessions', source: 'default' })
  })
})
```

`tests/session-path.spec.ts` (lock to better-sidebar vector):

```ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodeSessionSegment, liveSessionDir, projectKey } from '../src/session-path.ts'

describe('session-path', () => {
  it('matches review-disk project + session encoding', () => {
    expect(projectKey('/Users/laiweibin/work/workSoftware/dhs-plugins'))
      .toBe('--Users-laiweibin-work-workSoftware-dhs-plugins--')
    expect(liveSessionDir(
      '/tmp/sessions',
      '/Users/laiweibin/work/workSoftware/dhs-plugins',
      'session-edd31b4a-43ab-40ee-9d1c-20b30693decb',
    )).toBe(join(
      '/tmp/sessions',
      '--Users-laiweibin-work-workSoftware-dhs-plugins--',
      'session-edd31b4a-43ab-40ee-9d1c-20b30693decb',
    ))
  })

  it('puts empty cwd under _no-cwd', () => {
    expect(liveSessionDir('/tmp/sessions', undefined, 's'))
      .toBe(join('/tmp/sessions', '_no-cwd', 's'))
    expect(liveSessionDir('/tmp/sessions', '', 's'))
      .toBe(join('/tmp/sessions', '_no-cwd', 's'))
  })

  it('encodes empty / dot segments like review-disk', () => {
    expect(() => encodeSessionSegment('')).toThrow()
    expect(encodeSessionSegment('.')).toBe('~002E')
    expect(encodeSessionSegment('..')).toBe('~002E~002E')
    expect(encodeSessionSegment('sid/1')).toBe('sid~002F1')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL** (`sessions-root` / `session-path` not found)

```bash
cd /Users/laiweibin/work/workSoftware/dhs-plugins/dsh-session-desk
pnpm init && pnpm add -D typescript vitest @types/node esbuild
# then add package.json scripts from dsh-file-search; pnpm test
```

- [ ] **Step 3: Implement**

Copy `encodeSessionSegment` and `projectKey` from `DSH-better-sidebar/src/review/review-disk.ts` (do not reimplement). `liveSessionDir` is `join(root, cwd ? projectKey(cwd) : '_no-cwd', encodeSessionSegment(sessionId))`.

`resolveSessionsRoot`: treat `sessionsRoot` as override only when, after expanding a single leading `~` via `homedir()`, `isAbsolute(path)` is true.

`src/shared.ts` defaults: `sessionsRoot: ''`, `retentionDays: 30`, `historyPosition: 'right'`, `historyLimit: 10`, `boardTab: true`, `petEnabled: true`, `petImage: ''`, `petX: -1`, `petY: -1`, `pinnedTurns: {}`. Appearance keys default to ui-custom neutrals (`wallpaper: ''`, `glass: 'frosted'`, `accent: '#4176e6'`, opacities 100, etc.) so Task 5 does not change the schema shape.

`src/index.ts` Task 1: `ctx.inject(['settings'], …)` register `settingsNamespace('session-desk')` with schemastery object matching `SessionDeskSettings`. `applies: 'live'`. Loader `config.sessionsRoot` seeds the schema base.

Scaffold `package.json` like `dsh-file-search` (name `dsh-session-desk`, `dsh.bundle.patch`, `dsh.client.platform: web`, inject runtime + locale + settings). `cordis.patch.yml`:

```yaml
- insert:
    - id: session-desk
      name: dsh-session-desk
```

`dsh.plugin.json` entry inject `["webServer", "sessions", "settings"]`.

- [ ] **Step 4: `pnpm test` PASS**
- [ ] **Step 5: Commit** `feat(session-desk): resolve sessions root and lock path encoding`

---

### Task 2: Trash store + host HTTP + 会话/废纸篓 settings pane

**Files:**
- Create: `src/trash/types.ts`, `src/trash/store.ts`, `src/http.ts`
- Modify: `src/index.ts` — register `/session-desk/api` prefix, start sweep on apply + `setInterval(3600000)`
- Create: `src/client/api.ts`, `src/client/locales.ts`, `src/client/SettingsSection.tsx`, `src/client/index.ts`
- Create: `tests/trash-store.spec.ts`, `tests/http-host.spec.ts`
- Modify: `build.mjs` (host ESM + client CJS ModuleLoader banner, copy `dsh-file-search/build.mjs`, id `dsh-session-desk`)

**Interfaces:**
- Consumes: `resolveSessionsRoot`, `liveSessionDir`, `SessionDeskSettings`
- Produces:
  - `export interface TrashManifest { version: 1; sessionId: string; cwd: string; title: string; deletedAt: number; originalPath: string; bytes: number }`
  - `export function makeTrashId(deletedAt: number, sessionId: string): string` — UTC `YYYYMMDDTHHMMSS` + `-` + last 6 safe chars of sessionId (`[A-Za-z0-9]`, pad with `x`)
  - `export function createTrashStore(opts: { root: () => string; retentionDays: () => number; now?: () => number })`
  - Store methods (all async):
    - `listLive(): Promise<Array<{ sessionId: string; cwd: string; path: string; bytes: number }>>` — walk `root` skipping `.trash`; `sessionId` is decoded only for display if needed, otherwise use directory name as encoded id and also store encoded segment
    - `trash(input: { sessionId: string; cwd?: string; title: string }): Promise<{ ok: true; trashId: string } | { ok: false; code: 'not-found' | 'io'; message: string }>`
    - `listTrash(): Promise<Array<TrashManifest & { trashId: string }>>`
    - `restore(trashId: string): Promise<{ ok: true; path: string } | { ok: false; code: 'not-found' | 'io'; message: string }>` — if `originalPath` exists, dest = `originalPath + '-restored'` (if that exists too, append `-restored-2`, …)
    - `purge(trashId: string): Promise<{ ok: true } | { ok: false; code: 'not-found' | 'io'; message: string }>`
    - `purgeAll(): Promise<{ ok: true; removed: number }>`
    - `sweepExpired(): Promise<{ removed: number }>` — `deletedAt + retentionDays * 86400000 <= now`
  - `export function validateLoopbackHost(hostHeader: string | undefined): boolean`
  - `export function probeSessionForget(sessions: object, sessionId: string): void` — if `sessions` has a function named `forget` | `unload` | `remove` | `unregister` of arity ≥ 1, call it with `sessionId` inside try/catch; never invent other APIs
  - `export function probeSessionReload(sessions: object): void` — same for `reindex` | `reload`
  - Client `api.ts`: `getRoot`, `listSessions`, `trash`, `listTrash`, `restore`, `purge` — all `fetch` to `/session-desk/api/...`, mutations set `x-dsh-session-desk: 1`
  - Client `apply` registers `settings.section` id `session-desk` order 30 label 会话管理, tabs 会话 / 废纸篓 (other tabs empty placeholders until later tasks)

- [ ] **Step 1: Write failing tests**

`tests/trash-store.spec.ts` (tmp dir):

```ts
// 1) trash() renames live dir to .trash/<id>/… and writes manifest
// 2) listTrash returns that row; listLive no longer includes it
// 3) restore() moves back to originalPath
// 4) restore when originalPath exists uses `${originalPath}-restored`
// 5) sweepExpired removes only rows older than retentionDays
// 6) sweepExpired does not touch another project's live dirs
```

Concrete first test:

```ts
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTrashStore } from '../src/trash/store.ts'
import { liveSessionDir } from '../src/session-path.ts'

describe('trash store', () => {
  let root = ''
  afterEach(async () => {
    if (root) await (await import('node:fs/promises')).rm(root, { recursive: true, force: true })
  })

  it('moves a session directory into .trash with a manifest', async () => {
    const { mkdtemp } = await import('node:fs/promises')
    root = await mkdtemp(join(tmpdir(), 'desk-trash-'))
    const cwd = '/Users/laiweibin/work/workSoftware/dhs-plugins'
    const sessionId = 'session-edd31b4a-43ab-40ee-9d1c-20b30693decb'
    const live = liveSessionDir(root, cwd, sessionId)
    await mkdir(live, { recursive: true })
    await writeFile(join(live, 'session.jsonl.zstd'), 'x')
    const store = createTrashStore({ root: () => root, retentionDays: () => 30, now: () => 1_720_000_000_000 })
    const result = await store.trash({ sessionId, cwd, title: 'hello' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    await expect(stat(live)).rejects.toThrow()
    const manifest = JSON.parse(await readFile(join(root, '.trash', result.trashId, 'manifest.json'), 'utf8'))
    expect(manifest.sessionId).toBe(sessionId)
    expect(manifest.originalPath).toBe(live)
    expect(manifest.title).toBe('hello')
  })
})
```

`tests/http-host.spec.ts`: fake `webServer.register` like better-sidebar review tests. Assert:

- `Host: evil.com` → 403
- POST without `x-dsh-session-desk: 1` → 403
- POST `trash` missing session → 404 `{ ok: false }`
- GET `root` on 127.0.0.1 returns `{ ok: true, data: { root, source } }`

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement store + http**

Trash layout exactly:

```
<root>/.trash/<YYYYMMDDTHHMMSS>-<shortId>/
  manifest.json
  <projectKey or _no-cwd>/<encodedSessionId>/   # entire original tree
```

`rename` first; on `EXDEV`, copy recursively then `rm` source; if copy fails, leave source.

`listLive`: for each directory under root except `.trash`, if it looks like a project folder, each child dir is a session. `bytes` = recursive size (follow no symlinks). Skip unreadable entries.

Host handler prefix `/session-desk/api`:

| method | path | body |
|---|---|---|
| GET | `/session-desk/api/root` | — |
| GET | `/session-desk/api/sessions` | — |
| POST | `/session-desk/api/trash` | `{ sessionId, cwd?, title? }` |
| GET | `/session-desk/api/trash` | — |
| POST | `/session-desk/api/restore` | `{ trashId }` |
| POST | `/session-desk/api/purge` | `{ trashId }` or `{ all: true }` |

After successful trash: `probeSessionForget(ctx.sessions, sessionId)`. After restore: `probeSessionReload(ctx.sessions)`.

If the session being trashed is `sessions.list()` current (host `list` if function, else skip), try `open` another same-cwd session or `create({ cwd })` before rename. If those methods are missing, still rename (spec accepted refresh).

Settings UI 会话栏: group GET `/sessions` by `cwd`, show title (from DSH `sessions.list` client-side merge: host list supplies path/bytes/sessionId; client matches `ctx.sessions.list` `byId` for `displayTitle` / `updatedAt`). Buttons: 打开 → `ctx.sessions.open(id)`; 删除 → confirm → POST trash. If deleting current, client first `open`/`create` then POST.

废纸篓栏: remaining days `ceil((deletedAt + retentionDays*864e5 - now)/864e5)`; 还原 / 永久删除 / 清空. On restore success show 「已还原，刷新页面后出现在列表」 if we cannot detect a reload method (client assumes always show the hint — cheap and honest).

Changing `sessionsRoot` in the form: reject relative paths in the UI (keep previous); hint 「更换根目录不会带走旧废纸篓」.

- [ ] **Step 4: `pnpm test` PASS; `pnpm build` writes `lib/index.js` + `lib/client.js`**
- [ ] **Step 5: Commit** `feat(session-desk): trash sessions with restore and retention sweep`

---

### Task 3: History minimap (idle dashes → hover titles → click jump)

**Files:**
- Create: `src/history/turns.ts`
- Create: `src/client/history/HistoryStrip.tsx`, `HistoryStrip.module.css` (or `styles.ts` string if CSS modules are painful in the file-search esbuild setup — prefer a template string in `history-styles.ts` injected once, like `dsh-at-file`)
- Create: `src/client/history/PinTurnAction.tsx`
- Modify: `src/client/index.ts` — inject `details` when `historyPosition !== 'off'`; inject pin action when strip on
- Create: `tests/history-turns.spec.ts`

**Interfaces:**
- Consumes: `SessionDeskSettings.historyLimit`, `historyPosition`, `pinnedTurns`
- Produces (copy ui-custom `turns.ts` logic, do not import that package):
  - `export interface HistoryTurn { key: string; index: number; question: string; time?: number; turn?: number }`
  - `export function previewOfNode(kind: string, data: unknown): string`
  - `export function buildTurns(snapshot: { order: readonly string[]; nodes: Map<string, { kind: string; data: unknown; location?: unknown }>; legacy?: { turnTimings?: Map<number, { startTime?: number }> } }): HistoryTurn[]`
  - `export function mergeVisibleTurns(turns: readonly HistoryTurn[], limit: number, pinned: ReadonlySet<number>): HistoryTurn[]` — limit `<= 0` means all, then slice to max 120 after merge
  - `export function jumpToTurn(key: string): void` — `[data-chat-anchor-key]`
  - `export function currentTurnKey(keys: readonly string[]): string | null`

**UI contract (spec §2.3, user screenshots):**

- Idle: ~28px white rounded capsule, one short dash per visible turn; current dash blue; no text.
- Pointer enter capsule or 12px hit padding: expand inward (right dock → panel grows left; left dock → grows right). Each row: truncated question (~60 chars) + dash. Current row blue text + blue dash.
- Leave the combined box: collapse. Hover does not scroll.
- Click row: `jumpToTurn` + 1600ms inset box-shadow.
- Pin: `conversation.chat.assistant-actions` id `session-desk-pin` toggles `pinnedTurns[sessionId]`.

- [ ] **Step 1: Failing tests** for `buildTurns` (user + steering only), preview cap 60 + ellipsis, `mergeVisibleTurns` keeps pins outside the last-N window, hard cap 120, `currentTurnKey` without DOM returns null.

```ts
it('builds one row per user turn', () => {
  const nodes = new Map([
    ['u1', { kind: 'user', data: { content: [{ type: 'text', text: 'hello' }] }, location: { kind: 'turn', turn: { turn: 1 } } }],
    ['a1', { kind: 'assistant', data: { blocks: [] } }],
  ])
  const turns = buildTurns({ order: ['u1', 'a1'], nodes })
  expect(turns).toHaveLength(1)
  expect(turns[0]!.question).toBe('hello')
})
```

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement turns + strip**

Register:

```ts
ctx.slots.inject('details', () => ctx.slots.register({
  name: 'details',
  priority: -1,
  locale: NS,
  inject: (sessionId) => ({ sessionId, loadOlder: () => { void ctx.sessions.binding(sessionId)?.session.loadOlder() }, hooks: { scope } }),
}, HistoryStrip))
```

Auto `loadOlder` while `hasMore` and visible turn count < min(limit or 120) , throttle 300ms, max 24 batches (same as ui-custom).

Measure left edge from AppFrame grid like ui-custom if the sidebar width CSS var `--dsh-sidebar-width` exists; else `12px` from viewport left.

- [ ] **Step 4: `pnpm test` PASS**
- [ ] **Step 5: Commit** `feat(session-desk): hover-expand conversation minimap`

---

### Task 4: 看板 tab + tool classify + model-call timings

**Files:**
- Create: `src/board/classify.ts`, `src/board/model-stats.ts`
- Create: `src/client/board/BoardView.tsx`
- Modify: `src/client/index.ts` — `conversation.view` id `session-desk-board` order 40 when `boardTab`
- Create: `tests/classify.spec.ts`, `tests/model-stats.spec.ts`

**Interfaces:**
- Consumes: chat snapshot + `projectionValues`
- Produces:
  - `export type ToolBucket = 'skill' | 'bash' | 'read' | 'write' | 'search' | 'browse' | 'vision' | 'subagent' | 'other'`
  - `export function classifyTool(name: string): ToolBucket`
  - `export interface ModelCallSample { durationMs?: number; ttftMs?: number; modelKey?: string }`
  - `export interface ModelStatsRow { label: string; count: number; totalMs?: number; medianMs?: number; maxMs?: number; medianTtftMs?: number; fallbackSessionTotal: boolean }`
  - `export function aggregateModelCalls(samples: readonly ModelCallSample[], sessionLlmMs?: number): { all: ModelStatsRow; byModel: ModelStatsRow[] }`
  - `export function collectModelSamples(snapshot: unknown): ModelCallSample[]` — walk nodes; accept `durationMs` / `elapsedMs` / `timing.durationMs`; `ttftMs` / `firstTokenMs`; model from `data.model` or `data.provider`+`data.modelName`. Skip tool-call nodes.

**classifyTool table (spec):**

| name | bucket |
|---|---|
| `skill` / `*skill*` | skill |
| `bash`, `job_output`, `job_kill` | bash |
| `read`, `read_image` | read |
| `write`, `edit` | write |
| `grep`, `glob`, `web_search` | search |
| `web_fetch`, `browser` | browse |
| `vision_ocr` | vision |
| `subagent`, `task`, `send_message` | subagent |
| `unknown_tool` | other |

`web_search` is search, not browse. Match `web_*` except names ending `_search` or equal `web_search`.

**aggregateModelCalls rules (spec):**

- `count` = sample length
- `totalMs` = sum of defined `durationMs`; if none defined and `sessionLlmMs` defined → `totalMs = sessionLlmMs`, `fallbackSessionTotal: true`
- `medianMs` only if ≥1 sample has `durationMs` (sort, middle / average of two middles). Never `total/count` when samples lack durations
- `maxMs` only from samples with duration
- `medianTtftMs` only from samples with `ttftMs`; if zero such samples, leave undefined (UI hides the row)
- `byModel`: group by `modelKey` or omit (then only `all`)
- tool durations must not be passed into this function

- [ ] **Step 1: Write classify + aggregate tests covering every bucket and the “no fake median” case**

```ts
it('does not invent a median from session llmMs', () => {
  const r = aggregateModelCalls([], 18_000)
  expect(r.all.totalMs).toBe(18_000)
  expect(r.all.fallbackSessionTotal).toBe(true)
  expect(r.all.medianMs).toBeUndefined()
  expect(r.all.medianTtftMs).toBeUndefined()
})
```

- [ ] **Step 2: FAIL**
- [ ] **Step 3: Implement + BoardView**

Board header toggle 本会话 | 本工作区.

本会话 blocks in order:

1. 模型调用耗时 (`aggregateModelCalls(collectModelSamples(chat), sessionStats?.llmMs)`)
2. 对话级耗时 — one row per `turnTimings` entry (wall clock; TTFT if present)
3. 会话级 — turns / steps / llmMs / toolMs
4. Token — from `tokenUsage`
5. 调用分类 — count + summed tool time per bucket from tool-call/result pairs

Missing projection → 「暂无统计」, not `0`.

本工作区: sum `sessionStats.llmMs` and session count from `sessions.list` same cwd. Hide median / TTFT / per-model step split. Tool classify still current chat only.

- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** `feat(session-desk): board tab with model-call timings`

---

### Task 5: Appearance (copy ui-custom, `--dsd-*`, security review)

**Files:**
- Create: `src/client/appearance/` by copying from https://github.com/yoli-mi/dsh-client-ui-custom (`src/client/config.ts`, `presets.ts`, `apply.ts`, `color.ts`, `theme-section.ts`, `appearance/*`, `custom.module.css`) then transform
- Create: `src/sanitize.ts` used by apply
- Create: `tests/sanitize.spec.ts`, `tests/appearance-prefix.spec.ts`
- Modify: `src/index.ts` schema — appearance keys already in Task 1; ensure host base seeds them
- Modify: `src/client/SettingsSection.tsx` — 外观 tab hosts AppearanceSection
- Modify: `src/client/index.ts` — `applyConfig` on scope subscribe; preview overlay id `session-desk-preview`

**Must transform (search-replace + tests):**

- `--dsu-` → `--dsd-`
- `data-dsu-active` → `data-dsd-active`
- style id `dsh-ui-custom-css` → `dsh-session-desk-css`
- namespace `ui-custom` → `session-desk`
- Delete shortcuts, marketplace, markdown, usage, features whitelist, HistoryStrip from the copy (we already have our strip)

**sanitize.ts:**

```ts
export function sanitizeWallpaperUrl(raw: string): string | null
export function sanitizeCustomCss(raw: string): string  // max 32768; strip </style>, <script, expression(, -moz-binding (i)
export function sanitizeCustomVars(vars: Record<string, string>): Record<string, string>  // keys /^--[a-zA-Z][\w-]*$/
```

Wallpaper allow: `http:`, `https:`, `data:image/`, path starting with `/`. Reject `javascript:`, `data:text`, newlines, unescaped `)`.

- [ ] **Step 1: Tests**

```ts
expect(sanitizeWallpaperUrl('javascript:alert(1)')).toBeNull()
expect(sanitizeWallpaperUrl('https://x/a.png')).toBe('https://x/a.png')
expect(sanitizeCustomCss('a{}</style><script>x').toLowerCase()).not.toContain('<script')
expect(sanitizeCustomCss('x'.repeat(40000)).length).toBe(32768)
expect(sanitizeCustomVars({ '--ok': '1', 'color': 'red', '--x:y': 'z' })).toEqual({ '--ok': '1' })
```

`appearance-prefix.spec.ts`: after apply helper, read source strings of `apply.ts` / css — assert no leftover `--dsu-` or `data-dsu-active` in those files (`grep` in the test via `readFile`).

- [ ] **Step 2: FAIL**
- [ ] **Step 3: Copy + transform + wire apply through sanitize**

Top of 外观 tab: 「请只开一套主题」 (static callout). Neutral config must not set `data-dsd-active` (keep ui-custom `isNeutral` logic).

- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** `feat(session-desk): appearance theme with reviewed css hooks`

---

### Task 6: Draggable pet overlay

**Files:**
- Create: `src/client/pet/whale.svg` (inline in TS is fine)
- Create: `src/client/pet/PetOverlay.tsx`
- Create: `src/client/pet/status.ts`
- Create: `tests/pet-status.spec.ts`
- Modify: `src/client/index.ts` — `shell.overlay` id `session-desk-pet` when `petEnabled`
- Modify: Settings 小宠物 tab: enable, image URL (run through `sanitizeWallpaperUrl`), reset position

**Interfaces:**
- `export type PetKind = 'running' | 'idle' | 'error' | 'awaiting'`
- `export function petKindOf(openState: string | undefined): PetKind | 'idle'`
  - case-insensitive exact match: `streaming` | `running` | `generating` → `running`
  - `error` | `failed` → `error`
  - `awaiting_input` | `needs_permission` | `blocked` → `awaiting`
  - else `idle`
- Chat text containing 「确认」 must **not** become awaiting (test this).

Pet: 48px, `position: fixed`, default bottom-right above composer (~96px from bottom, 16px from right) when `petX/petY === -1`. Drag writes pixel `petX/petY`. Click toggles popover listing every session in `sessions.list` with kind + title; click row `sessions.open(id)`. Image: `petImage` if `sanitizeWallpaperUrl` succeeds, else whale SVG.

- [ ] **Step 1: status tests**
- [ ] **Step 2: FAIL**
- [ ] **Step 3: Implement overlay**
- [ ] **Step 4: PASS + `pnpm run check` if defined**
- [ ] **Step 5: Commit** `feat(session-desk): draggable status pet`

---

## Self-review (spec coverage)

| Spec | Task |
|---|---|
| §2.1 会话分组 / 删除当前先切换 | 2 |
| §2.2 废纸篓还原/清空/30 天 / 小时+启动扫 | 2 |
| §2.3 小地图两态 | 3 |
| §2.4 看板 + 模型调用耗时 | 4 |
| §2.5 外观抄改审查 | 5 |
| §2.6 小宠物 | 6 |
| §4 sessionsRoot 四级 + 相对路径拒绝 | 1, 2 UI |
| §4.3 探测 forget/reload，禁止伪造 session | 2 |
| §6 customCss/vars/wallpaper | 5 |
| §7 槽位门闩 | 3–6 |
| §8 错误 / 暂无统计 | 2, 4 |
| §9 测试表 | 各 task |
| 不依赖 ui-custom 包 | 全局 |

No TBD. Types: `trashId`, `SessionDeskSettings`, `ToolBucket`, `ModelCallSample` used consistently.
