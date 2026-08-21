/**
  * Pure control helpers for the conversation minimap: which slots to occupy,
  * and when the auto-loadOlder pager may take another batch.
  */
import type { HistoryPosition } from '../shared.ts'

/** Max older-history batches auto-loaded per pager identity. */
export const MAX_LOAD_OLDER_BATCHES = 24

/** Delay between full-history pager batches (ms). */
export const LOAD_OLDER_THROTTLE_MS = 300

/** Details + pin slots are occupied only while the strip is docked. */
export function historySlotsActive(position: HistoryPosition | undefined): boolean {
  return position === 'left' || position === 'right'
}

/**
 * Persist-hydrated snapshots often omit `historyPosition` (schema default lives
 * on the host). Treat missing as the product default `right` so the strip
 * occupies before the first settings round-trip.
 */
export function historyPositionOf(position: HistoryPosition | undefined): HistoryPosition {
  return position === 'left' || position === 'right' || position === 'off' ? position : 'right'
}

/** Occupancy gate: missing snapshot field still docks on the right. */
export function historySlotsWanted(position: HistoryPosition | undefined): boolean {
  return historySlotsActive(historyPositionOf(position))
}

/** Identity of one auto-pager run. Changing it resets the batch budget. */
export function pagerIdentity(sessionId: string, position: string, limit: number): string {
  return `${sessionId}\0${position}\0${limit}`
}

export interface LoadOlderBatchState {
  identity: string
  loaded: number
}

/** Reset loadedBatches when session / position / limit change. */
export function resetBatchesIfIdentityChanged(
  state: LoadOlderBatchState,
  nextIdentity: string,
): LoadOlderBatchState {
  if (state.identity === nextIdentity) return state
  return { identity: nextIdentity, loaded: 0 }
}

/** Whether another loadOlder batch is still allowed under the hard cap. */
export function canTakeLoadOlderBatch(loaded: number): boolean {
  return loaded < MAX_LOAD_OLDER_BATCHES
}

/** Conversation-column box used to dock the floating strip. */
export interface ConversationBox {
  left: number
  right: number
}

/** Gap from the conversation column's inner edge. */
export const CONVERSATION_EDGE_MARGIN = 8

/**
 * Viewport `left`/`right` so a body-portaled strip sits on the conversation
 * column, not the window or the details workbench.
 */
export function conversationEdgeStyle(
  side: 'left' | 'right',
  box: ConversationBox,
  viewportWidth: number,
  margin = CONVERSATION_EDGE_MARGIN,
): { left: number } | { right: number } {
  if (side === 'left') {
    return { left: Math.max(0, box.left + margin) }
  }
  return { right: Math.max(0, viewportWidth - box.right + margin) }
}
