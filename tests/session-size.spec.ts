import { describe, expect, it } from 'vitest'
import { OPEN_JSONL_MAX_BYTES, formatJsonlBytes, jsonlTooLarge } from '../src/session-size.ts'

describe('session-size gate', () => {
  it('refuses jsonl larger than 8MB', () => {
    expect(jsonlTooLarge(OPEN_JSONL_MAX_BYTES)).toBe(false)
    expect(jsonlTooLarge(OPEN_JSONL_MAX_BYTES + 1)).toBe(true)
    expect(jsonlTooLarge(29 * 1024 * 1024)).toBe(true)
    expect(jsonlTooLarge(undefined)).toBe(false)
  })

  it('formats megabytes for the warning copy', () => {
    expect(formatJsonlBytes(29 * 1024 * 1024)).toBe('29 MB')
  })
})
