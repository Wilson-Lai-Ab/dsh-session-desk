/**
 * Recognize the host workspace's session drag signal so the trash target can
 * appear for "throw a session away" drags without firing on plain text or
 * file drags. The host sets `effectAllowed = "move"` and a text/plain payload
 * carrying the session id (see dsh-client-ui-workspace row onDragStart).
 *
 * IMPORTANT (event order): the host's row `onDragStart` populates the
 * DataTransfer, so the drag must be observed AFTER that handler runs — i.e.
 * with a BUBBLE-phase listener at document level. A document-CAPTURE listener
 * fires before the row handler and sees an uninitialized DataTransfer
 * (effectAllowed "uninitialized", no types), so the drag is never recognized
 * and the trash target never flies in. Verified empirically with a real
 * native drag in Chrome:
 *   [document CAPTURE] effectAllowed="uninitialized" types=[] isSessionDrag=false
 *   [document BUBBLE ] effectAllowed="move" types=["text/plain"] isSessionDrag=true
 */

export interface DragMeta {
  effectAllowed?: string
  types?: readonly string[]
}

export function isSessionDrag(meta: DragMeta | null | undefined): boolean {
  if (meta === null || meta === undefined) return false
  return meta.effectAllowed === 'move' && (meta.types?.includes('text/plain') ?? false)
}

export interface DragWatchers {
  onDragStart: (event: DragEvent) => void
  onDragEnd: (event: DragEvent) => void
}

/**
 * Register document-level drag watchers for the session-drag signal and return
 * a disposer. `dragstart` is registered in the BUBBLE phase (no capture) — see
 * the ordering note above; `dragend` stays in the capture phase (it only reads
 * local state, not the DataTransfer).
 */
export function registerSessionDragWatchers(watchers: DragWatchers): () => void {
  document.addEventListener('dragstart', watchers.onDragStart)
  document.addEventListener('dragend', watchers.onDragEnd, true)
  return () => {
    document.removeEventListener('dragstart', watchers.onDragStart)
    document.removeEventListener('dragend', watchers.onDragEnd, true)
  }
}
