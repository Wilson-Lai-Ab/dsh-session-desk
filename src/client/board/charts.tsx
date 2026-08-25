/**
 * Hand-rolled chart components for the board tab: dependency-free div bars and
 * a `conic-gradient` donut, themed via DSW alias CSS variables.
 */
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

function fmtMs(ms: number): string {
  const s = ms / 1e3
  if (s < 1) return `${Math.round(s * 100) / 100}s`
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** Vertical bars: one per turn, height = calls for that turn. */
export function PerTurnCallsChart({ samples }: { samples: readonly ModelCallSample[] }): ReactNode {
  const points = perTurnCallCounts(samples)
  if (points.length === 0) return null
  const max = Math.max(...points.map(p => p.calls), 1)
  return (
    <div className="dsd-chart dsd-chart--cols" role="img" aria-label="model calls per turn">
      {points.map(p => (
        <div key={p.turn} className="dsd-chart__col" title={`回合 ${p.turn} · ${p.calls} 次`}>
          <div className="dsd-chart__col-bar" style={{ height: `${Math.max(4, Math.round((p.calls / max) * 100))}%` }} />
          <span className="dsd-chart__col-x">{p.turn}</span>
        </div>
      ))}
    </div>
  )
}

export interface BarRow {
  label: string
  count: number
  totalMs?: number
}

/**
 * Horizontal bars. `barBy="duration"` (default) sizes by `totalMs ?? count`;
 * `barBy="count"` sizes by `count`. The tail always reads `count × duration`.
 */
export function ModelBars({ rows, barBy = 'duration' }: {
  rows: readonly BarRow[]
  barBy?: 'count' | 'duration'
}): ReactNode {
  if (rows.length === 0) return null
  const metric = (row: BarRow): number => (barBy === 'count' ? row.count : row.totalMs ?? row.count)
  const max = Math.max(...rows.map(metric), 1)
  return (
    <div className="dsd-chart dsd-chart--bars" role="img" aria-label="bars">
      {rows.map(row => (
        <div key={row.label} className="dsd-chart__bar-row">
          <span className="dsd-chart__bar-label">{row.label}</span>
          <div className="dsd-chart__bar-track">
            <div className="dsd-chart__bar-fill" style={{ width: `${Math.max(2, Math.round((metric(row) / max) * 100))}%` }} />
          </div>
          <span className="dsd-chart__bar-value">
            {row.count} × {row.totalMs === undefined ? '—' : fmtMs(row.totalMs)}
          </span>
        </div>
      ))}
    </div>
  )
}

export interface TurnTimingPoint {
  turn: number
  wallMs?: number
  ttftMs?: number
}

/** Vertical wall-clock bars with an optional TTFT tick under each bar top. */
export function TurnTimingChart({ points }: { points: readonly TurnTimingPoint[] }): ReactNode {
  const withWall = points.filter(p => p.wallMs !== undefined)
  if (withWall.length === 0) return null
  const max = Math.max(...withWall.map(p => p.wallMs ?? 0), 1)
  return (
    <div className="dsd-chart dsd-chart--cols" role="img" aria-label="turn wall clock">
      {withWall.map(p => {
        const wall = p.wallMs ?? 0
        const wallPct = Math.max(4, Math.round((wall / max) * 100))
        const ttftPct = p.ttftMs === undefined ? undefined : Math.max(4, Math.round((p.ttftMs / max) * 100))
        const title = `回合 ${p.turn} · 墙钟 ${fmtMs(wall)}${p.ttftMs === undefined ? '' : ` · TTFT ${fmtMs(p.ttftMs)}`}`
        return (
          <div key={p.turn} className="dsd-chart__col" title={title}>
            <div className="dsd-chart__col-bar" style={{ height: `${wallPct}%` }} />
            {ttftPct !== undefined && (
              <div className="dsd-chart__col-ttft" style={{ bottom: `${ttftPct}%` }} />
            )}
            <span className="dsd-chart__col-x">{p.turn}</span>
          </div>
        )
      })}
    </div>
  )
}

export interface PhaseSegment {
  key: string
  label: string
  ms: number
  color: string
}

/** Stacked phase bar. Segments with no duration are omitted; never 0-fills. */
export function PhaseBar({ segments }: { segments: readonly PhaseSegment[] }): ReactNode {
  const present = segments.filter(s => s.ms > 0)
  if (present.length === 0) return null
  return (
    <>
      <div className="dsd-chart__phase" role="img" aria-label="phase mix">
        {present.map(s => (
          <div
            key={s.key}
            className="dsd-chart__phase-seg"
            style={{ flexGrow: s.ms, background: s.color }}
            title={`${s.label} ${fmtMs(s.ms)}`}
          />
        ))}
      </div>
      <div className="dsd-chart__legend">
        {present.map(s => (
          <span key={s.key} className="dsd-chart__legend-item">
            <i style={{ background: s.color }} />{s.label} {fmtMs(s.ms)}
          </span>
        ))}
      </div>
    </>
  )
}

/** `conic-gradient` donut over token buckets with a centered total and legend. */
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
  const label = total >= 1000 ? `${Math.round(total / 1000)}K` : String(total)
  return (
    <div className="dsd-chart__donut-wrap">
      <div className="dsd-chart__donut" style={{ background: `conic-gradient(${stops})` }} role="img" aria-label="token composition">
        <span className="dsd-chart__donut-center">{label}</span>
      </div>
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
