import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodeSessionSegment, liveSessionDir, projectKey } from '../src/session-path.ts'

describe('session-path', () => {
  it('matches review-disk project + session encoding', () => {
    expect(projectKey('/Users/laiweibin/work/workSoftware/dhs-plugins'))
      .toBe('--Users-laiweibin-work-workSoftware-dhs-plugins--')
    expect(liveSessionDir(
      '/tmp/sessions',
      '/Users/laiweibin/work/workSoftware/dhs-plugins',
      'session-edd31b4a-43ab-40ee-9d1c-20b30693decb',
    )).toBe(join(
      '/tmp/sessions',
      '--Users-laiweibin-work-workSoftware-dhs-plugins--',
      'session-edd31b4a-43ab-40ee-9d1c-20b30693decb',
    ))
  })

  it('puts empty cwd under _no-cwd', () => {
    expect(liveSessionDir('/tmp/sessions', undefined, 's'))
      .toBe(join('/tmp/sessions', '_no-cwd', 's'))
    expect(liveSessionDir('/tmp/sessions', '', 's'))
      .toBe(join('/tmp/sessions', '_no-cwd', 's'))
  })

  it('encodes empty / dot segments like review-disk', () => {
    expect(() => encodeSessionSegment('')).toThrow()
    expect(encodeSessionSegment('.')).toBe('~002E')
    expect(encodeSessionSegment('..')).toBe('~002E~002E')
    expect(encodeSessionSegment('sid/1')).toBe('sid~002F1')
  })
})
