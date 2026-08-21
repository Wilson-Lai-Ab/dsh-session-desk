import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyConfig, isNeutralConfig } from '../src/client/appearance/apply.ts'
import { DEFAULTS, normalizeConfig } from '../src/client/appearance/config.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function source(relative: string): string {
  return readFileSync(resolve(root, relative), 'utf8')
}

describe('appearance CSS prefix', () => {
  it('exports applyConfig for the session-desk theme pipeline', () => {
    expect(typeof applyConfig).toBe('function')
    expect(DEFAULTS.accent).toBe('#4176e6')
    expect(isNeutralConfig(DEFAULTS)).toBe(true)
    expect(isNeutralConfig(normalizeConfig(undefined, undefined))).toBe(true)
  })

  it('has no leftover --dsu- or data-dsu-active in apply/css sources', () => {
    const files = [
      'src/client/appearance/apply.ts',
      'src/client/appearance/theme-styles.ts',
    ]
    for (const file of files) {
      const text = source(file)
      expect(text, file).not.toContain('--dsu-')
      expect(text, file).not.toContain('data-dsu-active')
    }
  })
})
