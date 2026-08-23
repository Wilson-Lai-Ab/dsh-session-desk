/**
 * Disk-size gate for opening a session from this plugin.
 * DSH still loads the full log if the native list is used; we only refuse
 * our own `sessions.open` path when the jsonl is already past the OOM line.
 */
export const OPEN_JSONL_MAX_BYTES = 8 * 1024 * 1024

export function jsonlTooLarge(bytes: number | undefined): boolean {
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes > OPEN_JSONL_MAX_BYTES
}

export function formatJsonlBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]!}`
}
