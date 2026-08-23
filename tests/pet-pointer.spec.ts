import { describe, expect, it } from 'vitest'
import { foldedPetSignature, type FoldedPetRow } from '../src/client/pet/status.ts'
import {
  PET_DRAG_THRESHOLD_PX,
  classifyPointerEnd,
  desktopDragOffset,
  desktopDragPosition,
  desktopPointerOverChrome,
  desktopWindowPosition,
  ignoreMouseChanged,
  petVideoShouldLoop,
  petVideoShouldPlay,
  pointerHasMoved,
} from '../src/client/pet/pointer.ts'

describe('pointerHasMoved', () => {
  it('treats a small press-wobble as a click, not a drag', () => {
    expect(PET_DRAG_THRESHOLD_PX).toBeGreaterThanOrEqual(12)
    expect(pointerHasMoved(3, 3)).toBe(false)
    expect(pointerHasMoved(5, 0)).toBe(false)
    expect(pointerHasMoved(0, 11)).toBe(false)
  })

  it('starts a drag only after the pointer clears the click slop', () => {
    expect(pointerHasMoved(12, 0)).toBe(false)
    expect(pointerHasMoved(13, 0)).toBe(true)
    expect(pointerHasMoved(0, -13)).toBe(true)
  })
})

describe('classifyPointerEnd', () => {
  it('classifies a tap that never left slop as a click, not a hold-menu', () => {
    expect(classifyPointerEnd({ moved: false, holdMenuFired: false })).toBe('click')
  })

  it('rerolls the idle sprite when idleTick advances', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../src/client/pet/PetOverlay.tsx', import.meta.url), 'utf8')
    expect(src).toMatch(/resolveSprite\(theme, kind\)[\s\S]{0,80}idleTick/)
    expect(src).toMatch(/nextIdleBroadcastDelay/)
    expect(src).toMatch(/IDLE_BROADCAST_HOLD_MS/)
    expect(src).toMatch(/idleBroadcast/)
    expect(src).not.toMatch(/const bubbleOpen = true/)
  })

  it('opens the desktop/browser menu only on long-press, not on click', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../src/client/pet/PetOverlay.tsx', import.meta.url), 'utf8')
    const clickArm = src.slice(src.indexOf("if (kind === 'click')"), src.indexOf("if (kind === 'click')") + 900)
    expect(clickArm).toContain('setReaction')
    expect(src).toContain('MODE_HOLD_MS')
    expect(src).toContain('setModeMenu(true)')
  })

  it('closes the mode menu on a second click or pointer down outside it', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../src/client/pet/PetOverlay.tsx', import.meta.url), 'utf8')
    const clickArm = src.slice(src.indexOf("if (kind === 'click')"), src.indexOf("if (kind === 'click')") + 900)
    expect(clickArm).toMatch(/if \(modeMenu\) \{\s*setModeMenu\(false\)/)
    expect(src).toMatch(/closest\('\.dsd-pet__mode-menu'\) \|\| node\.closest\('\.dsd-pet__hit'\)/)
    expect(src).toMatch(/setModeMenu\(false\)/)
  })

  it('does not steal the click when a long-press already opened the mode menu', () => {
    expect(classifyPointerEnd({ moved: false, holdMenuFired: true })).toBe('hold-menu')
  })

  it('commits a drag when the pointer moved past slop', () => {
    expect(classifyPointerEnd({ moved: true, holdMenuFired: false })).toBe('drag')
    expect(classifyPointerEnd({ moved: true, holdMenuFired: true })).toBe('drag')
  })
})

describe('desktopWindowPosition', () => {
  it('moves the native window from screen-space pointer deltas, not clientX', () => {
    const origin = { windowX: 100, windowY: 200, pointerScreenX: 140, pointerScreenY: 260 }
    expect(desktopWindowPosition(origin, 160, 280)).toEqual({ x: 120, y: 220 })
    expect(desktopWindowPosition(origin, 140, 260)).toEqual({ x: 100, y: 200 })
  })
})

describe('desktop native drag', () => {
  it('keeps the grab point under the cursor using window-relative offset', () => {
    expect(desktopDragOffset(100, 200, 140, 260)).toEqual({ x: 40, y: 60 })
    expect(desktopDragPosition({ x: 40, y: 60 }, 180, 300)).toEqual({ x: 140, y: 240 })
  })
})

describe('petVideoShouldLoop', () => {
  it('never loops desktop-costly clips; busy still shows one play then freezes', () => {
    expect(petVideoShouldLoop({ kind: 'idle', isReaction: false })).toBe(false)
    expect(petVideoShouldLoop({ kind: 'running', isReaction: false })).toBe(false)
    expect(petVideoShouldLoop({ kind: 'running', isReaction: true })).toBe(false)
  })
})

describe('petVideoShouldPlay', () => {
  it('plays idle clips so the desktop pet can rotate animations', () => {
    expect(petVideoShouldPlay({ kind: 'idle', isReaction: false })).toBe(true)
    expect(petVideoShouldPlay({ kind: 'running', isReaction: false })).toBe(true)
    expect(petVideoShouldPlay({ kind: 'idle', isReaction: true })).toBe(true)
  })
})

describe('ignoreMouseChanged', () => {
  it('only sends IPC when the ignore flag actually flips', () => {
    expect(ignoreMouseChanged(null, true)).toBe(true)
    expect(ignoreMouseChanged(true, true)).toBe(false)
    expect(ignoreMouseChanged(true, false)).toBe(true)
    expect(ignoreMouseChanged(false, false)).toBe(false)
  })
})

describe('desktopShouldIgnoreMouse', () => {
  it('forwards clicks through empty glass, but not while dragging or the mode menu is open', async () => {
    const { desktopShouldIgnoreMouse } = await import('../src/client/pet/pointer.ts')
    expect(desktopShouldIgnoreMouse({ dragging: false, menuOpen: false, overHit: false })).toBe(true)
    expect(desktopShouldIgnoreMouse({ dragging: false, menuOpen: false, overHit: true })).toBe(false)
    expect(desktopShouldIgnoreMouse({ dragging: true, menuOpen: false, overHit: false })).toBe(false)
    expect(desktopShouldIgnoreMouse({ dragging: false, menuOpen: true, overHit: false })).toBe(false)
    expect(desktopShouldIgnoreMouse({ dragging: false, menuOpen: false, overHit: false, chromeOpen: true })).toBe(false)
  })
})

describe('desktopPointerOverChrome', () => {
  it('captures the fish and bubble, not empty glass', () => {
    const hit = { closest: (sel: string) => sel.includes('.dsd-pet__hit') ? hit : null }
    const glass = { closest: () => null }
    expect(desktopPointerOverChrome(hit)).toBe(true)
    expect(desktopPointerOverChrome(glass)).toBe(false)
    expect(desktopPointerOverChrome(null)).toBe(false)
  })
})

describe('foldedPetSignature', () => {
  const row = (patch: Partial<FoldedPetRow> = {}): FoldedPetRow => ({
    id: 's1',
    title: 'chat',
    kind: 'idle',
    ...patch,
  })

  it('stays equal when session-store churn does not change pet rows', () => {
    expect(foldedPetSignature([row()])).toBe(foldedPetSignature([row()]))
  })

  it('changes when a row kind, title, activity, or tool changes', () => {
    const base = foldedPetSignature([row()])
    expect(foldedPetSignature([row({ kind: 'running' })])).not.toBe(base)
    expect(foldedPetSignature([row({ title: 'other' })])).not.toBe(base)
    expect(foldedPetSignature([row({ activity: 'streaming' })])).not.toBe(base)
    expect(foldedPetSignature([row({ tool: 'edit' })])).not.toBe(base)
  })
})
