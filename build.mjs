/**
 * ESM host + CJS ModuleLoader client build for dsh-session-desk.
 */
import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

mkdirSync('lib', { recursive: true })

// Copy the dsh-pet webm animations verbatim for the host to serve lazily (not inlined).
rmSync('lib/assets/pet', { recursive: true, force: true })
cpSync('src/client/pet/assets', 'lib/assets/pet', { recursive: true })

// Copy the Electron desktop shell's static files into lib/ so the packaged
// plugin (which ships lib/ only) carries everything the spawned window needs.
rmSync('lib/desktop', { recursive: true, force: true })
mkdirSync('lib/desktop', { recursive: true })
cpSync('desktop-shell/main.mjs', 'lib/desktop/main.mjs')
cpSync('desktop-shell/window-position.mjs', 'lib/desktop/window-position.mjs')
cpSync('desktop-shell/preload.cjs', 'lib/desktop/preload.cjs')
cpSync('desktop-shell/renderer.html', 'lib/desktop/renderer.html')

const dshExternal = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-*', '@deepseek-ai/schemastery']

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: true,
  external: dshExternal,
  logLevel: 'info',
})

await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  jsx: 'automatic',
  external: [...dshExternal, 'react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'scheduler'],
  banner: {
    js: "window.__ModuleLoader__.load({ id: 'dsh-session-desk', factory: (require) => { var module = { exports: {} }; var exports = module.exports;",
  },
  footer: {
    js: 'return module.exports; } });',
  },
  logLevel: 'info',
})

// Electron overlay renderer. Unlike the web client, react is bundled here (the
// renderer has no window.__ModuleLoader__ / external ids), so this entry declares
// no `external` at all.
await build({
  entryPoints: ['desktop-shell/renderer.tsx'],
  outfile: 'lib/desktop-renderer.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  jsx: 'automatic',
  logLevel: 'info',
})
