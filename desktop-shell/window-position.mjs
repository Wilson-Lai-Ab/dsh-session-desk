/**
 * Clamp the desktop-pet window so the sprite can reach any work-area
 * point. The window is taller than the sprite, so it must be allowed
 * to hang off the top/sides of the screen.
 */
export function clampDesktopWindowPosition(
  x,
  y,
  winW,
  winH,
  workArea,
  keep = 64,
) {
  const minX = workArea.x - winW + keep
  const maxX = workArea.x + workArea.width - keep
  const minY = workArea.y - winH + keep
  const maxY = workArea.y + workArea.height - keep
  return {
    x: Math.min(maxX, Math.max(minX, Math.round(x))),
    y: Math.min(maxY, Math.max(minY, Math.round(y))),
  }
}

export function parseWindowOriginArgs(argv) {
  let x
  let y
  for (const arg of argv) {
    if (arg.startsWith('--x=')) x = Number(arg.slice('--x='.length))
    if (arg.startsWith('--y=')) y = Number(arg.slice('--y='.length))
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

export function initialDesktopWindowPosition(origin, winW, winH, workArea) {
  if (origin && Number.isFinite(origin.x) && Number.isFinite(origin.y)) {
    return clampDesktopWindowPosition(origin.x, origin.y, winW, winH, workArea)
  }
  return {
    x: workArea.x + workArea.width - winW - 12,
    y: workArea.y + workArea.height - winH - 12,
  }
}
