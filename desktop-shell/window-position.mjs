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
