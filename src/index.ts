/**
 * dsh-session-desk host: settings namespace, trash HTTP API, hourly sweep.
 */
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z, { type Schema } from '@deepseek-ai/schemastery'
import { createPetAssetHandler, createSessionDeskHandler, API_PREFIX, PET_ASSET_PREFIX, listedSessions, sessionIdOf } from './http.ts'
import { createAnswerPetEngine } from './answer/engine.ts'
import { createDesktopPetController } from './desktop/lifecycle.ts'
import { createDesktopPetHandler, PET_DESKTOP_PREFIX } from './desktop/http.ts'
import { resolveSessionsRoot } from './sessions-root.ts'
import {
  CORNER_RADIUS_LEVELS,
  DEFAULT_SETTINGS,
  FOCUS_GLOW_LEVELS,
  GLASS_LEVELS,
  HISTORY_POSITIONS,
  PET_SIZE_MAX,
  PET_SIZE_MIN,
  PET_THEME_IDS,
  SESSION_DESK_NS,
  SURFACE_SHADOW_LEVELS,
  WALLPAPER_TONE_LEVELS,
  type SessionDeskSettings,
} from './shared.ts'
import { createTrashStore } from './trash/store.ts'

export const name = 'dsh-session-desk'
export const inject = ['webServer', 'sessions', 'settings', 'agents']

export {
  DEFAULT_SETTINGS,
  SESSION_DESK_NS,
}
export type { SessionDeskSettings }

export { resolveSessionsRoot, type SessionsRootSource } from './sessions-root.ts'
export { encodeSessionSegment, liveSessionDir, projectKey } from './session-path.ts'
export { createTrashStore, makeTrashId } from './trash/store.ts'
export { probeSessionForget, probeSessionReload, validateLoopbackHost } from './http.ts'

/** Schemastery schema of the `session-desk` namespace section. */
export const SessionDeskSettingsSchema: Schema<SessionDeskSettings> = z.object({
  sessionsRoot: z.string().default(DEFAULT_SETTINGS.sessionsRoot),
  retentionDays: z.number().min(1).max(365).default(DEFAULT_SETTINGS.retentionDays),
  historyPosition: z.union([...HISTORY_POSITIONS]).default(DEFAULT_SETTINGS.historyPosition),
  historyLimit: z.number().min(0).max(120).default(DEFAULT_SETTINGS.historyLimit),
  boardTab: z.boolean().default(DEFAULT_SETTINGS.boardTab),
  petEnabled: z.boolean().default(DEFAULT_SETTINGS.petEnabled),
  petDesktop: z.boolean().default(DEFAULT_SETTINGS.petDesktop),
  petImage: z.string().default(DEFAULT_SETTINGS.petImage),
  petTheme: z.union([...PET_THEME_IDS]).default(DEFAULT_SETTINGS.petTheme),
  petSize: z.number().min(PET_SIZE_MIN).max(PET_SIZE_MAX).default(DEFAULT_SETTINGS.petSize),
  petX: z.number().default(DEFAULT_SETTINGS.petX),
  petY: z.number().default(DEFAULT_SETTINGS.petY),
  pinnedTurns: z.dict(z.array(z.number())).default({}),
  preset: z.string().default(DEFAULT_SETTINGS.preset),
  wallpaper: z.string().default(DEFAULT_SETTINGS.wallpaper),
  wallpaperBlur: z.number().default(DEFAULT_SETTINGS.wallpaperBlur),
  glass: z.union([...GLASS_LEVELS]).default(DEFAULT_SETTINGS.glass),
  trashGlass: z.union([...GLASS_LEVELS]).default(DEFAULT_SETTINGS.trashGlass),
  accent: z.string().default(DEFAULT_SETTINGS.accent),
  autoAccent: z.boolean().default(DEFAULT_SETTINGS.autoAccent),
  surfaceOpacity: z.number().default(DEFAULT_SETTINGS.surfaceOpacity),
  sidebarOpacity: z.number().default(DEFAULT_SETTINGS.sidebarOpacity),
  chatSurfaceOpacity: z.number().default(DEFAULT_SETTINGS.chatSurfaceOpacity),
  inputOpacity: z.number().default(DEFAULT_SETTINGS.inputOpacity),
  codeBlockOpacity: z.number().default(DEFAULT_SETTINGS.codeBlockOpacity),
  darkSurfaceOpacity: z.number().default(DEFAULT_SETTINGS.darkSurfaceOpacity),
  gradient: z.string().default(DEFAULT_SETTINGS.gradient),
  darkScrim: z.number().default(DEFAULT_SETTINGS.darkScrim),
  fontFamily: z.string().default(DEFAULT_SETTINGS.fontFamily),
  codeFontFamily: z.string().default(DEFAULT_SETTINGS.codeFontFamily),
  fontScale: z.number().default(DEFAULT_SETTINGS.fontScale),
  scrollbarAccent: z.boolean().default(DEFAULT_SETTINGS.scrollbarAccent),
  vignette: z.boolean().default(DEFAULT_SETTINGS.vignette),
  cornerRadius: z.union([...CORNER_RADIUS_LEVELS]).default(DEFAULT_SETTINGS.cornerRadius),
  surfaceShadow: z.union([...SURFACE_SHADOW_LEVELS]).default(DEFAULT_SETTINGS.surfaceShadow),
  focusGlow: z.union([...FOCUS_GLOW_LEVELS]).default(DEFAULT_SETTINGS.focusGlow),
  wallpaperTone: z.union([...WALLPAPER_TONE_LEVELS]).default(DEFAULT_SETTINGS.wallpaperTone),
  darkAccent: z.string().default(DEFAULT_SETTINGS.darkAccent),
  customCss: z.string().default(DEFAULT_SETTINGS.customCss),
  customVars: z.dict(z.string()).default({}),
  myPresets: z.dict(z.string()).default({}),
}) as Schema<SessionDeskSettings>

interface SettingsScope {
  get?: () => Partial<SessionDeskSettings>
  update?: (patch: Partial<SessionDeskSettings>) => unknown
}

interface SettingsRegistrar {
  register(
    namespace: ReturnType<typeof settingsNamespace>,
    schema: typeof SessionDeskSettingsSchema,
    options: { applies: 'live'; base: SessionDeskSettings },
  ): SettingsScope | void
}

interface SettingsHost {
  inject(deps: ['settings'], callback: (scope: { settings: SettingsRegistrar }) => void): void
}

interface WebServerHost {
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: import('./http.ts').DeskHttpRequest, res: import('./http.ts').DeskHttpResponse) => void | Promise<void>
    }): () => void
  }
  sessions?: object
  agents?: object
  /** `ctx.on('session/event', cb)` — the harness append feed (returns disposer). */
  on?(event: string, handler: (session: unknown, event: unknown) => void): () => void
  effect(fn: () => (() => void) | void, label?: string): void
}

function clampRetention(days: number | undefined): number {
  if (typeof days !== 'number' || !Number.isFinite(days)) return DEFAULT_SETTINGS.retentionDays
  return Math.min(365, Math.max(1, Math.trunc(days)))
}

/**
 * Register the `session-desk` settings namespace, HTTP API, and hourly trash sweep.
 */
export function apply(ctx: unknown, config?: { sessionsRoot?: string }): void {
  const settingsHost = ctx as SettingsHost
  const webHost = ctx as WebServerHost
  let readSettings = (): SessionDeskSettings => ({
    ...DEFAULT_SETTINGS,
    sessionsRoot: config?.sessionsRoot ?? DEFAULT_SETTINGS.sessionsRoot,
  })
  // Persist mutations from the desktop-pet HTTP handlers (e.g. /close persisting
  // browser mode). Falls back to a no-op when settings registration is absent.
  let updatePetSetting: (patch: Partial<SessionDeskSettings>) => Promise<void> = () => Promise.resolve()

  settingsHost.inject(['settings'], (scope) => {
    const registered = scope.settings.register(settingsNamespace(SESSION_DESK_NS), SessionDeskSettingsSchema, {
      applies: 'live',
      base: {
        ...DEFAULT_SETTINGS,
        sessionsRoot: config?.sessionsRoot ?? DEFAULT_SETTINGS.sessionsRoot,
      },
    })
    if (registered !== undefined && typeof registered.get === 'function') {
      const get = registered.get
      readSettings = () => ({ ...DEFAULT_SETTINGS, ...get() })
    }
    if (registered !== undefined && typeof registered.update === 'function') {
      const update = registered.update
      updatePetSetting = async (patch: Partial<SessionDeskSettings>) => { void update(patch) }
    }
  })

  const resolved = () => resolveSessionsRoot({
    sessionsRoot: readSettings().sessionsRoot,
    env: process.env,
    homedir,
  })

  const store = createTrashStore({
    root: () => resolved().root,
    retentionDays: () => clampRetention(readSettings().retentionDays),
  })

  // Live answer-pet engine: folds real session/event progress → titles/cards.
  // Only mounted when the harness exposes the event feed; otherwise the HTTP
  // route degrades to the coarse snapshot fold (kept for older harnesses).
  const answerPet = webHost.on !== undefined
    ? createAnswerPetEngine({
        on: (handler) => webHost.on!('session/event', handler),
        effect: (disposer, label) => webHost.effect(() => disposer, label),
        sessions: webHost.sessions,
        seed: typeof (webHost.sessions as { get?: unknown } | undefined)?.get === 'function'
          ? listedSessions(webHost.sessions ?? {}).map(sessionIdOf).filter((id): id is string => id !== undefined)
          : undefined,
      })
    : undefined

  webHost.effect(() => {
    const unregister = webHost.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: createSessionDeskHandler({
        resolveRoot: resolved,
        store,
        sessions: webHost.sessions ?? {},
        agents: webHost.agents,
        answerPet,
      }),
    })
    const petAssetsDir = fileURLToPath(new URL('./assets/pet/', import.meta.url))
    const unregisterAssets = webHost.webServer.register({
      kind: 'prefix',
      path: PET_ASSET_PREFIX,
      handler: createPetAssetHandler(petAssetsDir),
    })
    const petController = createDesktopPetController()
    const petToken = randomUUID()
    const petState: { pendingOpen: { id: string; at: number } | null } = { pendingOpen: null }
    const unregisterPet = webHost.webServer.register({
      kind: 'prefix',
      path: PET_DESKTOP_PREFIX,
      handler: createDesktopPetHandler({
        sessions: webHost.sessions ?? {},
        controller: petController,
        getPetSettings: () => {
          const s = readSettings()
          return {
            petImage: s.petImage,
            petTheme: s.petTheme,
            petSize: s.petSize,
            petX: s.petX,
            petY: s.petY,
          }
        },
        updatePetSetting,
        token: petToken,
        state: petState,
        shellAssets: {
          rendererHtml: fileURLToPath(new URL('./desktop/renderer.html', import.meta.url)),
          rendererJs: fileURLToPath(new URL('./desktop-renderer.js', import.meta.url)),
        },
      }),
    })
    const sweep = (): void => {
      void store.sweepExpired().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[dsh-session-desk] sweep failed: ${message}`)
      })
    }
    sweep()
    const timer = setInterval(sweep, 3_600_000)
    timer.unref?.()
    return () => {
      clearInterval(timer)
      unregister()
      unregisterAssets()
      unregisterPet()
    }
  }, 'dsh-session-desk: /session-desk/api')
}
