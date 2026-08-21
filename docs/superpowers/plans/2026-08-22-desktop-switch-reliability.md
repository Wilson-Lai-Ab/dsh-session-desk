# 桌面/浏览器切换可靠性实现计划

> **For agentic workers:** 这是 M 级单一功能（贯穿 lifecycle/http/客户端 4 个模块），本会话内行执行，结束后一次整功能评审。

**Class:** M — 一个功能（桌面模式切换）贯穿 lifecycle.ts + http.ts + PetOverlay.tsx + 测试 4 个已存在模块。

**Goal:** 让「桌面/浏览器」切换可正常使用：切桌面不再被 ~100MB Electron 下载阻塞而自动回退，改为后台下载 + 进度可见，浏览器端不因下载中断把 petDesktop 改回 false。

**Architecture:** 把 `spawn()` 从"同步下载完才返回"改为"后台下载、立即返回"：下载状态（idle/downloading/ready/failed + pct）存入 controller，`/spawn` 返回 202（accepted），`/status` 轮询携带下载进度；客户端 reconcile 只在**明确失败**时才回退 petDesktop，下载中显示"正在准备桌面依赖…"。

**Tech Stack:** TypeScript 插件（node 宿主 + scripts"),
spawn 使用 `node:child_process`。测试 vitest。

**Spec:** 用户已批准的设计（见会话）：保留下载 Electron、切桌面时后台下载并返回 202、/状态进度、下载中不回退。

## 全局约束

- 运行验证：`node build.mjs`（生成 lib/index.js + lib/client.js）和 `npx vitest run`（全量 264+ 例必须全绿）。
- tsc 校验：`npx tsc -p tsconfig.json`（tsconfig rootDir:src，include==["src"]，**不得**在命令行加源码文件参数）。
- 不引入新 npm 依赖（只允许已存在的）。
- 不动 DSH 源码；端口 3080 是用户 GUI，不得擅自杀/重启进程；宿主（lib/index.js）改动需用户重启 DSH 才生效。
- GNU 文件路径这些都是同位 app 内既有模式，沿用现有写法。

---

## Task 1: lifecycle.ts 后台下载状态 + 非阻塞 spawn

**Files:**
- Modify: `src/desktop/lifecycle.ts`
- Test: `tests/desktop-lifecycle.spec.ts`

**Interfaces:**
- Consumes: `Deps`（现有 `spawn?`, `getExecutable?`），保持 `spawn(baseUrl, token)` 签名不变。
- Produces：
  - `DownloadState` 类型 `{ stage: 'idle'|'downloading'|'ready'|'failed'; pct: number|null; error?: string }`
  - `DesktopPetController` 增加 `downloadState(): DownloadState`
  - `spawn(baseUrl, token)` 从"同步下载完才 spawn"改为"后台下载、立即返回 202"。

- [ ] **Step 1: 写失败测试**（tests/desktop-lifecycle.spec.ts 新增）——断言 spawn 立即返回（非阻塞），下载状态可观测：

```ts
describe('DesktopPetController background download', () => {
  it('spawn returns before the Electron download completes; downloadState tracks downloading→ready', async () => {
    const controller = createDesktopPetController({
      getExecutable: async () => { await new Promise(r => setTimeout(r, 30)); return '/fake/electron' },
      spawn: () => ({ kill: vi.fn(), on: vi.fn(), unref: vi.fn(), stdout: null }),
    } as never)
    const started = Date.now()
    const p = controller.spawn('http://127.0.0.1:3080', 'tok')
    // 未等下载完成就检查状态：stage 已是 downloading（后台启动）
    expect(controller.downloadState().stage).toBe('downloading')
    await p
    expect(controller.downloadState().stage).toBe('ready')
    expect(controller.isActive()).toBe(true)
    expect(Date.now() - started).toBeGreaterThanOrEqual(25) // 确实经过下载等待，而非同步
  })

  it('on executable failure, stage=failed and spawn does not throw to caller', async () => {
    const controller = createDesktopPetController({
      getExecutable: async () => { throw new Error('no electron') },
      spawn: vi.fn(),
    } as never)
    const p = controller.spawn('http://h', 't')
    // 立即返回（不阻塞在失败上）
    await expect(p).resolves.toBeUndefined()           // spawn 本身不 rethrow
    expect(controller.downloadState().stage).toBe('failed')
    expect(controller.downloadState().error).toContain('electron')
    expect(controller.isActive()).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**：`npx vitest run tests/desktop-lifecycle.spec.ts` → 新用例因 `downloadState` 不存在而报 FAIL。

- [ ] **Step 3: 实现 lifecycle.ts 后台下载**

```ts
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { detectTarget, ensureElectron } from './electron.ts'

export type DownloadStage = 'idle' | 'downloading' | 'ready' | 'failed'
export interface DownloadState { stage: DownloadStage; pct: number | null; error?: string }

export interface DesktopPetController {
  spawn(baseUrl: string, token: string): Promise<void>
  close(): void
  isActive(): boolean
  downloadState(): DownloadState
  onExit(cb: () => void): () => void
}

export function createDesktopPetController(deps?: Deps): DesktopPetController {
  const spawnFn = deps?.spawn ?? nodeSpawn
  const getExecutable = deps?.getExecutable ?? (() => ensureElectron(detectTarget()))
  let child: ChildProcess | null = null
  let active = false
  const exitCbs = new Set<() => void>()
  let stage: DownloadStage = 'idle'
  let errorMsg: string | undefined
  let pending: Promise<void> | null = null

  // 下载 Electron 并启动桌面窗口。stat 在后台任务中推进；不对外 rethrow 到 spawn() 调用方。
  async function launch(baseUrl: string, token: string): Promise<void> {
    try {
      stage = 'downloading'
      const exe = await getExecutable()
      stage = 'ready'
      const mainJs = fileURLToPath(new URL('./desktop/main.mjs', import.meta.url))
      const spawned = spawnFn(exe, [mainJs, `--base=${baseUrl}`, `--token=${token}`], { stdio: 'ignore' })
      child = spawned
      active = true
      spawned.on('exit', () => {
        if (child !== spawned) return
        active = false
        child = null
        for (const cb of exitCbs) cb()
      })
      spawned.unref?.()
    } catch (error) {
      stage = 'failed'
      pMsg = error instanceof Error && error.message ? error.message : 'spawn failed'
      active = false
      child = null
      throw error // 记录失败；外部无需 await 抛，端 `/status` 读 stage
    }
  }

  function begin(baseUrl: string, token: string): Promise<void> {
    if (pending) return pending
    pending = launch(baseUrl, token)
    return pending
  }

  return {
    spawn: (baseUrl, token) => begin(baseUrl, token),
    close(): void {
      if (child !== null) child.kill()
      active = false
      child = null
      stage = 'idle'
      errorMsg = undefined
      pending = null
    },
    isActive: () => active,
    downloadState: () => ({ stage, pct: stage === 'downloading' ? null : null, ...(errorMsg ? { error: errorMsg } : {}) }),
    onExit(cb) { exitCbs.add(cb); return () => exitCbs.delete(cb) },
  }  }
```

> 说明: `pct` 仅 `idle/downloading` 时可为 nullable——这里统一传 `null`（Electron 下载不做百分比，客户端只需展示「正在准备」）。`close()` 重置 pending，若下载还在跑则下次 spawn 重新开始。

- [ ] **Step 4: 全绿**：`npx vitest run tests/desktop-lifecycle.spec.ts` → 原有 2 个用例 + 新 2 个全 PASS。

- [ ] **Step 5: 提交**：`git add src/desktop/lifecycle.ts tests/desktop-lifecycle.spec.ts && git commit -m "feat(desktop): background electron download + downloadState"`

---

## Task 2: http.ts /spawn 返回 202、/status 携带下载进度

**Files:**
- Modify: `src/desktop/http.ts`
- Test: `tests/desktop-http.spec.ts`

**Interfaces:**
- Consumes: `DesktopPetController`（新 `downloadState()`）；`PET_DESKTOP_PREFIX` 保持。
- Produces: `/pet-desktop/spawn` POST 返回 `202 {ok:true, active:false, downloading:true}`（不阻塞等待下载）；`/pet-desktop/status` GET 响应加 `download: {stage, pct?, error?}`。

- [ ] **Step 1: 写失败测试**（desktop-http.spec 新增 + 改 1 个）

```ts
it('/spawn returns 202 and does not wait for the download', async () => {
  const { handler, controller } = handlerWith()
  // 用真实 controller（后台下载）取代 handlerWith 里的 stub
  // （此处避免真实 spawn，用假的 electron 返回）
  let resolved = false
  ;(controller as never).spawn = () => new Promise(r => setTimeout(() => { resolved = true; r() }, 50))
  const t0 = Date.now()
  const r = await call(handler, 'POST', `${PET_DESKTOP_PREFIX}/spawn`, {}, mutationHeaders)
  expect(Date.now() - t0).toBeLessThan(50)
  expect(r.status).toBe(202)
  expect(r.body).toEqual({ ok: true, active: false, downloading: true })
  expect(resolved).toBe(false) // 未等待下载完成即返回
})

  it('/status publishes download progress', async () => {
    const { handler, controller } = handlerWith()
    ;(controller as { downloadState?: () => unknown }).downloadState = () => ({ stage: 'downloading', pct: null })
    const r = await call(handler, 'GET', `${PET_DESKTOP_PREFIX}/status`)
    expect(r.status).toBe(200)
    expect(r.body.download).toEqual({ stage: 'downloading', pct: null })
  })
```

- [ ] **Step 2: 失败确认**：`npx vitest run tests/desktop-http.spec.ts` → 新用例 FAIL。

- [ ] **Step 3: 实现 http.ts**

spawn 分支（约 line 51-61）：
```ts
    if (path === `${PET_DESKTOP_PREFIX}/spawn`) {
      const host = header(req, 'host') ?? '127.0.0.1:3080'
      void opts.controller.spawn(`http://${host}`, opts.token)
      writeJson(res, 202, { ok: true, active: false, downloading: true })
      return
    }
```

status 分支（约 line 37-39）：
```ts
    if (method === 'GET' && path === `${PET_DESKTOP_PREFIX}/status`) {
      writeJson(res, 200, { ok: true, active: opts.controller.isActive(), pendingOpen: opts.state.pendingOpen, download: opts.controller.downloadState() })
      return
    }
```
> 注意 controller.spawn 从"阻塞"改为"不等待"：删掉原先 `await` + try/catch（其失败现在走下载 stage，/status 披露）。同时 `/close` 分支保持不变。

- [ ] **Step 4: 全绿**：`npx vitest run tests/desktop-http.spec.ts`。注意原先 `/spawn returns active on success`（expect 200 active:true）需改为 202；原先 `/spawn 500` 用例因 spawn 不在失败时抛给端。保留 `/close`、host/mutation gate 其余用例不变。
  > 如果你在原 /spawn 500 用例仍有依赖，改成断言 `/status` 下载 failed：`download.stage==='failed'`。

- [ ] **Step 5: 提交**：`git add src/desktop/http.ts tests/desktop-http.spec.ts && git commit -m "feat(desktop): non-blocking spawn + download progress in /status"`

---

## Task 3: PetOverlay 不自动回退 + 下载提示

**Files:**
- Modify: `src/client/pet/PetOverlay.tsx`
- Modify: `src/client/locales.ts`
- Test: `tests/desktop-http.spec.ts`（若浏览器逻辑有独立测试则加分——本插件无 PetOverlay 单测，改为评审验证）

**Interfaces:**
- Consumes: `PET_DESKTOP_PREFIX`、`CSRF_HEADERS`；`petDesktop` 设置。
- Produces: reconcile effect 不再因 spawn 200/202 回退；仅在 `/spawn` 404/405/非 2xx 明确失败才回退；下载中显示「正在准备桌面依赖…」。

- [ ] **Step 1: 改 reconcile effect**（PetOverlay.tsx 约 295-315）

原代码在 `spawn` 返回 `!res.ok` 时 `props.update?.({ petDesktop: false })`。新行为：
```ts
    if (petDesktop) {
      void (async () => {
        try {
          const res = await fetch(`${PET_DESKTOP_PREFIX}/spawn`, { method: 'POST', headers: CSRF_HEADERS, body: '{}' })
          if (!res.ok && !cancelled) void props.update?.({ petDesktop: false })
        } catch {
          // 网络抖动不自动回退；留给轮询 `/status` 反映下载失败
          if (!cancelled && prev !== null) void props.update?.({ petDesktop: false })
        }
      })()
    }
```
> 关键是：2xx(202) 现在返回 ok 而不回退。若 `/spawn` 干脆 404（宿主旧版无此端点）网络错误时，才回退。

- [ ] **Step 2: 下载中提示**：PetOverlay 当前轮询`/status`（约 242-288），把 `data.download?.stage==='downloading'` 反映为 UI。可用一个 `desktopDownloading` 状态（`useState(false)`），当它 true 且宠物在桌面激活前，气泡可显示小字「正在准备桌面依赖…」。可选择把该文字做成可 i18n 键 `pet.desktopPreparing`/`正在准备桌面依赖…`。若不想改变气泡布局，也可在设置行里下行。

- [ ] **Step 3: 验证**：`npx tsc -p tsconfig.json` 无错；`node build.mjs` 成功（lib/client.js 变新）。由于浏览器 UI 无法自动单测，此任务走评审（Step 5）。

- [ ] **Step 4: 提交**：`git add src/client/pet/PetOverlay.tsx src/client/locales.ts && git commit -m "feat(desktop): no auto-revert on spawn + preparing hint"`

---

## Task 4: 全量验证 + 提交

**Files:** 无
- [ ] **Step 1**: `npx vitest run`（全量，期望 264+ 全绿）
- [ ] **Step 2**: `npx tsc -p tsconfig.json`（无输出）
- [ ] **Step 3**: `node build.mjs`（lib/index.js + lib/client.js 重建成功）
- [ ] **Step 4**: curl 验证新契约（宿主需用户重启）：
  - `GET /session-desk/pet-desktop/status` → `{ok:true, active:…, download:{stage:…}}`
  - `POST /session-desk/pet-desktop/spawn` → `202 {ok:true,active:false,downloading:true}`
- [ ] **Step 5**: 提交：`git add -A && git commit -m "feat(desktop): reliable browser/desktop switch (background download)"`

---

## Task 5: 整功能最终评审（M 级）

- [ ] 派发 1 个 subagent 无 reveraging 评审上面 Tasks 1-3 的 lifecycle/http/PetOverlay 改动（后台下载、202、不自动回退、/status 进度），回顾首轮 Brainstorm 设计逐条对照。评审标准：root-cause 是否真解决、是否引入回归、是否还有阻塞当前的任务。
- [ ] 修复评审发现后重跑 vitest + tsc + build 确认不回归。