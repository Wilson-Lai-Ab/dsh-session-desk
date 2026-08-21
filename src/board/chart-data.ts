/**
 * Pure chart-data helpers for the board tab (no DOM, no React). Kept beside
 * the other board stat modules so they stay unit-testable without a renderer.
 */

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

const TOKEN_ORDER: readonly TokenSegmentKey[] = ['input', 'output', 'cacheRead', 'cacheWrite']

/** Non-zero token buckets in fixed display order. */
export function tokenSegments(buckets: BoardTokenBuckets | undefined): TokenSegment[] {
  if (buckets === undefined) return []
  return TOKEN_ORDER
    .map(key => ({ key, value: buckets[key] ?? 0 }))
    .filter(segment => segment.value > 0)
}
