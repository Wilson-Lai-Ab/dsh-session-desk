/** One member of a multi-session trash entry (root first, then subagents). */
export interface TrashMember {
  sessionId: string
  originalPath: string
  cwd?: string
}

/** On-disk record written next to a trashed session tree. */
export interface TrashManifest {
  version: 1
  sessionId: string
  cwd: string
  title: string
  deletedAt: number
  originalPath: string
  bytes: number
  members?: TrashMember[]
}

/** One live session directory under the current sessions root. */
export interface LiveSessionRow {
  sessionId: string
  cwd: string
  path: string
  bytes: number
}

export type TrashResult =
  | { ok: true; trashId: string }
  | { ok: false; code: 'not-found' | 'io'; message: string }

export type RestoreResult =
  | { ok: true; path: string }
  | { ok: false; code: 'not-found' | 'io'; message: string }

export type PurgeResult =
  | { ok: true }
  | { ok: false; code: 'not-found' | 'io'; message: string }
