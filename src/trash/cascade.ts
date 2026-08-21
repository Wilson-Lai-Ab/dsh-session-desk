/**
 * Resolve the transitive subagent descendants of a session, for cascade trash.
 * `origin === 'subagent'` is the only authority for "is a subagent"; `parentId`
 * only traces the parent→child chain. Forks (which share lineage but carry no
 * `origin: 'subagent'`) are never included.
 */

export interface CascadeRow {
  id: string
  parentId?: string
  origin?: 'subagent' | string
}

export interface CascadeCatalogEntry {
  id: string
  kind?: string
}

export interface CascadeInput {
  byId?: Record<string, CascadeRow | undefined>
  subagentsByParent?: Record<string, { entries?: readonly CascadeCatalogEntry[] } | undefined>
}

/** Transitive subagent descendants of `root`, deduped, excluding `root` itself. */
export function collectDescendants(root: string, input: CascadeInput): string[] {
  const byId = input.byId ?? {}
  const catalogs = input.subagentsByParent ?? {}
  const out: string[] = []
  const seen = new Set<string>([root])
  const queue: string[] = [root]
  while (queue.length > 0) {
    const current = queue.shift()!
    const children = new Set<string>()
    for (const row of Object.values(byId)) {
      if (row !== undefined && row.parentId === current && row.origin === 'subagent') children.add(row.id)
    }
    const entries = catalogs[current]?.entries ?? []
    for (const entry of entries) {
      if (entry.kind === 'child') children.add(entry.id)
    }
    for (const child of children) {
      if (seen.has(child)) continue
      seen.add(child)
      out.push(child)
      queue.push(child)
    }
  }
  return out
}
