import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'

export const ELECTRON_VERSION = '31.7.7'

export interface ElectronTarget {
  platform: 'darwin' | 'win32' | 'linux'
  arch: string
  version: string
  downloadUrl: string
  exePath: string
  cacheDir: string
}

function mapTarget(platform: NodeJS.Platform, arch: string): { tag: string; rel: string } {
  const a = arch === 'arm64' ? 'arm64' : 'x64'
  if (platform === 'darwin') return { tag: `darwin-${a}`, rel: 'Electron.app/Contents/MacOS/Electron' }
  if (platform === 'win32') return { tag: `win32-${a}`, rel: 'electron.exe' }
  if (platform === 'linux') return { tag: `linux-${a}`, rel: 'electron' }
  throw new Error(`unsupported platform: ${platform}`)
}

export function detectTarget(platform: NodeJS.Platform = process.platform, arch: string = process.arch): ElectronTarget {
  const { tag, rel } = mapTarget(platform, arch)
  const root = join(homedir(), '.dsh-session-desk', 'electron', ELECTRON_VERSION)
  return {
    platform: platform as ElectronTarget['platform'],
    arch,
    version: ELECTRON_VERSION,
    downloadUrl: `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-${tag}.zip`,
    exePath: join(root, rel),
    cacheDir: root,
  }
}

function extractZip(zipPath: string, destDir: string): void {
  const r = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${destDir}'`])
    : spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir])
  if (r.status !== 0) throw new Error(`extract failed (${process.platform})`)
}

/** `.../Foo.app/Contents/MacOS/Electron` → `.../Foo.app`, else null. */
export function appBundleOf(exePath: string): string | null {
  const marker = '.app/'
  const idx = exePath.indexOf(marker)
  return idx === -1 ? null : exePath.slice(0, idx + 4)
}

/** Drop Gatekeeper quarantine and ad-hoc sign so a GitHub zip can actually launch. */
function prepareMacApp(appPath: string): void {
  spawnSync('xattr', ['-cr', appPath], { stdio: 'ignore' })
  spawnSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'ignore' })
}

/** Stream the zip to disk with curl. Avoids Node fetch().arrayBuffer() which
 *  materialises ~92MB in RAM and gets `terminated` on this host. */
function downloadWithCurl(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', dest, url], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0 && existsSync(dest)) resolve()
      else reject(new Error(`electron download failed (curl ${code ?? 'killed'})`))
    })
  })
}

export async function ensureElectron(
  target: ElectronTarget,
  deps?: {
    fetch?: typeof fetch
    extractZip?: (zip: string, dest: string) => void
    download?: (url: string, dest: string) => Promise<void>
    prepareApp?: (appPath: string) => void
  },
): Promise<string> {
  if (existsSync(target.exePath)) {
    const cached = appBundleOf(target.exePath)
    if (cached !== null) (deps?.prepareApp ?? prepareMacApp)(cached)
    return target.exePath
  }
  const cacheDir = target.cacheDir ?? dirname(target.exePath)
  mkdirSync(cacheDir, { recursive: true })
  const zipPath = join(cacheDir, `${basename(target.exePath)}.zip`)
  if (deps?.fetch) {
    const res = await deps.fetch(target.downloadUrl)
    if (!res.ok) throw new Error(`electron download failed: ${res.status}`)
    await writeFile(zipPath, Buffer.from(await res.arrayBuffer()))
  } else {
    await (deps?.download ?? downloadWithCurl)(target.downloadUrl, zipPath)
  }
  const extract = deps?.extractZip ?? extractZip
  extract(zipPath, cacheDir)
  if (!existsSync(target.exePath)) throw new Error('electron extract failed: executable not found')
  const bundle = appBundleOf(target.exePath)
  if (bundle !== null) (deps?.prepareApp ?? prepareMacApp)(bundle)
  return target.exePath
}
