/**
 * ESM host + CJS ModuleLoader client build for dsh-session-desk.
 */
import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

mkdirSync('lib', { recursive: true })

// Copy the dsh-pet webm animations verbatim for the host to serve lazily (not inlined).
rmSync('lib/assets/pet', { recursive: true, force: true })
cpSync('src/client/pet/assets', 'lib/assets/pet', { recursive: true })

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
