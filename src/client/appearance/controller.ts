/**
 * Appearance settings controller: a staged draft over theme fields.
 * Preview renders the draft without touching the saved document.
 */
import type { SessionDeskSettings } from '../../shared.ts'
import { DEFAULTS, normalizeConfig, type CustomThemeConfig } from './config.ts'
import { PRESETS, PRESET_MAP } from './presets.ts'
import { resolveFontPreset } from './font-presets.ts'
import { randomInspirationConfig } from './color.ts'
import { previewBar } from './preview-bar.ts'
import { configFromThemeSection, type ThemeSection } from './theme-section.ts'

export type ThemeField =
  | 'wallpaper' | 'wallpaperBlur' | 'glass' | 'accent' | 'autoAccent'
  | 'surfaceOpacity' | 'sidebarOpacity' | 'chatSurfaceOpacity' | 'inputOpacity' | 'codeBlockOpacity' | 'darkSurfaceOpacity'
  | 'gradient' | 'darkScrim' | 'fontFamily' | 'codeFontFamily' | 'fontScale' | 'scrollbarAccent' | 'vignette'
  | 'cornerRadius' | 'surfaceShadow' | 'focusGlow' | 'wallpaperTone' | 'darkAccent'
  | 'customCss' | 'preset'

const THEME_FIELDS: readonly ThemeField[] = [
  'wallpaper', 'wallpaperBlur', 'glass', 'accent', 'autoAccent',
  'surfaceOpacity', 'sidebarOpacity', 'chatSurfaceOpacity', 'inputOpacity', 'codeBlockOpacity', 'darkSurfaceOpacity',
  'gradient', 'darkScrim', 'fontFamily', 'codeFontFamily', 'fontScale', 'scrollbarAccent', 'vignette',
  'cornerRadius', 'surfaceShadow', 'focusGlow', 'wallpaperTone', 'darkAccent',
  'customCss', 'preset',
]

export type ParamGroup = 'background' | 'color' | 'surface' | 'typography' | 'refine' | 'advanced'

const GROUP_FIELDS: Readonly<Record<ParamGroup, readonly ThemeField[]>> = {
  background: ['wallpaper', 'wallpaperBlur', 'glass', 'gradient', 'darkScrim', 'wallpaperTone'],
  color: ['accent', 'autoAccent', 'darkAccent'],
  surface: ['surfaceOpacity', 'sidebarOpacity', 'chatSurfaceOpacity', 'inputOpacity', 'codeBlockOpacity', 'darkSurfaceOpacity'],
  typography: ['fontFamily', 'codeFontFamily', 'fontScale'],
  refine: ['cornerRadius', 'surfaceShadow', 'focusGlow', 'scrollbarAccent', 'vignette'],
  advanced: ['customCss'],
}

const GROUP_NEUTRALS: Readonly<Record<ParamGroup, Partial<ThemeSection>>> = {
  background: {
    wallpaper: DEFAULTS.wallpaper, wallpaperBlur: DEFAULTS.wallpaperBlur, glass: DEFAULTS.glass, gradient: DEFAULTS.gradient,
    darkScrim: DEFAULTS.darkScrim, wallpaperTone: DEFAULTS.wallpaperTone,
  },
  color: { accent: DEFAULTS.accent, autoAccent: DEFAULTS.autoAccent, darkAccent: DEFAULTS.darkAccent },
  surface: {
    surfaceOpacity: DEFAULTS.surfaceOpacity, sidebarOpacity: DEFAULTS.sidebarOpacity,
    chatSurfaceOpacity: DEFAULTS.chatSurfaceOpacity, inputOpacity: DEFAULTS.inputOpacity,
    codeBlockOpacity: DEFAULTS.codeBlockOpacity, darkSurfaceOpacity: 100,
  },
  typography: { fontFamily: DEFAULTS.fontFamily, codeFontFamily: DEFAULTS.codeFontFamily, fontScale: DEFAULTS.fontScale },
  refine: {
    cornerRadius: DEFAULTS.cornerRadius, surfaceShadow: DEFAULTS.surfaceShadow, focusGlow: DEFAULTS.focusGlow,
    scrollbarAccent: DEFAULTS.scrollbarAccent, vignette: DEFAULTS.vignette,
  },
  advanced: { customCss: DEFAULTS.customCss },
}

export interface MyPreset {
  id: string
  name: string
  config: Partial<CustomThemeConfig>
}

export interface ActivePreset {
  kind: 'shipped' | 'my'
  id: string
}

export interface AppearanceSettingsState {
  status: 'loading' | 'ready' | 'unavailable'
  writable: boolean
  values: ThemeSection
  draft: ThemeSection
  dirty: boolean
  saving: boolean
  previewing: boolean
  myPresets: readonly MyPreset[]
  activePreset: ActivePreset | null
  customVarsText: string
}

export interface AppearanceScope {
  get(): Partial<SessionDeskSettings>
  update(patch: Partial<SessionDeskSettings>): Promise<void> | void
}

const serializeMyPreset = (name: string, config: Partial<CustomThemeConfig>): string =>
  JSON.stringify({ name, config })

function themeSectionToPartial(section: ThemeSection): Partial<CustomThemeConfig> {
  const out: Partial<CustomThemeConfig> = {}
  for (const field of THEME_FIELDS) {
    const value = section[field]
    if (value !== undefined) (out as Record<string, unknown>)[field] = value
  }
  return out
}

function parseMyPresets(raw: unknown): MyPreset[] {
  if (typeof raw !== 'object' || raw === null) return []
  const out: MyPreset[] = []
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value !== 'string') continue
    try {
      const parsed = JSON.parse(value) as { name?: unknown; config?: unknown }
      const name = typeof parsed.name === 'string' && parsed.name !== '' ? parsed.name : id
      if (typeof parsed.config !== 'object' || parsed.config === null) continue
      out.push({ id, name, config: parsed.config as Partial<CustomThemeConfig> })
    } catch {
      // malformed record — skip
    }
  }
  return out
}

export const themeOf = (config: CustomThemeConfig): ThemeSection => ({
  wallpaper: config.wallpaper,
  wallpaperBlur: config.wallpaperBlur,
  glass: config.glass,
  accent: config.accent,
  autoAccent: config.autoAccent,
  surfaceOpacity: config.surfaceOpacity,
  sidebarOpacity: config.sidebarOpacity,
  chatSurfaceOpacity: config.chatSurfaceOpacity,
  inputOpacity: config.inputOpacity,
  codeBlockOpacity: config.codeBlockOpacity,
  darkSurfaceOpacity: config.darkSurfaceOpacity,
  gradient: config.gradient,
  darkScrim: config.darkScrim,
  fontFamily: config.fontFamily,
  codeFontFamily: config.codeFontFamily,
  fontScale: config.fontScale,
  scrollbarAccent: config.scrollbarAccent,
  vignette: config.vignette,
  cornerRadius: config.cornerRadius,
  surfaceShadow: config.surfaceShadow,
  focusGlow: config.focusGlow,
  wallpaperTone: config.wallpaperTone,
  darkAccent: config.darkAccent,
  customCss: config.customCss,
  customVars: config.customVars,
  preset: config.preset,
})

function serializeVars(vars: Record<string, string> | undefined): string {
  if (vars === undefined) return ''
  return Object.entries(vars).map(([key, value]) => `${key}: ${value}`).join('\n')
}

function parseVarsText(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon <= 0) continue
    const key = trimmed.slice(0, colon).trim()
    const value = trimmed.slice(colon + 1).trim()
    out[key] = value
  }
  return out
}

/** Bridges the session-desk settings document onto the appearance form. */
export class AppearanceSettingsController {
  private values: ThemeSection
  private draft: ThemeSection
  private touched = false
  private saving = false
  private previewing = false
  private customVarsText: string
  private listeners = new Set<() => void>()
  private snapshot: AppearanceSettingsState

  constructor(
    private readonly scope: AppearanceScope,
    private readonly defaults: CustomThemeConfig,
    private readonly onPreview: (config: CustomThemeConfig) => void,
  ) {
    this.values = themeOf(configFromThemeSection(defaults, scope.get() as ThemeSection))
    this.draft = { ...this.values }
    this.customVarsText = serializeVars(this.values.customVars)
    this.snapshot = this.buildSnapshot()
    previewBar.setRestore(() => this.cancelPreview())
  }

  getSnapshot = (): AppearanceSettingsState => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot()
    for (const listener of [...this.listeners]) listener()
  }

  private buildSnapshot(): AppearanceSettingsState {
    const myPresets = parseMyPresets(this.scope.get().myPresets)
    return {
      status: 'ready',
      writable: true,
      values: this.values,
      draft: this.draft,
      dirty: this.dirty(),
      saving: this.saving,
      previewing: this.previewing,
      myPresets,
      activePreset: this.recomputeActivePreset(myPresets),
      customVarsText: this.customVarsText,
    }
  }

  syncFromScope(): void {
    const config = configFromThemeSection(this.defaults, this.scope.get() as ThemeSection)
    this.values = themeOf(config)
    if (!this.touched) {
      this.draft = { ...this.values }
      this.customVarsText = serializeVars(this.values.customVars)
    }
    // Non-theme writes (e.g. 我的预设) must not abort a live preview.
    if (this.previewing) {
      this.emit()
      return
    }
    previewBar.hide()
    this.emit()
  }

  private dirty(): boolean {
    if (this.customVarsText !== serializeVars(this.values.customVars)) return true
    return THEME_FIELDS.some((field) => this.draft[field] !== this.values[field])
  }

  private recomputeActivePreset(myPresets: readonly MyPreset[]): ActivePreset | null {
    for (const preset of PRESETS) {
      if (this.matchesPreset(preset.config)) return { kind: 'shipped', id: preset.id }
    }
    for (const preset of myPresets) {
      if (this.matchesPreset(preset.config)) return { kind: 'my', id: preset.id }
    }
    return null
  }

  private matchesPreset(config: Partial<CustomThemeConfig>): boolean {
    const presetSection = themeOf(normalizeConfig(undefined, config))
    return THEME_FIELDS.filter(field => field !== 'customCss' && field !== 'preset').every((field) => presetSection[field] === this.draft[field])
  }

  private applyTheme(section: ThemeSection): void {
    const vars = parseVarsText(this.customVarsText)
    this.onPreview(configFromThemeSection(this.defaults, { ...section, customVars: vars }))
  }

  setField(field: ThemeField, value: string | number | boolean): void {
    this.touched = true
    this.draft = { ...this.draft, [field]: value } as ThemeSection
    if (this.previewing) this.applyTheme(this.draft)
    this.emit()
  }

  setCustomVarsText(text: string): void {
    this.touched = true
    this.customVarsText = text
    if (this.previewing) this.applyTheme(this.draft)
    this.emit()
  }

  preview(): void {
    if (!this.dirty()) return
    this.previewing = true
    previewBar.show()
    this.applyTheme(this.draft)
    this.emit()
  }

  private loadPresetConfig(config: Partial<CustomThemeConfig>): void {
    const presetTheme = themeOf(configFromThemeSection(this.defaults, config as ThemeSection))
    const wallpaper = typeof config.wallpaper === 'string' && config.wallpaper !== ''
      ? config.wallpaper
      : ''
    this.touched = true
    this.draft = { ...presetTheme, wallpaper }
    this.previewing = false
    this.emit()
  }

  applyPreset(id: string): void {
    const preset = PRESET_MAP.get(id)?.config
    if (preset === undefined) return
    this.loadPresetConfig(preset)
    this.draft = { ...this.draft, preset: id }
    this.emit()
  }

  async saveMyPreset(name: string): Promise<void> {
    const clean = name.trim()
    if (clean === '') return
    const config = themeSectionToPartial(this.draft)
    const record = serializeMyPreset(clean, config)
    const current = this.scope.get().myPresets ?? {}
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    await this.scope.update({ myPresets: { ...current, [id]: record } })
    this.syncFromScope()
  }

  async removeMyPreset(id: string): Promise<void> {
    const current = this.scope.get().myPresets ?? {}
    if (!(id in current)) return
    const next = { ...current }
    delete next[id]
    await this.scope.update({ myPresets: next })
    this.syncFromScope()
  }

  applyMyPreset(id: string): void {
    const preset = this.snapshot.myPresets.find((entry) => entry.id === id)
    if (preset === undefined) return
    this.loadPresetConfig(preset.config)
  }

  applyFontPreset(id: string): void {
    const fields = resolveFontPreset(id)
    this.touched = true
    this.draft = { ...this.draft, fontFamily: fields.fontFamily, codeFontFamily: fields.codeFontFamily } as ThemeSection
    if (this.previewing) this.applyTheme(this.draft)
    this.emit()
  }

  randomInspiration(): void {
    this.loadPresetConfig(randomInspirationConfig())
  }

  resetGroup(group: ParamGroup): void {
    const neutral = GROUP_NEUTRALS[group]
    let next = this.draft
    for (const field of GROUP_FIELDS[group]) {
      next = { ...next, [field]: neutral[field] } as ThemeSection
    }
    this.touched = true
    this.draft = next
    if (group === 'advanced') this.customVarsText = ''
    if (this.previewing) this.applyTheme(this.draft)
    this.emit()
  }

  cancelPreview(): void {
    this.previewing = false
    previewBar.hide()
    this.applyTheme(this.values)
    this.emit()
  }

  async resetAll(): Promise<void> {
    if (this.saving) return
    this.saving = true
    this.emit()
    try {
      const patch: Partial<SessionDeskSettings> = {}
      for (const field of THEME_FIELDS) {
        (patch as Record<string, unknown>)[field] = field === 'darkSurfaceOpacity'
          ? 100
          : DEFAULTS[field as keyof typeof DEFAULTS]
      }
      patch.customVars = {}
      patch.preset = ''
      await this.scope.update(patch)
    } finally {
      this.saving = false
      this.touched = false
      this.previewing = false
      previewBar.hide()
      this.syncFromScope()
      this.applyTheme(this.values)
    }
  }

  async save(): Promise<void> {
    if (!this.dirty() || this.saving) return
    this.saving = true
    this.emit()
    try {
      const patch: Partial<SessionDeskSettings> = {}
      for (const field of THEME_FIELDS) {
        const next = this.draft[field]
        if (next === this.values[field]) continue
        ;(patch as Record<string, unknown>)[field] = next
      }
      const vars = parseVarsText(this.customVarsText)
      if (JSON.stringify(vars) !== JSON.stringify(this.values.customVars ?? {})) patch.customVars = vars
      await this.scope.update(patch)
    } finally {
      this.saving = false
      this.touched = false
      this.previewing = false
      previewBar.hide()
      this.syncFromScope()
    }
  }
}
