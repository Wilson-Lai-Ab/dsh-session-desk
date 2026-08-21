/** The 外观 tab: theme form, presets, preview, custom CSS/vars. */

import { useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import type { SessionDeskSettings } from '../../shared.ts'
import { appearanceEn, appearanceZh, type AppearanceKey } from './appearance-locales.ts'
import { AppearancePreview } from './AppearancePreview.tsx'
import {
  AppearanceSettingsController,
  type AppearanceScope,
  type ParamGroup,
  type ThemeField,
} from './controller.ts'
import { harmonySwatches } from './color.ts'
import type { CustomThemeConfig } from './config.ts'
import { DEFAULTS } from './config.ts'
import { FONT_PRESETS } from './font-presets.ts'
import { PRESETS } from './presets.ts'
import { adoptAppearanceStyles } from './section-styles.ts'
import type { SessionDeskKey } from '../locales.ts'

type FormEvent = SyntheticEvent<HTMLElement>

export interface AppearanceSectionProps {
  t?: (key: SessionDeskKey, vars?: Record<string, string | number>) => string
  settings: SessionDeskSettings
  update: (patch: Partial<SessionDeskSettings>) => Promise<void> | void
  onPreview?: (config: CustomThemeConfig) => void
}

const GLASS_OPTIONS: readonly { id: 'off' | 'light' | 'frosted' | 'mica'; label: AppearanceKey }[] = [
  { id: 'off', label: 'glass.off' },
  { id: 'light', label: 'glass.light' },
  { id: 'frosted', label: 'glass.frosted' },
  { id: 'mica', label: 'glass.mica' },
]

const SLIDERS: readonly { field: ThemeField; label: AppearanceKey }[] = [
  { field: 'surfaceOpacity', label: 'surfaceOpacity' },
  { field: 'sidebarOpacity', label: 'sidebarOpacity' },
  { field: 'chatSurfaceOpacity', label: 'chatSurfaceOpacity' },
  { field: 'inputOpacity', label: 'inputOpacity' },
  { field: 'codeBlockOpacity', label: 'codeBlockOpacity' },
  { field: 'darkSurfaceOpacity', label: 'darkSurfaceOpacity' },
]

type RefineLabel =
  | 'radius.inherit' | 'radius.sm' | 'radius.md' | 'radius.lg' | 'radius.xl'
  | 'shadow.inherit' | 'shadow.none' | 'shadow.soft' | 'shadow.medium' | 'shadow.strong'
  | 'tone.inherit' | 'tone.soft' | 'tone.dim' | 'tone.bright'

const CORNER_RADIUS_OPTIONS: readonly { id: string; label: RefineLabel }[] = [
  { id: 'inherit', label: 'radius.inherit' },
  { id: 'sm', label: 'radius.sm' },
  { id: 'md', label: 'radius.md' },
  { id: 'lg', label: 'radius.lg' },
  { id: 'xl', label: 'radius.xl' },
]

const SHADOW_OPTIONS: readonly { id: string; label: RefineLabel }[] = [
  { id: 'inherit', label: 'shadow.inherit' },
  { id: 'none', label: 'shadow.none' },
  { id: 'soft', label: 'shadow.soft' },
  { id: 'medium', label: 'shadow.medium' },
  { id: 'strong', label: 'shadow.strong' },
]

const TONE_OPTIONS: readonly { id: string; label: RefineLabel }[] = [
  { id: 'inherit', label: 'tone.inherit' },
  { id: 'soft', label: 'tone.soft' },
  { id: 'dim', label: 'tone.dim' },
  { id: 'bright', label: 'tone.bright' },
]

const presetPreviewBackground = (config: Partial<CustomThemeConfig>): string => {
  const accent = typeof config.accent === 'string' && config.accent !== ''
    ? config.accent
    : '#4176e6'
  if (typeof config.gradient === 'string' && config.gradient !== '') return config.gradient
  return `linear-gradient(135deg, ${accent}, ${accent}55)`
}

function fallbackT(key: string): string {
  const lang = typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('en')
    ? appearanceEn
    : appearanceZh
  const short = key.startsWith('appearance.') ? key.slice('appearance.'.length) : key
  return (lang as Record<string, string>)[short] ?? key
}

function GroupCard({
  title, resetLabel, group, writable, onReset, children,
}: {
  title: string
  resetLabel: string
  group: ParamGroup
  writable: boolean
  onReset: (group: ParamGroup) => void
  children: ReactNode
}) {
  return (
    <div className="dsd-as-card">
      <div className="dsd-as-groupHeader">
        <h3 className="dsd-as-cardTitle">{title}</h3>
        <button
          type="button"
          className="dsd-as-groupReset"
          disabled={!writable}
          onClick={() => onReset(group)}
        >
          {resetLabel}
        </button>
      </div>
      {children}
    </div>
  )
}

/**
 * Appearance form hosted by the 会话管理 外观 tab.
 */
export function AppearanceSection({ t, settings, update, onPreview }: AppearanceSectionProps): ReactNode {
  adoptAppearanceStyles()
  const translator = (key: AppearanceKey): string => t?.(`appearance.${key}` as SessionDeskKey) ?? fallbackT(key)

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const updateRef = useRef(update)
  updateRef.current = update
  const previewRef = useRef(onPreview)
  previewRef.current = onPreview

  const controller = useMemo(() => {
    const scope: AppearanceScope = {
      get: () => settingsRef.current,
      update: (patch) => updateRef.current(patch),
    }
    return new AppearanceSettingsController(scope, DEFAULTS, (config) => {
      previewRef.current?.(config)
    })
  }, [])

  const [tick, setTick] = useState(0)
  useEffect(() => controller.subscribe(() => setTick(n => n + 1)), [controller])
  const settingsSignature = JSON.stringify(settings)
  useEffect(() => { controller.syncFromScope() }, [controller, settingsSignature])
  void tick

  const state = controller.getSnapshot()
  const draft = state.draft
  const [presetName, setPresetName] = useState('')
  const num = (field: ThemeField, fallback: number): number =>
    typeof draft[field] === 'number' ? draft[field] as number : fallback
  const str = (field: ThemeField, fallback: string): string =>
    typeof draft[field] === 'string' ? draft[field] as string : fallback
  const bool = (field: ThemeField, fallback: boolean): boolean =>
    typeof draft[field] === 'boolean' ? draft[field] as boolean : fallback

  const accent = str('accent', '#4176e6')
  const swatches = useMemo(() => harmonySwatches(accent), [accent])
  const fontPresetId = FONT_PRESETS.find(
    (preset) => preset.uiFont === str('fontFamily', '') && preset.codeFont === str('codeFontFamily', ''),
  )?.id ?? '__custom__'

  return (
    <div className="dsd-as-section">
      <div className="dsd-hint" role="note">{translator('themeOnly')}</div>
      <h2 className="dsd-as-heading">{translator('title')}</h2>
      <p className="dsd-as-intro">{translator('intro')}</p>

      <div className="dsd-as-card">
        <div className="dsd-as-groupHeader">
          <h3 className="dsd-as-cardTitle">{translator('previewTitle')}</h3>
          <button
            type="button"
            className="dsd-as-inspire"
            disabled={!state.writable}
            onClick={() => controller.randomInspiration()}
          >
            {translator('randomInspiration')}
          </button>
        </div>
        <AppearancePreview draft={draft} />
        <p className="dsd-as-hint">{translator('previewHint')}</p>
      </div>

      <div className="dsd-as-card">
        <h3 className="dsd-as-cardTitle">{translator('presetTitle')}</h3>
        <p className="dsd-as-hint">{translator('presetHint')}</p>
        <div className="dsd-as-presetGrid">
          {PRESETS.map((preset) => {
            const active = state.activePreset?.kind === 'shipped' && state.activePreset.id === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                className={`dsd-as-presetCard${active ? ' dsd-as-presetCardActive' : ''}`}
                disabled={!state.writable}
                onClick={() => controller.applyPreset(preset.id)}
              >
                <span className="dsd-as-presetPreview" style={{ background: presetPreviewBackground(preset.config) }} />
                <span className="dsd-as-presetName">{preset.name}</span>
                {active ? <span className="dsd-as-presetBadge">{translator('activePreset')}</span> : null}
                <span className="dsd-as-presetDesc">{preset.description}</span>
              </button>
            )
          })}
        </div>
        <div className="dsd-as-presetSaveRow">
          <input
            className="dsd-as-presetNameInput"
            type="text"
            value={presetName}
            placeholder={translator('myPresetName')}
            disabled={!state.writable}
            onChange={(event: FormEvent) => setPresetName((event.target as HTMLInputElement).value)}
            onKeyDown={(event: FormEvent) => { if ((event as { key?: string }).key === 'Enter') void controller.saveMyPreset(presetName).then(() => setPresetName('')) }}
          />
          <button
            type="button"
            className="dsd-as-presetSave"
            disabled={!state.writable || presetName.trim() === ''}
            onClick={() => { void controller.saveMyPreset(presetName).then(() => setPresetName('')) }}
          >
            {translator('saveMyPreset')}
          </button>
        </div>
        {state.myPresets.length > 0 && (
          <div className="dsd-as-presetGrid">
            {state.myPresets.map((preset) => {
              const active = state.activePreset?.kind === 'my' && state.activePreset.id === preset.id
              return (
                <div
                  key={preset.id}
                  className={`dsd-as-presetCard${active ? ' dsd-as-presetCardActive' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => controller.applyMyPreset(preset.id)}
                >
                  <span className="dsd-as-presetPreview" style={{ background: presetPreviewBackground(preset.config) }} />
                  <span className="dsd-as-presetName">{preset.name}</span>
                  {active ? <span className="dsd-as-presetBadge">{translator('activePreset')}</span> : null}
                  <button
                    type="button"
                    className="dsd-as-presetRemove"
                    aria-label={translator('removeMyPreset')}
                    onClick={(event: FormEvent) => { event.stopPropagation(); void controller.removeMyPreset(preset.id) }}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <GroupCard title={translator('groupBackground')} resetLabel={translator('groupReset')} group="background" writable={state.writable} onReset={(g) => controller.resetGroup(g)}>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-wallpaper">{translator('wallpaper')}</label>
          <input id="appearance-wallpaper" className="dsd-as-text" type="text" value={str('wallpaper', '')} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('wallpaper', (event.target as HTMLInputElement).value)} />
          <p className="dsd-as-hint">{translator('wallpaperHint')}</p>
        </div>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-glass">{translator('glass')}</label>
          <select id="appearance-glass" className="dsd-as-select" value={str('glass', 'frosted')} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('glass', (event.target as HTMLSelectElement).value)}>
            {GLASS_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{translator(option.label)}</option>
            ))}
          </select>
        </div>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-gradient">{translator('gradient')}</label>
          <input id="appearance-gradient" className="dsd-as-text" type="text" value={str('gradient', '')} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('gradient', (event.target as HTMLInputElement).value)} />
          <p className="dsd-as-hint">{translator('gradientHint')}</p>
        </div>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-darkScrim">{translator('darkScrim')}</label>
          <span className="dsd-as-slider">
            <input id="appearance-darkScrim" className="dsd-as-range" type="range" min={0} max={100} value={num('darkScrim', 0)} style={{ ['--fill' as string]: `${num('darkScrim', 0)}%` }} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('darkScrim', Number((event.target as HTMLInputElement).value))} />
            <span className="dsd-as-rangeValue">{num('darkScrim', 0)}%</span>
          </span>
        </div>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-wallpaperTone">{translator('wallpaperTone')}</label>
          <select id="appearance-wallpaperTone" className="dsd-as-select" value={str('wallpaperTone', 'inherit')} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('wallpaperTone', (event.target as HTMLSelectElement).value)}>
            {TONE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{translator(option.label)}</option>
            ))}
          </select>
        </div>
      </GroupCard>

      <GroupCard title={translator('groupColor')} resetLabel={translator('groupReset')} group="color" writable={state.writable} onReset={(g) => controller.resetGroup(g)}>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-accent">{translator('accent')}</label>
          <span className="dsd-as-slider">
            <input id="appearance-accent" className="dsd-as-color" type="color" value={accent} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('accent', (event.target as HTMLInputElement).value)} />
            <input className="dsd-as-text" type="text" value={accent} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('accent', (event.target as HTMLInputElement).value)} />
          </span>
        </div>
        <div className="dsd-as-row">
          <label className="dsd-as-label">{translator('accentPalette')}</label>
          <span className="dsd-as-swatches">
            {swatches.map((color) => (
              <button key={color} type="button" className="dsd-as-swatch" style={{ background: color }} title={color} aria-label={color} disabled={!state.writable} onClick={() => controller.setField('accent', color)} />
            ))}
          </span>
          <p className="dsd-as-hint">{translator('accentPaletteHint')}</p>
        </div>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-autoAccent">{translator('autoAccent')}</label>
          <span className="dsd-as-check">
            <input id="appearance-autoAccent" className="dsd-as-checkbox" type="checkbox" checked={bool('autoAccent', false)} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('autoAccent', Boolean((event.target as HTMLInputElement).checked))} />
          </span>
        </div>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-darkAccent">{translator('darkAccent')}</label>
          <span className="dsd-as-slider">
            <input id="appearance-darkAccent" className="dsd-as-color" type="color" value={str('darkAccent', '') || '#4176e6'} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('darkAccent', (event.target as HTMLInputElement).value)} />
            <input className="dsd-as-text" type="text" value={str('darkAccent', '')} placeholder={translator('darkAccentPlaceholder')} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('darkAccent', (event.target as HTMLInputElement).value)} />
          </span>
          <p className="dsd-as-hint">{translator('darkAccentHint')}</p>
        </div>
      </GroupCard>

      <GroupCard title={translator('groupSurface')} resetLabel={translator('groupReset')} group="surface" writable={state.writable} onReset={(g) => controller.resetGroup(g)}>
        {SLIDERS.map((slider) => (
          <div key={slider.field} className="dsd-as-row">
            <label className="dsd-as-label" htmlFor={`appearance-${slider.field}`}>{translator(slider.label)}</label>
            <span className="dsd-as-slider">
              <input id={`appearance-${slider.field}`} className="dsd-as-range" type="range" min={0} max={100} value={num(slider.field, 100)} style={{ ['--fill' as string]: `${num(slider.field, 100)}%` }} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField(slider.field, Number((event.target as HTMLInputElement).value))} />
              <span className="dsd-as-rangeValue">{num(slider.field, 100)}%</span>
            </span>
          </div>
        ))}
      </GroupCard>

      <GroupCard title={translator('groupTypography')} resetLabel={translator('groupReset')} group="typography" writable={state.writable} onReset={(g) => controller.resetGroup(g)}>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-fontPreset">{translator('fontPreset')}</label>
          <select id="appearance-fontPreset" className="dsd-as-select" value={fontPresetId} disabled={!state.writable} onChange={(event: FormEvent) => { const v = (event.target as HTMLSelectElement).value; if (v !== '__custom__') controller.applyFontPreset(v) }}>
            {FONT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
            <option value="__custom__">{translator('fontCustom')}</option>
          </select>
          <p className="dsd-as-hint">{translator('fontPresetHint')}</p>
        </div>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-font">{translator('fontFamily')}</label>
          <input id="appearance-font" className="dsd-as-text" type="text" value={str('fontFamily', '')} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('fontFamily', (event.target as HTMLInputElement).value)} />
        </div>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-codeFont">{translator('codeFontFamily')}</label>
          <input id="appearance-codeFont" className="dsd-as-text" type="text" value={str('codeFontFamily', '')} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('codeFontFamily', (event.target as HTMLInputElement).value)} />
        </div>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-fontScale">{translator('fontScale')}</label>
          <span className="dsd-as-slider">
            <input id="appearance-fontScale" className="dsd-as-range" type="range" min={0.9} max={1.1} step={0.05} value={num('fontScale', 1)} style={{ ['--fill' as string]: `${((num('fontScale', 1) - 0.9) / 0.2) * 100}%` }} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('fontScale', Number((event.target as HTMLInputElement).value))} />
            <span className="dsd-as-rangeValue">×{num('fontScale', 1).toFixed(2)}</span>
          </span>
          <p className="dsd-as-hint">{translator('fontScaleHint')}</p>
        </div>
      </GroupCard>

      <GroupCard title={translator('refineTitle')} resetLabel={translator('groupReset')} group="refine" writable={state.writable} onReset={(g) => controller.resetGroup(g)}>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-cornerRadius">{translator('cornerRadius')}</label>
          <select id="appearance-cornerRadius" className="dsd-as-select" value={str('cornerRadius', 'inherit')} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('cornerRadius', (event.target as HTMLSelectElement).value)}>
            {CORNER_RADIUS_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{translator(option.label)}</option>
            ))}
          </select>
        </div>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-surfaceShadow">{translator('surfaceShadow')}</label>
          <select id="appearance-surfaceShadow" className="dsd-as-select" value={str('surfaceShadow', 'inherit')} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('surfaceShadow', (event.target as HTMLSelectElement).value)}>
            {SHADOW_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{translator(option.label)}</option>
            ))}
          </select>
        </div>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-focusGlow">{translator('focusGlow')}</label>
          <span className="dsd-as-check">
            <input id="appearance-focusGlow" className="dsd-as-checkbox" type="checkbox" checked={str('focusGlow', 'inherit') === 'on'} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('focusGlow', (event.target as HTMLInputElement).checked ? 'on' : 'inherit')} />
          </span>
        </div>
        {(['scrollbarAccent', 'vignette'] as const).map((field) => (
          <div key={field} className="dsd-as-row">
            <label className="dsd-as-label" htmlFor={`appearance-${field}`}>{translator(field)}</label>
            <span className="dsd-as-check">
              <input id={`appearance-${field}`} className="dsd-as-checkbox" type="checkbox" checked={bool(field, false)} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField(field, Boolean((event.target as HTMLInputElement).checked))} />
            </span>
          </div>
        ))}
      </GroupCard>

      <GroupCard title={translator('customCss')} resetLabel={translator('groupReset')} group="advanced" writable={state.writable} onReset={(g) => controller.resetGroup(g)}>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-customCss">{translator('customCss')}</label>
          <textarea id="appearance-customCss" className="dsd-as-text" value={str('customCss', '')} disabled={!state.writable} onChange={(event: FormEvent) => controller.setField('customCss', (event.target as HTMLTextAreaElement).value)} rows={6} />
          <p className="dsd-as-hint">{translator('customCssHint')}</p>
        </div>
        <div className="dsd-as-row">
          <label className="dsd-as-label" htmlFor="appearance-customVars">{translator('customVars')}</label>
          <textarea id="appearance-customVars" className="dsd-as-text" value={state.customVarsText} disabled={!state.writable} onChange={(event: FormEvent) => controller.setCustomVarsText((event.target as HTMLTextAreaElement).value)} rows={4} />
          <p className="dsd-as-hint">{translator('customVarsHint')}</p>
        </div>
      </GroupCard>

      <div className="dsd-as-footer">
        {state.dirty ? <span className="dsd-as-dirty">{translator('dirty')}</span> : null}
        {state.previewing ? <span className="dsd-as-previewing">{translator('previewing')}</span> : null}
        <button type="button" className="dsd-as-reset" disabled={!state.writable || state.saving} onClick={() => { void controller.resetAll() }}>
          {translator('reset')}
        </button>
        {state.previewing ? (
          <button type="button" className="dsd-as-cancel" disabled={!state.writable || state.saving} onClick={() => controller.cancelPreview()}>
            {translator('cancelPreview')}
          </button>
        ) : (
          <button type="button" className="dsd-as-preview" disabled={!state.dirty || !state.writable || state.saving} onClick={() => controller.preview()}>
            {translator('preview')}
          </button>
        )}
        <button type="button" className="dsd-as-save" disabled={!state.dirty || !state.writable || state.saving} onClick={() => { void controller.save() }}>
          {state.saving ? translator('saving') : translator('save')}
        </button>
      </div>
    </div>
  )
}
