/**
 * Conversation-header 看板 tab: model-call timings, turn/session stats,
 * tokens and tool-call classification. Workspace mode sums list projections.
 * Turn mode folds one engine turn into phase + per-tool totals.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BUCKET_ORDER, classifyTool, collectToolStats, type ToolBucket, type ToolBucketRow } from '../../board/classify.ts'
import {
  aggregateModelCalls,
  collectModelSamples,
  type ModelStatsRow,
} from '../../board/model-stats.ts'
import { indexTurnSummaries, type TurnSummary, type TurnToolRow } from '../../board/turn-summary.ts'
import {
  readTokenUsage,
  sumSessionStats,
  sumTokenUsage,
  type SessionStats,
  type TokenUsage,
  type WorkspacePeer,
} from '../../board/workspace-stats.ts'
import { MAX_STRIP_TURNS } from '../../history/turns.ts'
import { adoptBoardStyles } from './board-styles.ts'
import { ModelBars, PerTurnCallsChart, PhaseBar, TokenDonut, TurnTimingChart } from './charts.tsx'

type BoardMode = 'session' | 'workspace' | 'turn'

interface ProjectionValues {
  sessionStats?: SessionStats
  tokenUsage?: TokenUsage
}

interface SessionRow extends WorkspacePeer {
  id: string
  cwd?: string
  projectionValues?: ProjectionValues
}

interface SessionsSnapshot {
  current?: string
  byId?: Record<string, SessionRow>
}

interface ChatLike {
  order?: readonly string[]
  nodes?: unknown
  legacy?: {
    turnTimings?: Map<number, { startTime?: number; endTime?: number; ttftMs?: number; ttft?: number }>
    nodes?: unknown
  }
}

interface SessionSlice {
  chat?: ChatLike
  turnTimings?: Map<number, { startTime?: number; endTime?: number; ttftMs?: number; ttft?: number }>
  projectionValues?: ProjectionValues
}

export interface BoardViewProps {
  sessionId?: string
  t?: (key: string, vars?: Record<string, string | number>) => string
  useSession?: <T>(select: (snapshot: SessionSlice) => T) => T
  useSessions?: <T>(select: (snapshot: SessionsSnapshot) => T) => T
  useProjection?: (key: string) => unknown
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—'
  const s = ms / 1e3
  if (s < 1) return `${Math.round(s * 100) / 100}s`
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

function toolNameLabel(name: string, t: BoardViewProps['t']): string {
  const key = `board.toolName.${name}`
  const mapped = t?.(key)
  if (mapped !== undefined && mapped !== key) return mapped
  return t?.(`board.bucket.${classifyTool(name)}`) ?? name
}

function formatTokens(n: number | undefined): string {
  if (n === undefined) return '—'
  const scaled = (v: number) => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1e3) return String(n)
  if (n < 1e6) return `${scaled(n / 1e3)}K`
  return `${scaled(n / 1e6)}M`
}

function collectTurnTimings(chat: ChatLike | undefined, top: SessionSlice['turnTimings']): Array<{
  turn: number
  wallMs?: number
  ttftMs?: number
}> {
  const source = chat?.legacy?.turnTimings ?? top
  if (!(source instanceof Map) && (source === undefined || typeof source !== 'object')) return []
  const entries: Array<[number, { startTime?: number; endTime?: number; ttftMs?: number; ttft?: number }]> =
    source instanceof Map
      ? [...source.entries()]
      : Object.entries(source as Record<string, { startTime?: number; endTime?: number; ttftMs?: number; ttft?: number }>)
        .map(([key, value]) => [Number(key), value])
  return entries
    .filter(([turn]) => Number.isFinite(turn))
    .sort((a, b) => a[0] - b[0])
    .map(([turn, timing]) => {
      const start = asNumber(timing.startTime)
      const end = asNumber(timing.endTime)
      const wallMs = start !== undefined && end !== undefined ? Math.max(0, end - start) : undefined
      const ttftMs = asNumber(timing.ttftMs) ?? asNumber(timing.ttft)
      return { turn, wallMs, ttftMs }
    })
}

function sameCwdPeers(list: SessionsSnapshot, sessionId: string): SessionRow[] {
  const byId = list.byId ?? {}
  const self = byId[sessionId]
  const cwd = self?.cwd
  const rows = Object.values(byId)
  if (cwd === undefined) return self === undefined ? [] : [self]
  return rows.filter(row => row.cwd === cwd)
}

function totalOf(stats: SessionStats | undefined): number | undefined {
  const llm = stats?.llmMs
  const tool = stats?.toolMs
  if (llm === undefined && tool === undefined) return undefined
  return (llm ?? 0) + (tool ?? 0)
}

function StatRow(props: { label: string; value: string }): ReactNode {
  return (
    <div className="dsd-board__row">
      <span>{props.label}</span>
      <span>{props.value}</span>
    </div>
  )
}

function Empty(props: { t?: BoardViewProps['t'] }): ReactNode {
  return <p className="dsd-board__empty">{props.t?.('board.empty') ?? '暂无统计'}</p>
}

function StatCard(props: { label: string; value: string }): ReactNode {
  return (
    <div className="dsd-board__card">
      <span className="dsd-board__card-label">{props.label}</span>
      <span className="dsd-board__card-value">{props.value}</span>
    </div>
  )
}

function Section(props: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="dsd-board__section">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  )
}

function bucketsFromTools(tools: readonly TurnToolRow[]): ToolBucketRow[] {
  const totals = new Map<ToolBucket, { count: number; totalMs: number; timed: boolean }>()
  for (const tool of tools) {
    const bucket = classifyTool(tool.name)
    const row = totals.get(bucket) ?? { count: 0, totalMs: 0, timed: false }
    row.count += tool.count
    if (tool.totalMs !== undefined) {
      row.totalMs += tool.totalMs
      row.timed = true
    }
    totals.set(bucket, row)
  }
  const rows: ToolBucketRow[] = []
  for (const bucket of BUCKET_ORDER) {
    const row = totals.get(bucket)
    if (row === undefined) continue
    rows.push(row.timed ? { bucket, count: row.count, totalMs: row.totalMs } : { bucket, count: row.count })
  }
  return rows
}

function TurnStrip(props: {
  turns: readonly number[]
  questions: ReadonlyMap<number, string>
  selected: number | undefined
  onSelect: (turn: number) => void
  t?: BoardViewProps['t']
}): ReactNode {
  const selectedRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [props.selected, props.turns])
  if (props.turns.length === 0) return <Empty t={props.t} />
  const question = (props.selected === undefined ? undefined : props.questions.get(props.selected))
    || (props.t?.('history.noText') ?? '')
  return (
    <div className="dsd-board__map">
      <div className="dsd-board__map-strip" role="listbox" aria-label={props.t?.('board.pickTurn') ?? '选择回合'}>
        {props.turns.map(turn => {
          const preview = props.questions.get(turn)
          const selected = turn === props.selected
          return (
            <button
              key={turn}
              ref={selected ? selectedRef : undefined}
              type="button"
              className="dsd-board__map-btn"
              role="option"
              aria-selected={selected}
              title={preview || `T${turn}`}
              onClick={() => props.onSelect(turn)}
            >
              <span className="dsd-board__dash" />
            </button>
          )
        })}
      </div>
      <div className="dsd-board__map-caption">
        {props.selected === undefined
          ? (props.t?.('board.noTurn') ?? '暂无回合')
          : `T${props.selected} · ${question}`}
      </div>
    </div>
  )
}

function TurnPanel(props: {
  summary: TurnSummary | undefined
  turns: readonly number[]
  questions: ReadonlyMap<number, string>
  selected: number | undefined
  onSelect: (turn: number) => void
  t?: BoardViewProps['t']
}): ReactNode {
  const t = props.t
  const row = props.summary
  const buckets = row === undefined ? [] : bucketsFromTools(row.tools)
  const bucketLabel = (bucket: ToolBucket): string => t?.(`board.bucket.${bucket}`) ?? bucket
  const phases = row === undefined ? [] : [
    row.planMs === undefined ? undefined : { key: 'plan', label: t?.('board.phase.plan') ?? '分析任务', ms: row.planMs, color: 'var(--dsw-alias-info, #0ea5e9)' },
    row.reasonMs === undefined ? undefined : { key: 'reason', label: t?.('board.phase.reason') ?? '推理与规划', ms: row.reasonMs, color: 'var(--dsw-alias-warning, #f59e0b)' },
    row.toolMs === undefined ? undefined : { key: 'tool', label: t?.('board.phase.tool') ?? '调用', ms: row.toolMs, color: 'var(--dsw-alias-brand-primary, #4176e6)' },
    row.answerMs === undefined ? undefined : { key: 'answer', label: t?.('board.phase.answer') ?? '组织回答', ms: row.answerMs, color: 'var(--dsw-alias-brand-secondary, #22c55e)' },
  ].filter((seg): seg is { key: string; label: string; ms: number; color: string } => seg !== undefined)
  return (
    <>
      <TurnStrip turns={props.turns} questions={props.questions} selected={props.selected} onSelect={props.onSelect} t={t} />
      {row === undefined ? <Empty t={t} /> : (
        <>
          <div className="dsd-board__cards">
            <StatCard label={t?.('board.wall') ?? '墙钟'} value={formatDuration(row.wallMs)} />
            <StatCard label={t?.('board.llm') ?? '模型耗时'} value={formatDuration(row.modelMs)} />
            <StatCard label={t?.('board.tool') ?? '工具耗时'} value={formatDuration(row.toolMs)} />
            <StatCard label={t?.('board.toolCount') ?? '调用次数'} value={String(row.toolCount)} />
          </div>
          <Section title={t?.('board.phase') ?? '阶段耗时'}>
            {phases.length === 0 ? <Empty t={t} /> : <PhaseBar segments={phases} />}
          </Section>
          <Section title={t?.('board.calls') ?? '调用汇总'}>
            {row.tools.length === 0 ? <Empty t={t} /> : (
              <ModelBars
                barBy="duration"
                rows={row.tools.map(tool => ({ label: toolNameLabel(tool.name, t), count: tool.count, totalMs: tool.totalMs }))}
              />
            )}
          </Section>
          <Section title={t?.('board.classify') ?? '调用分类'}>
            {buckets.length === 0 ? <Empty t={t} /> : (
              <ModelBars
                barBy="count"
                rows={buckets.map(item => ({ label: bucketLabel(item.bucket), count: item.count, totalMs: item.totalMs }))}
              />
            )}
          </Section>
        </>
      )}
    </>
  )
}

export function BoardView(props: BoardViewProps): ReactNode {
  adoptBoardStyles()
  const [mode, setMode] = useState<BoardMode>('session')
  const [pickedTurn, setPickedTurn] = useState<number | undefined>(undefined)
  const t = props.t
  const sessionId = props.sessionId ?? ''
  const chat = props.useSession ? props.useSession(s => s.chat) : undefined
  const topTimings = props.useSession ? props.useSession(s => s.turnTimings) : undefined
  const sessionProjected = props.useSession ? props.useSession(s => s.projectionValues) : undefined
  const list = props.useSessions ? props.useSessions(s => s) : { byId: {} as Record<string, SessionRow> }
  const self = list.byId?.[sessionId]
  const peers = useMemo(() => sameCwdPeers(list, sessionId), [list, sessionId])
  const liveStats = (props.useProjection?.('sessionStats') as SessionStats | undefined)
    ?? sessionProjected?.sessionStats
    ?? self?.projectionValues?.sessionStats
  const liveTokens = readTokenUsage(
    (props.useProjection?.('tokenUsage') as TokenUsage | undefined)
    ?? sessionProjected?.tokenUsage
    ?? self?.projectionValues?.tokenUsage,
  )
  const sessionStats = liveStats
  const tokenUsage = liveTokens
  const turnMode = mode === 'turn'

  const samples = useMemo(() => (turnMode ? [] : collectModelSamples(chat)), [chat, turnMode])
  const sessionModel = useMemo(
    () => aggregateModelCalls(samples, sessionStats?.llmMs),
    [samples, sessionStats?.llmMs],
  )
  const workspaceStats = useMemo(() => (turnMode ? undefined : sumSessionStats(peers)), [peers, turnMode])
  const workspaceTokens = useMemo(() => (turnMode ? undefined : sumTokenUsage(peers)), [peers, turnMode])
  const workspaceModel: { all: ModelStatsRow; byModel: ModelStatsRow[]; missing: boolean } = useMemo(() => {
    if (turnMode) {
      return { missing: true, byModel: [], all: { label: 'all', count: 0, fallbackSessionTotal: true } }
    }
    const llm = peers
      .map(row => row.projectionValues?.sessionStats?.llmMs)
      .filter((value): value is number => value !== undefined)
    if (llm.length === 0) {
      return {
        missing: true,
        byModel: [],
        all: { label: 'all', count: peers.length, fallbackSessionTotal: true },
      }
    }
    return {
      missing: false,
      byModel: [],
      all: {
        label: 'all',
        count: peers.length,
        totalMs: llm.reduce((sum, value) => sum + value, 0),
        fallbackSessionTotal: true,
      },
    }
  }, [peers, turnMode])

  const turns = useMemo(() => (turnMode ? [] : collectTurnTimings(chat, topTimings)), [chat, topTimings, turnMode])
  const buckets = useMemo(() => (turnMode ? [] : collectToolStats(chat)), [chat, turnMode])
  const turnIndex = useMemo(
    () => (turnMode ? indexTurnSummaries(chat, topTimings) : new Map<number, TurnSummary>()),
    [chat, topTimings, turnMode],
  )
  const stripTurns = useMemo(() => {
    if (!turnMode) return [] as number[]
    return [...turnIndex.keys()].sort((a, b) => a - b).slice(-MAX_STRIP_TURNS)
  }, [turnIndex, turnMode])
  const stripQuestions = useMemo(() => {
    const questions = new Map<number, string>()
    if (!turnMode) return questions
    for (const [turn, row] of turnIndex) {
      if (row.question !== undefined && row.question !== '') questions.set(turn, row.question)
    }
    return questions
  }, [turnIndex, turnMode])
  const newest = stripTurns.length === 0 ? undefined : stripTurns[stripTurns.length - 1]
  const selectedTurn = pickedTurn !== undefined && stripTurns.includes(pickedTurn) ? pickedTurn : newest
  const workspace = mode === 'workspace'
  const modelRow = workspace ? workspaceModel.all : sessionModel.all
  const modelBy = workspace ? [] : sessionModel.byModel
  const modelMissing = workspace
    ? workspaceModel.missing
    : samples.length === 0 && sessionStats?.llmMs === undefined
  const shownStats = workspace ? workspaceStats : sessionStats
  const shownTokens = workspace ? workspaceTokens : tokenUsage

  const bucketLabel = (bucket: ToolBucket): string => t?.(`board.bucket.${bucket}`) ?? bucket

  return (
    <div className="dsd-board">
      <div className="dsd-board__toggle" role="group" aria-label={t?.('board.label') ?? '看板'}>
        <button type="button" aria-pressed={mode === 'session'} onClick={() => setMode('session')}>
          {t?.('board.session') ?? '本会话'}
        </button>
        <button type="button" aria-pressed={mode === 'workspace'} onClick={() => setMode('workspace')}>
          {t?.('board.workspace') ?? '本工作区'}
        </button>
        <button type="button" aria-pressed={mode === 'turn'} onClick={() => setMode('turn')}>
          {t?.('board.turn') ?? '回合'}
        </button>
      </div>

      {turnMode ? (
        <TurnPanel
          summary={selectedTurn === undefined ? undefined : turnIndex.get(selectedTurn)}
          turns={stripTurns}
          questions={stripQuestions}
          selected={selectedTurn}
          onSelect={setPickedTurn}
          t={t}
        />
      ) : (
      <>
      <div className="dsd-board__cards">
        <StatCard
          label={t?.('board.llm') ?? '模型耗时'}
          value={shownStats?.llmMs === undefined ? '—' : formatDuration(shownStats.llmMs)}
        />
        <StatCard
          label={t?.('board.tool') ?? '工具耗时'}
          value={shownStats?.toolMs === undefined ? '—' : formatDuration(shownStats.toolMs)}
        />
        <StatCard
          label={t?.('board.totalTime') ?? '总耗时'}
          value={totalOf(shownStats) === undefined ? '—' : formatDuration(totalOf(shownStats))}
        />
        <StatCard
          label={t?.('board.turnsCount') ?? '回合'}
          value={shownStats?.turns === undefined ? '—' : String(shownStats.turns)}
        />
        {workspace ? (
          <StatCard
            label={t?.('board.sessions') ?? '会话数'}
            value={String(modelRow.count)}
          />
        ) : (
          <StatCard
            label={t?.('board.steps') ?? '步骤'}
            value={shownStats?.steps === undefined ? '—' : String(shownStats.steps)}
          />
        )}
      </div>

      <Section title={t?.('board.model') ?? '模型调用'}>
        {modelMissing ? <Empty t={t} /> : (
          <div className="dsd-board__rows">
            {workspace ? (
              <ModelBars
                barBy="duration"
                rows={[{ label: t?.('board.total') ?? '合计', count: modelRow.count, totalMs: modelRow.totalMs }]}
              />
            ) : (
              <>
                <PerTurnCallsChart samples={samples} />
                <ModelBars rows={modelBy.map(model => ({ label: model.label, count: model.count, totalMs: model.totalMs }))} />
              </>
            )}
            {modelRow.fallbackSessionTotal ? (
              <p className="dsd-board__note">{t?.('board.fallbackTotal') ?? '仅会话合计'}</p>
            ) : null}
            {workspace ? null : (
              <>
                <StatRow
                  label={t?.('board.count') ?? '调用次数'}
                  value={String(modelRow.count)}
                />
                <StatRow
                  label={t?.('board.median') ?? '中位'}
                  value={modelRow.medianMs === undefined ? '—' : formatDuration(modelRow.medianMs)}
                />
                <StatRow
                  label={t?.('board.max') ?? '最长'}
                  value={modelRow.maxMs === undefined ? '—' : formatDuration(modelRow.maxMs)}
                />
                {modelRow.medianTtftMs === undefined ? null : (
                  <StatRow
                    label={t?.('board.ttft') ?? 'TTFT 中位'}
                    value={formatDuration(modelRow.medianTtftMs)}
                  />
                )}
              </>
            )}
          </div>
        )}
      </Section>

      {workspace ? null : (
        <Section title={t?.('board.turns') ?? '对话级耗时'}>
          {turns.length === 0 ? <Empty t={t} /> : (
            <div className="dsd-board__rows">
              <TurnTimingChart points={turns} />
            </div>
          )}
        </Section>
      )}

      <Section title={t?.('board.tokens') ?? 'Token'}>
        {shownTokens === undefined ? <Empty t={t} /> : (
          <div className="dsd-board__rows">
            <TokenDonut buckets={shownTokens} />
            <StatRow
              label={t?.('board.token.input') ?? '输入'}
              value={shownTokens.input === undefined ? '—' : formatTokens(shownTokens.input)}
            />
            <StatRow
              label={t?.('board.token.output') ?? '输出'}
              value={shownTokens.output === undefined ? '—' : formatTokens(shownTokens.output)}
            />
            <StatRow
              label={t?.('board.token.cacheRead') ?? '缓存读'}
              value={shownTokens.cacheRead === undefined ? '—' : formatTokens(shownTokens.cacheRead)}
            />
            <StatRow
              label={t?.('board.token.cacheWrite') ?? '缓存写'}
              value={shownTokens.cacheWrite === undefined ? '—' : formatTokens(shownTokens.cacheWrite)}
            />
          </div>
        )}
      </Section>

      {workspace ? null : (
        <Section title={t?.('board.classify') ?? '调用分类'}>
          {buckets.length === 0 ? <Empty t={t} /> : (
            <div className="dsd-board__rows">
              <ModelBars
                barBy="count"
                rows={buckets.map(row => ({ label: bucketLabel(row.bucket), count: row.count, totalMs: row.totalMs }))}
              />
            </div>
          )}
        </Section>
      )}
      </>
      )}
    </div>
  )
}
