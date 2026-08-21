/**
 * Browser fetch wrappers for `/session-desk/api`. Mutations send the plugin marker.
 */
import type { TrashManifest } from '../trash/types.ts'

const PREFIX = '/session-desk/api'
const MUTATION_HEADERS = {
  'content-type': 'application/json',
  'x-dsh-session-desk': '1',
} as const

export interface LiveSessionRow {
  sessionId: string
  cwd: string
  path: string
  bytes: number
}

export interface RootInfo {
  root: string
  source: 'config' | 'env' | 'home' | 'default'
}

export interface TrashRow extends TrashManifest {
  trashId: string
  memberCount?: number
}

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: string
  code?: string
}

async function readEnvelope<T>(response: Response): Promise<Envelope<T>> {
  const body = await response.json() as Envelope<T>
  return body
}

function fail(envelope: Envelope<unknown>, fallback: string): never {
  throw new Error(envelope.error ?? fallback)
}

export async function getRoot(): Promise<RootInfo> {
  const response = await fetch(`${PREFIX}/root`, { credentials: 'same-origin' })
  const body = await readEnvelope<RootInfo>(response)
  if (!body.ok || body.data === undefined) fail(body, 'root unavailable')
  return body.data
}

export async function listSessions(): Promise<LiveSessionRow[]> {
  const response = await fetch(`${PREFIX}/sessions`, { credentials: 'same-origin' })
  const body = await readEnvelope<LiveSessionRow[]>(response)
  if (!body.ok || body.data === undefined) fail(body, 'sessions unavailable')
  return body.data
}

export async function trash(input: { sessionId: string; cwd?: string; title?: string; sessionIds?: string[] }): Promise<{ trashId: string }> {
  const response = await fetch(`${PREFIX}/trash`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: MUTATION_HEADERS,
    body: JSON.stringify(input),
  })
  const body = await readEnvelope<{ trashId: string }>(response)
  if (!body.ok || body.data === undefined) fail(body, 'trash failed')
  return body.data
}

export async function listTrash(): Promise<TrashRow[]> {
  const response = await fetch(`${PREFIX}/trash`, { credentials: 'same-origin' })
  const body = await readEnvelope<TrashRow[]>(response)
  if (!body.ok || body.data === undefined) fail(body, 'trash list unavailable')
  return body.data
}

export async function restore(trashId: string): Promise<{ path: string }> {
  const response = await fetch(`${PREFIX}/restore`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ trashId }),
  })
  const body = await readEnvelope<{ path: string }>(response)
  if (!body.ok || body.data === undefined) fail(body, 'restore failed')
  return body.data
}

export async function purge(input: { trashId: string } | { all: true }): Promise<{ removed?: number }> {
  const response = await fetch(`${PREFIX}/purge`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: MUTATION_HEADERS,
    body: JSON.stringify(input),
  })
  const body = await readEnvelope<{ removed?: number }>(response)
  if (!body.ok) fail(body, 'purge failed')
  return body.data ?? {}
}

/** One answer-pet status card (progress + trajectory) for a running session. */
export interface AnswerStatusCard {
  id: string
  /** Friendly session title (from the live session/event feed, not the UUID). */
  title: string | null
  view: {
    phase: string
    label: string
    progress: number
    outputTokens: number
    inputTokens: number
    rateTokS: number
    elapsedMs: number
    toolName?: string | null
    endReason?: string | null
    textSnippet?: string
  }
  trace: Array<{
    id: string
    kind: 'phase' | 'tool'
    label: string
    detail?: string | null
    status: 'running' | 'done' | 'error'
    durationMs: number
  }>
}

/** The live answer-pet snapshot served by /answer-pet/state. */
export interface AnswerPetSnapshot {
  /** Most-recently-active session's view (or idle when none). */
  view: AnswerStatusCard['view']
  trace: AnswerStatusCard['trace']
  /** The active session identity, if within the activity window. */
  session: { id: string; title: string | null; running: boolean } | null
  /** Every running session's card (plus the active one even if briefly idle). */
  running: AnswerStatusCard[]
  active: boolean
}

/** Poll the live answer-pet engine (real title + non-zero progress from session events). */
export async function answerPetState(): Promise<AnswerPetSnapshot> {
  const response = await fetch(`${PREFIX}/answer-pet/state`, { credentials: 'same-origin' })
  const body = await readEnvelope<AnswerPetSnapshot>(response)
  if (!body.ok || body.data === undefined) fail(body, 'answer-pet state unavailable')
  return body.data
}
