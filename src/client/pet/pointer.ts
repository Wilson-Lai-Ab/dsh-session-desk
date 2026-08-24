/**
 * Pet pointer classification: a press-wobble is a click, not a drag.
 * The overlay used a 4px threshold, so a finger/trackpad tap never fired
 * the reaction (the pet looked "unclickable") and every 1px move re-rendered.
 */

/** CSS-px slop before a pointer-down is treated as a drag. */
export const PET_DRAG_THRESHOLD_PX = 12

export function pointerHasMoved(
  dx: number,
  dy: number,
  threshold: number = PET_DRAG_THRESHOLD_PX,
): boolean {
  return Math.abs(dx) > threshold || Math.abs(dy) > threshold
}

export type PointerEndKind = 'click' | 'drag' | 'hold-menu'

export function classifyPointerEnd(input: {
  moved: boolean
  holdMenuFired: boolean
}): PointerEndKind {
  if (input.moved) return 'drag'
  if (input.holdMenuFired) return 'hold-menu'
  return 'click'
}

/** Desktop Electron overlay: ignore mouse on empty glass, capture while interacting. */
export function desktopShouldIgnoreMouse(input: {
  dragging: boolean
  menuOpen: boolean
  overHit: boolean
  chromeOpen?: boolean
}): boolean {
  // A speech bubble must not capture the whole 420×640 window — only the
  // sprite, bubble, or mode menu (overHit / menuOpen) should take clicks.
  return !(input.dragging || input.menuOpen || input.overHit)
}

const DESKTOP_CHROME = '.dsd-pet__hit, .dsd-pet__callout, .dsd-pet__mode-menu, .dsd-pet__preparing'

/** True when the pointer is over the fish, bubble, or mode menu — not empty glass. */
export function desktopPointerOverChrome(target: EventTarget | null): boolean {
  if (target === null || typeof (target as { closest?: unknown }).closest !== 'function') return false
  return (target as Element).closest(DESKTOP_CHROME) !== null
}

/** Native window origin + screen-space pointer delta (clientX jumps as the window moves). */
export function desktopWindowPosition(
  origin: { windowX: number; windowY: number; pointerScreenX: number; pointerScreenY: number },
  pointerScreenX: number,
  pointerScreenY: number,
): { x: number; y: number } {
  return {
    x: origin.windowX + (pointerScreenX - origin.pointerScreenX),
    y: origin.windowY + (pointerScreenY - origin.pointerScreenY),
  }
}

export function ignoreMouseChanged(prev: boolean | null, next: boolean): boolean {
  return prev !== next
}

/** Cursor offset inside the native window at pointer-down. */
export function desktopDragOffset(
  windowX: number,
  windowY: number,
  pointerScreenX: number,
  pointerScreenY: number,
): { x: number; y: number } {
  return { x: pointerScreenX - windowX, y: pointerScreenY - windowY }
}

/** Window origin so the grab point stays under the cursor. */
export function desktopDragPosition(
  offset: { x: number; y: number },
  pointerScreenX: number,
  pointerScreenY: number,
): { x: number; y: number } {
  return { x: pointerScreenX - offset.x, y: pointerScreenY - offset.y }
}

/** Loop the current status webm until a different sprite is shown. Click reactions play once. */
export function petVideoShouldLoop(input: { kind: string; isReaction: boolean }): boolean {
  return !input.isReaction
}

/** Status and reaction clips both play; looping is decided by petVideoShouldLoop. */
export function petVideoShouldPlay(_input: { kind: string; isReaction: boolean }): boolean {
  return true
}
