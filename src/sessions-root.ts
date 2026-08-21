/**
 * Resolve the on-disk sessions tree. Settings override only when the value
 * expands to an absolute path; empty / relative values fall through.
 */
import { isAbsolute, join } from 'node:path'

/** Which layer produced the resolved sessions root. */
export type SessionsRootSource = 'config' | 'env' | 'home' | 'default'

/** Inputs for {@link resolveSessionsRoot} (env and homedir are injectable). */
export interface ResolveSessionsRootInput {
  sessionsRoot?: string
  env?: NodeJS.ProcessEnv
  homedir: () => string
}

/** Expand a single leading `~` or `~/` via `homedir()`; other values pass through. */
function expandLeadingTilde(raw: string, homedir: () => string): string {
  if (raw === '~') return homedir()
  if (raw.startsWith('~/')) return `${homedir()}${raw.slice(1)}`
  return raw
}

/**
 * Resolve the sessions directory in spec order: absolute settings override,
 * then `DSH_SESSIONS_ROOT`, then `$DSH_HOME/sessions`, then `~/.dsh/sessions`.
 */
export function resolveSessionsRoot(input: ResolveSessionsRootInput): {
  root: string
  source: SessionsRootSource
} {
  const env = input.env ?? {}
  const configured = input.sessionsRoot
  if (configured !== undefined && configured !== '') {
    const expanded = expandLeadingTilde(configured, input.homedir)
    if (isAbsolute(expanded)) return { root: expanded, source: 'config' }
  }

  const fromEnv = env.DSH_SESSIONS_ROOT
  if (fromEnv !== undefined && fromEnv !== '') {
    return { root: fromEnv, source: 'env' }
  }

  const dshHome = env.DSH_HOME
  if (dshHome !== undefined && dshHome !== '') {
    return { root: join(dshHome, 'sessions'), source: 'home' }
  }

  return { root: join(input.homedir(), '.dsh', 'sessions'), source: 'default' }
}
