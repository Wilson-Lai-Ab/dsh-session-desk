# dsh-session-desk v2 设计（看板图表化 + 废纸篓侧栏级联）

**日期**：2026-08-20
**状态**：已批准待实施
**范围**：对已上线的 `dsh-session-desk` 做两块增量——① 看板图表化；② 废纸篓进侧栏、支持拖拽删除、主代理级联删除子代理。

---

## 0. 已拍板决定

| 题 | 决定 |
|---|---|
| 图表实现 | 自绘（div 条形 + `conic-gradient` 环形），不引入任何 npm 图表库。配色走 DSW CSS 变量，跟随主题。 |
| 模型调用图 | **两者都保留**：①「每回合触发的模型调用次数」柱状图（横轴=回合，纵轴=条数）；② 按模型横向条形图（次数 / 合计）。 |
| 废纸篓入口 | 官方 `sidebar.footer.action` 干净槽位，渲染在侧栏底部「设置」上方。点击展开废纸篓面板；图标同时是拖放目标。 |
| 拖拽删除 | 工作区会话行拖起时 `dataTransfer.setData("text/plain", sessionId)` 已带 id；废纸篓图标 `drop` 读取该 id。 |
| 级联粒度 | 主代理 + 全部子代理 = 废纸篓里**一个条目**（一行），还原整棵一起回来。 |
| 级联判定 | `origin === 'subagent'` 是**唯一**权威判定。普通 fork 会话即使带 `parentId` 也不算子代理、不动。 |
| 数据来源 | 客户端从 `useSessions` 快照（`byId` 的 `parentId`/`origin` + `subagentsByParent` 目录）求子树，host 只负责搬目录。 |

---

## 1. 背景与非目标

看板当前是纯 `<details>` + 键值行，信息密度低、观感差。废纸篓目前只活在「设置 → 会话管理」里，删除动作离侧栏会话列表太远，且删除主代理不会带走子代理（子代理散落在原地成为孤儿）。

**非目标**

- 不引入任何第三方图表库（chart.js / recharts / d3 等）。
- 不做「按工作区批量删」「拖到工作区组上重排」等原生已有能力的替代。
- 不改 `sidebar.workspaces` 槽（它被 ui-workspace 整占用，无底部插槽）。
- 不改宿主 DSH 源码、不依赖 `dsh-better-sidebar`。
- 不把看板搬出「对话页头 Tab」这个位置。

---

## 2. 子系统 A：看板图表化

### 2.1 数据

全部来自现有纯函数，仅做一处增强：

- `collectModelSamples(chat)` → `ModelCallSample[]`：**新增 `turn?: number`**，从节点 `payload.turn`（assistant 节点自带）读取。
- `collectTurnTimings(chat, top)` → `{ turn, wallMs?, ttftMs? }[]`：已存在。
- `collectToolStats(chat)` → `ToolBucket[]`（bucket / count / totalMs）：已存在。
- `readTokenUsage(...)` / `sumTokenUsage(...)` → `TokenUsage`（input/output/cacheRead/cacheWrite）：已存在。

### 2.2 图表组件（`src/client/board/charts.tsx`）

四个纯展示组件，零依赖、响应式、主题化：

| 组件 | 形态 | 输入 | 说明 |
|---|---|---|---|
| `PerTurnCallsChart` | 纵向柱状 | `{ turn, calls }[]` | 横轴=回合号，纵轴=该回合模型调用条数；悬停显示回合与条数 |
| `ModelBars` | 横向条形 | `{ label, count, totalMs }[]` | 按模型对比；条长=totalMs（缺则=count），尾注「n 次 · 合计 X」 |
| `TurnTimingChart` | 纵向柱（墙钟）+ 叠加 TTFT 标记 | `{ turn, wallMs?, ttftMs? }[]` | 每回合一根墙钟柱，柱顶/旁标 TTFT |
| `TokenDonut` | `conic-gradient` 环形 | `TokenUsage` | 输入/输出/缓存读/缓存写四段占比，中心标注总 token；某段为 0 则不画 |

实现细节：

- 条形图用 `div` + 内联 `width: %`，比例取 `value / max`；不设死高，`max-width` 限制、文字右对齐。
- 环形图用 `background: conic-gradient(...)`，各段色取 DSW 别名变量；中心绝对定位写总 token。
- 配色：`--dsw-alias-brand-primary` 为主色，桶色取一组固定的 CSS 变量回退色板。
- 全部组件在无数据 / 全 0 时返回与现有 `Empty` 一致的占位，不渲染空图。

### 2.3 看板结构

保留「本会话 / 本工作区」切换与现有数字行，把四个块改成「图表 + 可折叠数字明细」：

- 模型调用块：`PerTurnCallsChart`（本会话有样本时）→ `ModelBars` → 折叠的数字明细（合计/中位/最长/TTFT，工作区模式只显合计与条数）。
- 对话级耗时块：`TurnTimingChart` 取代逐回合键值行。
- Token 块：`TokenDonut` 取代四行键值。
- 调用分类块：横向条形（条长=次数，尾注=耗时）取代 `bucket × n` 键值。

工作区模式无逐步样本：模型调用只显示 `ModelBars` 的合计条与「会话数」，不画 `PerTurnCallsChart`；Token 用 `sumTokenUsage`；分类仍以当前会话 chat 为准。

### 2.4 测试

- `tests/model-stats.spec.ts`：`collectModelSamples` 返回的样本携带 `turn`（构造带 `turn` 的 assistant 节点断言）。
- 新增 `tests/board-charts.spec.ts`：`perTurnCallCounts(samples)` 聚合正确（含缺 turn 的样本被忽略）；`tokenSegments(usage)` 各段占比与全 0 兜底。

---

## 3. 子系统 B：废纸篓侧栏 + 拖拽 + 级联

### 3.1 入口与面板（客户端）

- 在 `src/client/index.ts` 注册 `sidebar.footer.action`（list 槽），id `session-desk-trash`。
- 新组件 `src/client/trash/TrashFooter.tsx`，owner 收到 `{ wide }`；inject 收到 `t`、`sessions`、`useSessions`、`useScope`（读 retention）。
- 渲染一个废纸篓图标（`wide=false` 仅图标，`wide=true` 图标 + 「废纸篓」标签）。
- 点击切换一个 `position: fixed` portal 面板（锚定图标，避开视口边缘），列出废纸篓条目：标题 / 大小 / 剩余天数，每项「还原」「永久删除」，顶部「清空」。复用现有 `api.listTrash/restore/purge/purgeAll` 与 `trash.*` 文案；新增 `trash.members` 文案（`含 {n} 个子代理`）。
- 空态显示 `trash.empty`。

### 3.2 拖拽删除

- 图标根元素挂 `onDragOver`（`preventDefault()` + `dropEffect='move'`，拖拽悬停时高亮）与 `onDrop`。
- `onDrop`：`sessionId = e.dataTransfer.getData("text/plain")`；为空则忽略。
- 弹 `window.confirm`（`sessions.confirmDelete`），确认后走 3.3 求子树 → 3.4 提交。
- 拖拽仅来自工作区会话列表（分组/平铺态，搜索态行不可拖，无需处理）。

### 3.3 级联判定（纯函数，客户端）

新增 `src/trash/cascade.ts`（host/client 共用，无 DOM）：

- 输入：`byId: Record<id, { id, parentId?, origin? }>` + `subagentsByParent: Record<id, { entries?: { id, hasChildren? }[] }>` + 根 id。
- `collectDescendants(root, byId, subagentsByParent): string[]`：
  - BFS 从 `root` 出发。
  - 子代理判定：**仅 `origin === 'subagent'`**。`byId` 中 `parentId === current && origin === 'subagent'` 视为直接子；`subagentsByParent[current].entries` 里 `kind === 'child'` 的 id 也并入（去重）。
  - 有 `hasChildren` 或还有 `byId` 后代时继续入队。
  - fork 会话（有 `parentId` 但无 `origin: 'subagent'`）**不**入结果，且不阻断遍历（子代理链仍按子代理的 `parentId` 继续）。
  - 返回按发现顺序去重后的后代列表（不含 root 自身）。
- 调用方在确认前对根 `void sessions.refreshSubagents(root)` 做一次 best-effort 刷新（目录可能未加载）；若目录尚未就绪、`byId` 已含 lineage，以 `byId` 为准即可，不阻塞提交。

### 3.4 多成员废纸篓（host）

**类型**（`src/trash/types.ts`）：

```ts
interface TrashMember { sessionId: string; originalPath: string; cwd?: string }
interface TrashManifest {
  version: 1
  sessionId: string   // 根（主代理）id
  cwd: string
  title: string       // 根标题
  deletedAt: number
  originalPath: string // 根原路径（向后兼容）
  bytes: number        // 成员字节总和
  members?: TrashMember[] // 多成员时存在（根在前）；单成员省略
}
```

**`trash(input)`**（`src/trash/store.ts`）：

- `input` 增 `sessionIds?: string[]`（缺省回退 `[input.sessionId]`）。
- 逐个把 `sessionId` 解析为 live 目录（`liveSessionDir` 优先，miss 时 `listLive` 兜底）；任一 miss 返回 `not-found`。
- 每个成员 `moveTree` 进 `.trash/<trashId>/<relative(live)>/`；`trashId` 仍由根 id + 时间生成。
- `bytes = Σ dirSize(member)`；写 manifest（多成员带 `members`，根在前）。
- 移动中失败：已搬的回滚（`rm` 已创建的 `entryDir`），返回 `io`。

**`restore(trashId)`**：

- 有 `members`：逐个 `restoreDestination(member.originalPath)` 分配不冲突目标并 `moveTree` 回来，全部成功后 `rm(entryDir)`；任一失败走现有错误路径。
- 无 `members`：保持现有 `nestedSessionDir` 单成员逻辑不变。

**`listTrash()`**：manifest 带 `members` 时，额外返回 `memberCount = members.length - 1`（子代理数；单成员为 0），供面板显示 `含 N 个子代理`。

**HTTP**（`src/http.ts`）：`POST /trash` body 接受 `{ sessionIds: string[] }`（非空字符串数组）或旧 `{ sessionId, cwd?, title }`；缺/非法返回 400。`GET /trash`、`/restore`、`/purge` 不变。

**API 客户端**（`src/client/api.ts`）：`trash({ sessionIds })` 组装请求；旧 `trash({ sessionId, cwd, title })` 保留。

### 3.5 测试

- `tests/cascade.spec.ts`：`collectDescendants` —— 单层子代理、嵌套子代理、`byId` 与目录去重、**fork 会话（有 parentId 无 origin）不入结果**、环（父子互指）不死循环。
- `tests/trash-store.spec.ts`：多成员 trash 生成一个 `trashId` + `members`；`listTrash` 返回 `memberCount`；`restore` 整棵还原；单成员回归不变。

---

## 4. 文件清单

- 改：`src/board/model-stats.ts`（sample 加 `turn`）、`src/client/board/BoardView.tsx`、`src/client/board/board-styles.ts`
- 新：`src/client/board/charts.tsx`、`src/trash/cascade.ts`、`src/client/trash/TrashFooter.tsx`
- 改：`src/trash/types.ts`、`src/trash/store.ts`、`src/http.ts`、`src/client/api.ts`、`src/client/index.ts`、`src/client/locales.ts`（新增 `trash.members` 等文案）
- 测试：`tests/model-stats.spec.ts`、`tests/board-charts.spec.ts`（新）、`tests/cascade.spec.ts`（新）、`tests/trash-store.spec.ts`

---

## 5. 错误处理

- 拖放目标读到空 id：静默忽略。
- 级联求子树在快照缺失字段时优雅降级为只删根（不抛错）。
- 多成员移动中途失败：回滚已搬目录，返回 `io`，前端 `action.failed` 提示。
- 目录未加载导致漏删子代理：刷新目录为 best-effort；若确实漏了，用户可在废纸篓面板看到根条目仍已入篓，孤儿子代理留在原地（可接受，不做二次兜底）。
