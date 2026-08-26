/**
 * Client half: locale dictionaries, 会话管理 settings, history minimap + pin,
 * gated conversation-header board tab, appearance apply + preview overlay,
 * and a gated draggable status pet.
 *
 * Cordis client service rename (dsh >= 0.1.0-rc.7): inject `settingsScope`
 * (not `settings`) and bind a namespace via `settingsScope.bind({ namespace })`.
 */
import { useEffect, useSyncExternalStore } from 'react'
import {
  DEFAULT_SETTINGS,
  SESSION_DESK_NS,
  cachedThemeOrNull,
  type PetThemeId,
  type SessionDeskSettings,
} from '../shared.ts'
import { historySlotsWanted } from '../history/minimap-control.ts'
import { applyConfig } from './appearance/apply.ts'
import { DEFAULTS, normalizeConfig } from './appearance/config.ts'
import { PreviewBar } from './appearance/PreviewBar.tsx'
import { previewBar } from './appearance/preview-bar.ts'
import { SettingsSection } from './SettingsSection.tsx'
import { BoardView } from './board/BoardView.tsx'
import { HistoryStrip } from './history/HistoryStrip.tsx'
import { PinTurnAction } from './history/PinTurnAction.tsx'
import { adoptHistoryStyles } from './history/history-styles.ts'
import { PetOverlay } from './pet/PetOverlay.tsx'
import { TrashFooter } from './trash/TrashFooter.tsx'
import { startRowWash } from './workspace/row-wash.ts'
import { answerPetState } from './api.ts'
import { NS, en, zh } from './locales.ts'

export const inject = ['slots', 'locale', 'sessions', 'connection', 'remote', 'settingsScope']

interface LocaleFace {
  register(ns: string, dicts: { zh: typeof zh; en: typeof en }): () => void
  bind(ns: string): (key: string, vars?: Record<string, string | number>) => string
}

interface SlotsFace {
  inject(name: string, factory: () => unknown): unknown
  register(options: Record<string, unknown>, occupant: unknown): unknown
}

/** Host transport for one settings namespace (dsh-client-ui-settings). */
interface DeskScope {
  getSnapshot(): { value?: SessionDeskSettings }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

/** Scope plus a patch helper used by settings UI / pin / pet. */
interface DeskScopeWithUpdate extends DeskScope {
  update(patch: Partial<SessionDeskSettings>): Promise<void>
}

interface ClientContext {
  effect(fn: () => (() => void) | void, label?: string): void
  locale: LocaleFace
  slots: SlotsFace
  sessions?: {
    list?: unknown
    open?: (id: string) => unknown
    create?: (opts: { cwd?: string }) => unknown
    refresh?: () => Promise<void>
    refreshSubagents?: (parentSessionId: string) => Promise<void>
    setSubagentCatalogOpen?: (parentSessionId: string, open: boolean) => void
    binding?: (sessionId: string) => { session?: { loadOlder?: () => unknown } } | undefined
  }
  settingsScope: {
    bind(spec: { namespace: string }): DeskScope
  }
}

function settingsValue(scope: DeskScope): Partial<SessionDeskSettings> {
  return scope.getSnapshot().value ?? {}
}

const THEME_CACHE_KEY = 'dsh-session-desk:petTheme'

function readCachedTheme(): PetThemeId | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return cachedThemeOrNull(localStorage.getItem(THEME_CACHE_KEY))
  } catch {
    return null
  }
}

function writeCachedTheme(id: PetThemeId): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(THEME_CACHE_KEY, id)
  } catch {
    /* ignore quota/security errors */
  }
}

async function writePatch(scope: DeskScope, patch: Partial<SessionDeskSettings>): Promise<void> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) await scope.unset(key)
    else {
      await scope.set(key, value)
      if (key === 'petTheme') writeCachedTheme(value as PetThemeId)
    }
  }
}

function withUpdate(scope: DeskScope): DeskScopeWithUpdate {
  return {
    getSnapshot: () => scope.getSnapshot(),
    subscribe: (listener) => scope.subscribe(listener),
    set: (field, value) => scope.set(field, value),
    unset: (field) => scope.unset(field),
    update: (patch) => writePatch(scope, patch),
  }
}

function createUseScope(scope: DeskScope) {
  return function useScope<T>(select: (snapshot: { value: SessionDeskSettings }) => T): T {
    const snap = useSyncExternalStore(
      (listener) => scope.subscribe(listener),
      () => scope.getSnapshot(),
      () => scope.getSnapshot(),
    )
    const loadedTheme = snap.value?.petTheme
    useEffect(() => {
      if (loadedTheme !== undefined) writeCachedTheme(loadedTheme)
    }, [loadedTheme])
    const cached = readCachedTheme()
    const defaults = cached === null ? DEFAULT_SETTINGS : { ...DEFAULT_SETTINGS, petTheme: cached }
    return select({ value: { ...defaults, ...(snap.value ?? {}) } })
  }
}

function readPinned(scope: DeskScope): Record<string, number[]> {
  return settingsValue(scope).pinnedTurns ?? {}
}

function asDisposer(value: unknown): () => void {
  return typeof value === 'function' ? (value as () => void) : () => {}
}

function applyAppearance(partial: Partial<SessionDeskSettings>): void {
  if (previewBar.getSnapshot()) return
  applyConfig(normalizeConfig({ ...DEFAULT_SETTINGS, ...partial }, undefined))
}

function reopenSettings(): void {
  if (typeof document === 'undefined') return
  const triggers = Array.from(document.querySelectorAll('[aria-haspopup="dialog"]')) as HTMLElement[]
  for (const trigger of triggers) {
    const label = trigger.textContent ?? ''
    if (label.includes('设置') || label.includes('Settings') || label.includes('設定')) {
      trigger.click()
      break
    }
  }
  window.setTimeout(() => {
    const rows = Array.from(document.querySelectorAll('button')) as HTMLElement[]
    for (const row of rows) {
      const text = (row.textContent ?? '').trim()
      if (text === '外观' || text === 'Appearance' || text === '外觀') {
        row.click()
        return
      }
    }
  }, 60)
}

export function apply(ctx: ClientContext): void {
  const scope = withUpdate(ctx.settingsScope.bind({ namespace: SESSION_DESK_NS }))
  const useDeskScope = createUseScope(scope)

  adoptHistoryStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-desk: dictionaries')

  const t = ctx.locale.bind(NS)
  ctx.effect(() => {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: SESSION_DESK_NS,
      order: 30,
      label: () => t('nav'),
      locale: NS,
      inject: () => ({
        t,
        useScope: useDeskScope,
        update: (patch: Partial<SessionDeskSettings>) => writePatch(scope, patch),
      }),
    }, SettingsSection))
  }, 'dsh-session-desk: settings section')

  ctx.effect(() => {
    let occupied = false
    let dropDetails = (): void => {}
    let dropPin = (): void => {}
    const vacate = (): void => {
      dropDetails()
      dropPin()
      dropDetails = () => {}
      dropPin = () => {}
      occupied = false
    }
    const occupy = (): void => {
      if (occupied) return
      try {
        dropDetails = asDisposer(ctx.slots.inject('details', () => ctx.slots.register({
          name: 'details',
          priority: -1,
          locale: NS,
          inject: (sessionId: string) => ({
            sessionId,
            loadOlder: () => { void ctx.sessions?.binding?.(sessionId)?.session?.loadOlder?.() },
            hooks: { scope },
            useScope: useDeskScope,
          }),
        }, HistoryStrip)))
        dropPin = asDisposer(ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'session-desk-pin',
          order: 5,
          locale: NS,
          inject: (sessionId: string) => {
            const togglePin = (turn: number): void => {
              const record = { ...readPinned(scope) }
              const current = record[sessionId] ?? []
              const next = current.includes(turn)
                ? current.filter(n => n !== turn)
                : [...current, turn].sort((a, b) => a - b)
              const updated = { ...record }
              if (next.length === 0) delete updated[sessionId]
              else updated[sessionId] = next
              void scope.update({ pinnedTurns: updated })
            }
            return {
              sessionId,
              hooks: { position: scope, pinnedTurns: scope, scope },
              useScope: useDeskScope,
              togglePin,
            }
          },
        }, PinTurnAction)))
        occupied = true
      } catch {
        vacate()
      }
    }
    const sync = (): void => {
      if (historySlotsWanted(settingsValue(scope).historyPosition)) occupy()
      else vacate()
    }
    sync()
    const off = scope.subscribe(sync)
    return () => {
      off()
      vacate()
    }
  }, 'dsh-session-desk: history minimap')

  ctx.effect(() => {
    const sync = (): void => {
      try {
        applyAppearance(settingsValue(scope))
      } catch {
        /* appearance must not abort later overlays */
      }
    }
    sync()
    const off = scope.subscribe(sync)
    return () => {
      off()
      applyConfig(normalizeConfig(DEFAULTS, undefined))
      if (typeof document !== 'undefined') document.getElementById('dsh-session-desk-theme-style')?.remove()
    }
  }, 'dsh-session-desk: appearance apply')

  ctx.effect(() => {
    return asDisposer(ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'session-desk-preview',
      order: 90,
      locale: NS,
      inject: () => ({
        t,
        onExit: () => { previewBar.exit(); reopenSettings() },
      }),
    }, PreviewBar)))
  }, 'dsh-session-desk: appearance preview')

  ctx.effect(() => {
    let occupied = false
    let dropBoard = (): void => {}
    const vacate = (): void => {
      dropBoard()
      dropBoard = () => {}
      occupied = false
    }
    const occupy = (): void => {
      if (occupied) return
      try {
        dropBoard = asDisposer(ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'session-desk-board',
          order: 40,
          locale: NS,
          label: () => t('board.tab'),
          inject: (sessionId: string) => ({ sessionId }),
        }, BoardView)))
        occupied = true
      } catch {
        vacate()
      }
    }
    const sync = (): void => {
      if (settingsValue(scope).boardTab === false) vacate()
      else occupy()
    }
    sync()
    const off = scope.subscribe(sync)
    return () => {
      off()
      vacate()
    }
  }, 'dsh-session-desk: board tab')

  ctx.effect(() => {
    let occupied = false
    let dropPet = (): void => {}
    const vacate = (): void => {
      dropPet()
      dropPet = () => {}
      occupied = false
    }
    const occupy = (): void => {
      if (occupied) return
      try {
        dropPet = asDisposer(ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-desk-pet',
          order: 40,
          locale: NS,
          inject: () => ({
            t,
            sessions: ctx.sessions,
            hooks: { scope },
            useScope: useDeskScope,
            update: (patch: Partial<SessionDeskSettings>) => writePatch(scope, patch),
          }),
        }, PetOverlay)))
        occupied = true
      } catch {
        vacate()
      }
    }
    const sync = (): void => {
      if (settingsValue(scope).petEnabled === false) vacate()
      else occupy()
    }
    sync()
    const off = scope.subscribe(sync)
    return () => {
      off()
      vacate()
    }
  }, 'dsh-session-desk: pet overlay')

  ctx.effect(() => {
    return asDisposer(ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'session-desk-trash',
      order: 40,
      locale: NS,
      inject: () => ({
        t,
        sessions: ctx.sessions,
        useScope: useDeskScope,
      }),
    }, TrashFooter)))
  }, 'dsh-session-desk: trash footer')

  ctx.effect(() => startRowWash({
    list: ctx.sessions?.list,
    fetchCards: async () => {
      try {
        return (await answerPetState()).running
      } catch {
        return []
      }
    },
  }), 'dsh-session-desk: workspace row wash')
}
