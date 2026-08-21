# dsh-session-desk 设计

**日期**：2026-08-19  
**状态**：已批准，待用户审阅本文件后进入实施计划  
**包名**：`dsh-session-desk`  
**设置页标题**：会话管理  
**settings 命名空间**：`session-desk`  
**范围**：独立 Web 插件——会话分组管理、废纸篓、对话小地图、轨迹旁看板 Tab、外观（自带，不依赖第三方主题包）、系统级小宠物  

---

## 0. 已拍板决定

| 题 | 决定 |
|---|---|
| 打包 | 一个新插件。不依赖 `@ha-na-bi/dsh-client-ui-custom` npm 包。 |
| 工作区 | 只按 cwd 分组列会话。不做工作区新建 / 删除 / 重命名。 |
| 删除 | 原生 UI 没有删除。本插件自己加删除入口，一律进废纸篓。 |
| 清缓存 | 只搬该会话目录整棵。路径读配置，不写死 `~/.dsh/sessions`。 |
| 看板 | 对话页头「对话 / 轨迹」旁第三个 Tab。设置可关。 |
| 主题 | 从 ui-custom **抄**外观管线（壁纸 / 玻璃 / 强调色 / 预设 / 预览），改 CSS 前缀并做代码审查。不抄市场、快捷键、用户 Markdown、用量页。 |
| 小地图 | 默认圆角胶囊 + 短横线；鼠标靠近展开问句；点击才跳转。 |

---

## 1. 背景与非目标

DSH Web 侧栏能列会话、打开、新建，但不能删除、不能回收、没有对话内小地图、没有调用路径分类看板、没有跨会话进度宠物。`dsh-synapse` 是工作区画布，不管归档。`dsh-client-ui-custom` 有声波条小地图和完整外观页，但本插件明确不依赖它。

**非目标**

- 不改 DeepSeek Harness 源码。
- 不依赖 `dsh-client-ui-custom`、不 fork 成同一仓库。
- 不做工作区 CRUD、synapse 画布、插件市场、快捷键重映射、用户消息 Markdown。
- 不把看板做成独立设置页里的用量统计（那是 ui-custom 的「应用用量」）；看板只活在对话页头 Tab。
- 不扫描 `~/.dsh` 全局缓存。废纸篓只动解析后的 `sessionsRoot` 下该会话目录。

---

## 2. 产品行为

### 2.1 会话管理

设置 → **会话管理** →「会话」栏。按 **cwd** 分组，组标题用工作区名或 cwd 末段。组内按 `updatedAt` 降序。

每行：标题、相对时间、体积（host 算目录字节）、打开、删除（进废纸篓）。

删除当前正在看的会话：先切到同 cwd 其它会话；没有则 `sessions.create({ cwd })`；再搬家。删带子代理的根会话前弹确认：「子会话会一起从列表消失」。只搬被选中的那一棵目录。

### 2.2 废纸篓

设置 → 会话管理 →「废纸篓」栏。

- 还原：搬回 `manifest.originalPath`；目标已存在则目录名加 `-restored`。
- 永久删除：确认后 `rm -rf` 该废纸篓条目。
- 清空：确认后删掉 `.trash` 下全部条目。
- 每条显示剩余天数。到期由 host 小时任务真删。

默认保留 **30** 天，设置 `retentionDays` 钳制在 1–365。

### 2.3 对话小地图

挂在 `details` 槽，`position: fixed`，默认贴对话列右缘（详情栏关着也还在）。

**空闲（默认）**  
白底圆角胶囊，约 28px 宽。每条可见回合一条短横线：普通灰，当前回合蓝。无文字。

**靠近**  
指针进入胶囊或外扩命中区（约 12px）后展开成词条列表：问句在靠近对话的一侧（右贴时向左展开，左贴时向右展开），短横仍在贴边一侧。当前回合蓝字 + 蓝横。指针离开整块（胶囊 + 展开面板）后收回。悬停不滚动对话。

**点击**  
点某一行：`scrollIntoView({ behavior: 'smooth', block: 'start' })`，该行短暂左边线高亮。

**数据**  
当前会话已挂载 `chat` 快照里每个 `user` / `steering` 节点一行。设置 `historyLimit` 默认 10；`0` = 全部，硬顶 **120** 条（再多自动 `loadOlder` 也停）。钉住的回合忽略条数上限，始终出现在展开列表。

**设置**  
`historyPosition`：`off` / `left` / `right`，默认 `right`。`left` 贴对话列左缘（侧栏宽度变化时跟着量）。

### 2.4 看板 Tab

`conversation.view` 注册，`id: session-desk-board`，标签「看板」，`order` 介于原生「对话 / 轨迹」和 better-sidebar 停文件（order 100）之间，取 **40**。

`boardTab === false` 时不注册，轨迹 Tab 不受影响。

页内顶部切换：**本会话**（默认）/ **本工作区**。

| 块 | 数据 |
|---|---|
| 模型调用耗时 | 见下方「模型调用」；看板第一块，默认展开 |
| 对话级耗时 | `chat.legacy.turnTimings`：每回合墙钟；有 TTFT 则显示 |
| 会话级耗时 | `projectionValues.sessionStats`：turns / steps / llmMs / toolMs |
| Token | `projectionValues.tokenUsage`：input / output / cacheRead / cacheWrite |
| 调用分类 | 遍历 chat 的 tool-call 节点，按工具名分桶计数 + 耗时 |

**模型调用（本会话）** 从当前 chat 里每条助手模型步骤收集 `{ durationMs, ttftMs?, modelKey? }`（步骤上的 start/end、`turnTimings`、节点 data 里能读到的 model 字段，缺啥跳过啥，不编造）。展示：

| 指标 | 算法 |
|---|---|
| 调用次数 | 步骤条数 |
| 合计 | `sum(durationMs)`；若步骤时长都缺，回退 `sessionStats.llmMs`，并标注「仅会话合计」 |
| 中位 | 步骤时长排序后的中位数；步骤少于 1 条则显示「暂无分位」，不用合计除次数冒充 |
| 最长 | `max(durationMs)` |
| TTFT 中位 | 有 `ttftMs` 的步骤才进样本；一条都没有则整行隐藏 |
| 按模型 | `provider:model` 分组，每组重复「次数 / 合计 / 中位」；分不出模型则只有「全部」一行 |

**本工作区** 模式：模型调用块只汇总各会话 `sessionStats.llmMs` + 会话数（list 投影里没有逐步样本，不算中位）。中位 / TTFT / 按模型逐步拆分仍只在「本会话」有。

禁止把工具耗时算进模型调用。`toolMs` 只出现在会话级耗时和调用分类里。

分类表（未知进「其它」，不提供自定义分类）：

| 桶 | 匹配 |
|---|---|
| skill | 工具名含 `skill` 或 slash-skill 调用 |
| bash | `bash` / `job_*` |
| 读文件 | `read` / `read_image` |
| 写文件 | `write` / `edit` |
| 搜索 | `grep` / `glob` / `web_search` |
| 浏览 | `web_*` 除 search、`browser` |
| vision | `vision_*` |
| 子代理 | `subagent` / `task` / `send_message` |
| 其它 | 其余 |

本工作区模式：聚合 `sessions.list` 里同 cwd 的 `projectionValues`；调用分类仍以**当前已打开会话**的 chat 为准（未打开的会话不额外拉全量日志）。

### 2.5 外观

设置 → 会话管理 →「外观」栏。能力对齐 ui-custom 外观页：预设、壁纸、玻璃档位、强调色 / 自动取色、各表面不透明度、渐变、暗色遮罩、字体、滚动条强调色、晕影、自定义 CSS / 变量、小窗预览。

默认全部中性：没改任何旋钮时 DOM 与原版 DSH 一致（不写 `data-dsd-active`）。

与已安装的 `dsh-client-ui-custom` 同时开启时：两套都会写 `<html>` 变量。本插件用 `--dsd-*`，不覆盖 `--dsu-*`。若用户两套都配了壁纸，视觉会叠两层；外观栏顶部提示「请只开一套主题」。

### 2.6 小宠物

`shell.overlay`，`position: fixed`，默认可拖。默认形象：内置 DeepSeek 小鲸鱼 SVG。`petImage` 非空则用该 URL（同一套壁纸 URL 白名单）。

订阅 `sessions.list`（全部会话，不限当前对话）：

| 状态 | 判定 |
|---|---|
| 运行 | `openState` 为 streaming / running / generating 一类 |
| 空闲 | 已打开且非运行、非错误 |
| 出错 | `openState` 或最后一步 error |
| 待确认 | 仅当该会话 `openState` 等于 `awaiting_input` / `needs_permission` / `blocked` 之一（大小写不敏感）。chat 正文里出现「确认」二字不算。对不上这些状态就不显示待确认 |

点击展开小面板：会话名 + 状态列表，点一项 `sessions.open`。可关（`petEnabled`）。默认停在视口右下，避开 composer。位置 `petX` / `petY` 为距左 / 上的像素，拖完写入设置。无声音。

---

## 3. 架构

独立包，形态对齐 `dsh-at-file`：

```
dsh-session-desk/
  src/index.ts                 host：settings namespace + trash API + 小时回收
  src/sessions-root.ts         sessionsRoot 解析
  src/trash/                   搬家 / 还原 / 到期删除 / manifest
  src/board/classify.ts        工具名 → 桶（纯函数，host/client 可共用）
  src/shared.ts                设置 schema 类型、默认值（无 DOM）
  src/client/index.ts          注册设置页、小地图、看板 Tab、宠物、外观 apply
  src/client/history/          小地图两态 UI
  src/client/board/            conversation.view 看板
  src/client/pet/              overlay 宠物
  src/client/sessions/         设置页会话 / 废纸篓栏
  src/client/appearance/       从 ui-custom 迁入并改前缀
  cordis.patch.yml
```

**依赖**：`@deepseek-ai/dsh-client-runtime`、`dsh-client-ui-settings`、`dsh-client-ui-slots`、`dsh-settings`、`schemastery`、React。`dsh-better-sidebar` **不是**依赖；看板走原生 `conversation.view` 槽，不经 sidebar 服务。

**host API**（自有 HTTP，loopback Host 校验，写接口带插件标记头，对齐 skills-manager）：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/session-desk/api/root` | 当前解析出的 sessionsRoot、来源（config/env/home/default） |
| GET | `/session-desk/api/sessions` | 按 cwd 分组 + 每目录字节数 |
| POST | `/session-desk/api/trash` | `{ sessionId }` 进废纸篓 |
| GET | `/session-desk/api/trash` | 废纸篓列表 |
| POST | `/session-desk/api/restore` | `{ trashId }`（即 `.trash` 下那一层目录名 `<deletedAt-iso>-<shortId>`） |
| POST | `/session-desk/api/purge` | `{ trashId }` 或 `{ all: true }` |

client 只通过这些路由动盘，不在浏览器里拼绝对路径去删。

**数据流**

```
用户点删除
  → POST /trash
  → 若当前会话则先 open/create 其它
  → rename live 目录 → .trash/<deletedAt>/<project>/<sessionId>
  → 写 manifest.json
  → 本插件「会话」栏立刻去掉该行
  → DSH 原生侧栏可能仍显示到刷新（见 §4.3 / §11）

小时任务 + 插件启动各跑一轮
  → 扫 .trash/*/manifest.json
  → deletedAt + retentionDays 到期 → rm -rf

小地图 / 看板
  → 只读当前会话 chat 快照 + list.projectionValues
  → 无额外 RPC（看板工作区汇总除外：只用 list 已有投影）

小宠物
  → sessions.list 订阅
```

---

## 4. 存储

### 4.1 sessionsRoot

```
resolveSessionsRoot():
  1. settings.sessionsRoot 非空 → 展开前导 ~ 后必须是绝对路径，否则保存时拒绝并沿用上一档
  2. process.env.DSH_SESSIONS_ROOT 非空 → 用它
  3. process.env.DSH_HOME 非空 → join(DSH_HOME, 'sessions')
  4. join(homedir(), '.dsh', 'sessions')

定位一条 live 会话目录：cwd（来自 sessions.list）→ projectKey(cwd) + encodeSessionSegment(sessionId)。
无 cwd 的会话落在 `_no-cwd/`，与 review-disk 相同。
```

`projectKey` / `encodeSessionSegment` 与 `DSH-better-sidebar/src/review/review-disk.ts` **逐字相同**（复制函数并单测对齐），保证目录对得上 local-history / review.json。

### 4.2 废纸篓布局

```
<sessionsRoot>/
  <projectKey>/<sessionId>/          live
  .trash/
    <deletedAt-iso>-<shortId>/
      manifest.json
      <projectKey>/<sessionId>/      原目录整棵
```

`deletedAt-iso` 用 UTC `YYYYMMDDTHHMMSS`，`shortId` 取 sessionId 末 6 个安全字符，避免同一秒删两条撞名。  
`trashId` = 这一层目录名 `<deletedAt-iso>-<shortId>`，还原 / 永久删除都用它，不用 sessionId（同一会话可能进废纸篓多次的历史不存在：live 只剩一份，删走就没有第二条）。

`manifest.json`：

```json
{
  "version": 1,
  "sessionId": "...",
  "cwd": "/abs/or/empty",
  "title": "...",
  "deletedAt": 1720000000000,
  "originalPath": "/abs/sessions/project/session",
  "bytes": 12345
}
```

废纸篓始终放在**当前解析出的** `sessionsRoot/.trash`。用户改 `sessionsRoot` 后，新删除进新根；旧根 `.trash` 不再自动扫（设置里提示「更换根目录不会带走旧废纸篓」）。小时任务只扫当前根。

### 4.3 还原与 DSH 索引

公开 API 目前只有 `sessions.list` / `open` / `create`，没有 delete / unregister。

- **删除**：搬家后，若 host 上 `ctx.sessions` 有可调用的卸载方法（启动时探测函数名，白名单：`forget` / `unload` / `remove` / `unregister`，且参数能对上 sessionId），则调用；否则只搬家，用户刷新页面后列表与磁盘一致。
- **还原**：搬回后同样探测是否有 `reindex` / `reload`；没有则 UI 提示「已还原，刷新页面后出现在列表」。不猜测未导出的内部 API，不改 harness。

禁止在探测失败时用「读 jsonl 再伪造 session 对象」塞回内存。

---

## 5. 设置契约

Host 用 `settingsNamespace('session-desk')` 注册。Client `settings.section` id `session-desk`，label「会话管理」，order `30`。

| 键 | 类型 | 默认 | 钳制 |
|---|---|---|---|
| `sessionsRoot` | string | `''` | 空 = 走 env/home |
| `retentionDays` | number | `30` | 1–365 整数 |
| `historyPosition` | `'off' \| 'left' \| 'right'` | `'right'` | |
| `historyLimit` | number | `10` | 0–120 整数 |
| `boardTab` | boolean | `true` | |
| `petEnabled` | boolean | `true` | |
| `petImage` | string | `''` | 空 = 内置鲸鱼；非空走 URL 白名单 |
| `petX` | number | `-1` | `-1` = 用默认右下；否则 CSS 左 |
| `petY` | number | `-1` | `-1` = 用默认右下；否则 CSS 上 |
| `pinnedTurns` | `Record<sessionId, number[]>` | `{}` | |
| 外观字段 | 同 ui-custom ThemeSection | 中性默认 | 见 §6 |

外观字段放在同一 namespace，键名与迁入代码一致（`wallpaper`、`glass`、`accent`…），避免再映射一层。

---

## 6. 外观迁入与代码审查

从 `/tmp` 对照的 [yoli-mi/dsh-client-ui-custom](https://github.com/yoli-mi/dsh-client-ui-custom) 复制这些文件的逻辑（实施时对照当时 main，不钉死某一 commit）：

- `src/client/config.ts`、`presets.ts`、`apply.ts`、`color.ts`、`theme-section.ts`
- `src/client/appearance/*`、`custom.module.css`

**必须改**

1. CSS 变量 `--dsu-*` → `--dsd-*`；gate `html[data-dsd-active]`；style 标签 id `dsh-session-desk-css`。
2. settings namespace 已是 `session-desk`，不要再注册 `ui-custom`。
3. 去掉 features 白名单、marketplace、shortcuts、markdown、usage 的全部入口。

**安全审查（抄的时候一并修，不是事后补丁）**

| 点 | 原行为 | 本插件 |
|---|---|---|
| `customCss` | 原样写入 `<style>` | 最长 32KB；删除 `</style>`、`<script`、`expression(`、`-moz-binding`（大小写不敏感）后再写入 |
| `customVars` | 任意键写到 html | 键必须 `/^--[a-zA-Z][\w-]*$/`，否则丢弃 |
| 壁纸 / `petImage` | 任意字符串进 `url("…")` | 只允许 `http:` / `https:` / `data:image/` / 以 `/` 开头的同源相对路径；禁止 `javascript:`、`data:text` |
| `escapeUrl` | 只转义 `"` | 保留，并拒绝含换行 / 未转义 `)` 的值 |
| 自动取色 | `crossOrigin=anonymous` canvas | 保持；失败则静默不用自动强调色 |

预设六套（ink-teal 等）一并迁入。用户「另存为我的预设」仍用 `myPresets` 字典。

---

## 7. Client 槽位

| 槽 | id | 条件 |
|---|---|---|
| `settings.section` | `session-desk` | 始终 |
| `details` | （小地图） | `historyPosition !== 'off'` |
| `conversation.chat.assistant-actions` | `session-desk-pin` | 小地图开启 |
| `conversation.view` | `session-desk-board` | `boardTab` |
| `shell.overlay` | `session-desk-pet` | `petEnabled` |
| `shell.overlay` | `session-desk-preview` | 外观预览时（抄 PreviewBar） |

文案中英双语，跟其它本仓库插件一样 `locale.register`。

---

## 8. 错误处理

- 删除 / 还原 / 清空失败：API 返回 `{ ok: false, error }`，设置页 toast，不抛到控制台当成功。
- 会话目录找不到：删除接口 404，提示「磁盘上已不在，刷新列表」。
- 跨盘 `rename` 失败：改为 copy + rm，copy 失败则不删源。
- 小时回收单个条目失败：记一条 host 日志，继续下一条，不中断整轮。
- 看板缺 `projectionValues`：该块显示「暂无统计」，不显示 0 装成有数据。
- 小宠物订阅失败：隐藏宠物，不挡对话。

---

## 9. 测试

| 层 | 覆盖 |
|---|---|
| `sessions-root.ts` | 四级解析优先级；空字符串不算覆盖 |
| `encodeSessionSegment` / `projectKey` | 与 review-disk 向量对齐 |
| trash | 搬家、还原到原路径、目标冲突加后缀、到期删除、不清其它 project |
| classify | 每个桶至少一条工具名；未知 → 其它 |
| 模型调用聚合 | 中位用真实步骤样本；无步骤时不拿 llmMs 除次数；TTFT 全缺则隐藏；工具时长不计入 |
| URL / CSS 审查 | 拒绝 javascript:、超长 CSS、非法 customVars |
| history turns | `buildTurns`、limit+pin 合并、硬顶 120 |
| client 注册 | `boardTab` / `historyPosition` / `petEnabled` 关则对应槽不注册 |

不做改 harness 的 e2e。有 `dsh` CLI 时再加可选 mount 烟测，不作为本 spec 门禁。

---

## 10. 实施顺序（写入计划时拆任务，不在本文件展开）

1. 包骨架 + settings namespace + sessionsRoot  
2. trash host API + 设置页会话 / 废纸篓栏  
3. 小地图两态  
4. 看板 Tab + classify  
5. 外观迁入 + 审查  
6. 小宠物  

每一项可独立验证后再做下一项。用户要求五块都做，不砍范围。

---

## 11. 风险（能力上限）

DSH 没有公开 delete。侧栏在搬家后、刷新前可能仍显示已删会话。这是接受的行为，UI 文案写「若仍出现在侧栏，刷新页面」。不为此改 harness。
