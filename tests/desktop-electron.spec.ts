import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectTarget, ensureElectron, ELECTRON_VERSION } from '../src/desktop/electron.ts'

const PLATFORMS = [
  ['darwin', 'arm64', 'darwin-arm64', 'Electron.app/Contents/MacOS/Electron'],
  ['darwin', 'x64', 'darwin-x64', 'Electron.app/Contents/MacOS/Electron'],
  ['win32', 'x64', 'win32-x64', 'electron.exe'],
  ['linux', 'x64', 'linux-x64', 'electron'],
] as const

describe('detectTarget', () => {
  for (const [platform, arch, tag, rel] of PLATFORMS) {
    it(`maps ${platform}/${arch}`, () => {
      const t = detectTarget(platform as NodeJS.Platform, arch)
      expect(t.platform).toBe(platform)
      expect(t.downloadUrl).toContain(`electron-v${ELECTRON_VERSION}-${tag}.zip`)
      expect(t.exePath.endsWith(rel)).toBe(true)
      expect(t.exePath.startsWith(t.cacheDir)).toBe(true)
    })
  }

  it('throws on an unsupported platform', () => {
    expect(() => detectTarget('freebsd' as NodeJS.Platform)).toThrow(/unsupported/i)
  })
})

describe('ensureElectron', () => {
  it('reuses an existing cached executable without downloading', async () => {
    const dir = '/tmp/fake-cache/electron'
    const t = { version: ELECTRON_VERSION, cacheDir: dir, exePath: `${dir}/electron` } as ReturnType<typeof detectTarget>
    mkdirSync(t.cacheDir, { recursive: true })
    writeFileSync(t.exePath, 'x')
    const fetchSpy = vi.fn()
    const extractSpy = vi.fn()
    const result = await ensureElectron(t, { fetch: fetchSpy, extractZip: extractSpy } as never)
    expect(result).toBe(t.exePath)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(extractSpy).not.toHaveBeenCalled()
  })

  it('downloads and extracts when the executable is missing', async () => {
    const dir = `/tmp/dsh-pet-test-${Date.now()}`
    const t = { version: ELECTRON_VERSION, cacheDir: dir, downloadUrl: 'https://example.com/e.zip', exePath: `${dir}/electron` } as ReturnType<typeof detectTarget>
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })
    const extractSpy = vi.fn((zip: string, dest: string) => { writeFileSync(join(dest, 'electron'), 'x') })
    const result = await ensureElectron(t, { fetch: fetchSpy, extractZip: extractSpy } as never)
    expect(result).toBe(t.exePath)
    expect(fetchSpy).toHaveBeenCalledWith(t.downloadUrl)
    expect(extractSpy).toHaveBeenCalled()
  })

  it('throws when extraction does not produce the executable', async () => {
    const dir = `/tmp/dsh-pet-test-${Date.now()}`
    const t = { version: ELECTRON_VERSION, cacheDir: dir, downloadUrl: 'https://example.com/e.zip', exePath: `${dir}/electron` } as ReturnType<typeof detectTarget>
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })
    const extractSpy = vi.fn(() => {}) // writes nothing
    await expect(ensureElectron(t, { fetch: fetchSpy, extractZip: extractSpy } as never)).rejects.toThrow(/extract/i)
  })
})