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
    const prepareApp = vi.fn()
    const result = await ensureElectron(t, { fetch: fetchSpy, extractZip: extractSpy, prepareApp } as never)
    expect(result).toBe(t.exePath)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(extractSpy).not.toHaveBeenCalled()
    expect(prepareApp).not.toHaveBeenCalled()
  })

  it('does not re-prepare a cached macOS .app on reuse (codesign is too slow to run on every spawn)', async () => {
    const dir = `/tmp/dsh-pet-reuse-${Date.now()}`
    const exePath = `${dir}/Electron.app/Contents/MacOS/Electron`
    mkdirSync(`${dir}/Electron.app/Contents/MacOS`, { recursive: true })
    writeFileSync(exePath, 'x')
    const t = { version: ELECTRON_VERSION, cacheDir: dir, exePath } as ReturnType<typeof detectTarget>
    const prepareApp = vi.fn()
    await ensureElectron(t, { prepareApp })
    expect(prepareApp).not.toHaveBeenCalled()
  })

  it('downloads and extracts when the executable is missing', async () => {
    const dir = `/tmp/dsh-pet-test-${Date.now()}`
    const t = { version: ELECTRON_VERSION, cacheDir: dir, downloadUrl: 'https://example.com/e.zip', exePath: `${dir}/electron` } as ReturnType<typeof detectTarget>
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })
    const extractSpy = vi.fn(async (zip: string, dest: string) => { writeFileSync(join(dest, 'electron'), 'x') })
    const result = await ensureElectron(t, { fetch: fetchSpy, extractZip: extractSpy } as never)
    expect(result).toBe(t.exePath)
    expect(fetchSpy).toHaveBeenCalledWith(t.downloadUrl)
    expect(extractSpy).toHaveBeenCalled()
  })

  it('after extract, prepares the macOS .app (xattr / ad-hoc sign)', async () => {
    const dir = `/tmp/dsh-pet-test-${Date.now()}`
    const exePath = `${dir}/Electron.app/Contents/MacOS/Electron`
    const t = {
      version: ELECTRON_VERSION,
      platform: 'darwin',
      cacheDir: dir,
      downloadUrl: 'https://example.com/e.zip',
      exePath,
    } as ReturnType<typeof detectTarget>
    const download = vi.fn(async (_url: string, dest: string) => { writeFileSync(dest, 'zip') })
    const extractSpy = vi.fn(async (_zip: string, dest: string) => {
      mkdirSync(`${dest}/Electron.app/Contents/MacOS`, { recursive: true })
      writeFileSync(exePath, 'x')
    })
    const prepareApp = vi.fn(async () => {})
    await ensureElectron(t, { download, extractZip: extractSpy, prepareApp })
    expect(prepareApp).toHaveBeenCalledWith(`${dir}/Electron.app`)
  })

  it('streams via download() when fetch is not injected', async () => {
    const dir = `/tmp/dsh-pet-test-${Date.now()}`
    const t = { version: ELECTRON_VERSION, cacheDir: dir, downloadUrl: 'https://example.com/e.zip', exePath: `${dir}/electron` } as ReturnType<typeof detectTarget>
    const download = vi.fn(async (_url: string, dest: string) => { writeFileSync(dest, 'zip') })
    const extractSpy = vi.fn(async (zip: string, dest: string) => { writeFileSync(join(dest, 'electron'), 'x') })
    const result = await ensureElectron(t, { download, extractZip: extractSpy })
    expect(result).toBe(t.exePath)
    expect(download).toHaveBeenCalledWith(t.downloadUrl, expect.stringMatching(/\.zip$/))
    expect(extractSpy).toHaveBeenCalled()
  })

  it('throws when extraction does not produce the executable', async () => {
    const dir = `/tmp/dsh-pet-test-${Date.now()}`
    const t = { version: ELECTRON_VERSION, cacheDir: dir, downloadUrl: 'https://example.com/e.zip', exePath: `${dir}/electron` } as ReturnType<typeof detectTarget>
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })
    const extractSpy = vi.fn(async () => {}) // writes nothing
    await expect(ensureElectron(t, { fetch: fetchSpy, extractZip: extractSpy } as never)).rejects.toThrow(/extract/i)
  })
})