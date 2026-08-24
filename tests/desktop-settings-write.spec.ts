import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { bindPetSettingWriter } from '../src/desktop/settings-write.ts'

describe('bindPetSettingWriter', () => {
  it('awaits the settings update instead of fire-and-forgetting', async () => {
    let settled = false
    let release!: () => void
    const writer = bindPetSettingWriter(() => new Promise<void>(resolve => { release = resolve }))
    const done = writer({ petDesktop: false }).then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await done
    expect(settled).toBe(true)
  })

  it('is a no-op when the settings scope has no update', async () => {
    await expect(bindPetSettingWriter(undefined)({ petDesktop: false })).resolves.toBeUndefined()
  })
})

describe('desktop overlay settings write', () => {
  it('awaits /settings so a browser-mode switch persists before the window dies', () => {
    const src = readFileSync(new URL('../desktop-shell/renderer.tsx', import.meta.url), 'utf8')
    expect(src).toMatch(/await fetch\(`\$\{PREFIX\}\/settings`/)
    expect(src).not.toMatch(/void fetch\(`\$\{PREFIX\}\/settings`/)
  })

  it('host settings writer awaits the scope update', () => {
    const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(src).toContain('bindPetSettingWriter')
    expect(src).not.toContain('void update(patch)')
  })
})
