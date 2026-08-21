import { describe, expect, it } from 'vitest'
import { classifyTool, collectToolStats, type ToolBucket } from '../src/board/classify.ts'

const TABLE: Array<[string, ToolBucket]> = [
  ['skill', 'skill'],
  ['load_skill', 'skill'],
  ['slash-skill', 'skill'],
  ['bash', 'bash'],
  ['job_output', 'bash'],
  ['job_kill', 'bash'],
  ['read', 'read'],
  ['read_image', 'read'],
  ['write', 'write'],
  ['edit', 'write'],
  ['grep', 'search'],
  ['glob', 'search'],
  ['web_search', 'search'],
  ['web_fetch', 'browse'],
  ['browser', 'browse'],
  ['web_browse', 'browse'],
  ['vision_ocr', 'vision'],
  ['vision_crop', 'vision'],
  ['subagent', 'subagent'],
  ['task', 'subagent'],
  ['send_message', 'subagent'],
  ['unknown_tool', 'other'],
]

describe('classifyTool', () => {
  it.each(TABLE)('maps %s → %s', (name, bucket) => {
    expect(classifyTool(name)).toBe(bucket)
  })

  it('treats web_search as search, not browse', () => {
    expect(classifyTool('web_search')).toBe('search')
    expect(classifyTool('web_image_search')).toBe('search')
  })

  it('maps remaining web_* names to browse', () => {
    expect(classifyTool('web_fetch')).toBe('browse')
    expect(classifyTool('web_open')).toBe('browse')
  })
})

describe('collectToolStats', () => {
  it('counts buckets and sums duration from tool-call / result pairs', () => {
    const nodes = new Map([
      ['c1', {
        kind: 'tool-call',
        data: { callId: 'a', name: 'grep', time: 1000 },
      }],
      ['r1', {
        kind: 'tool-result',
        data: { callId: 'a', call: { name: 'grep' }, callTime: 1000, time: 1400 },
      }],
      ['c2', {
        kind: 'tool-call',
        data: { callId: 'b', name: 'bash', time: 2000 },
      }],
      ['r2', {
        kind: 'tool-result',
        data: { callId: 'b', name: 'bash', callTime: 2000, time: 2500 },
      }],
      ['a1', { kind: 'assistant', data: { durationMs: 9999 } }],
    ])
    const stats = collectToolStats({ order: ['c1', 'r1', 'c2', 'r2', 'a1'], nodes })
    expect(stats).toEqual(expect.arrayContaining([
      { bucket: 'search', count: 1, totalMs: 400 },
      { bucket: 'bash', count: 1, totalMs: 500 },
    ]))
    expect(stats.find(row => row.bucket === 'other')).toBeUndefined()
  })

  it('pairs top-level tool-result nodes by callId and name', () => {
    const stats = collectToolStats({
      order: ['r1'],
      nodes: new Map([
        ['r1', {
          kind: 'tool-result',
          callId: 'c1',
          call: { name: 'web_fetch' },
          callTime: 10,
          time: 40,
        }],
      ]),
    })
    expect(stats).toEqual([{ bucket: 'browse', count: 1, totalMs: 30 }])
  })
})
