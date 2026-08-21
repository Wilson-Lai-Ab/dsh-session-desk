import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'
import { applyConfig, isNeutralConfig, reconcileCustomVarKeys, THEME_PROPERTY_KEYS } from '../src/client/appearance/apply.ts'
import { DEFAULTS, GLASS_LEVELS, normalizeConfig, type CustomThemeConfig } from '../src/client/appearance/config.ts'
import { AppearanceSettingsController, type AppearanceScope } from '../src/client/appearance/controller.ts'
import { previewBar } from '../src/client/appearance/preview-bar.ts'
import { DEFAULT_SETTINGS, type SessionDeskSettings } from '../src/shared.ts'

interface StubStyle {
  setProperty(name: string, value: string): void
  removeProperty(name: string): void
  getPropertyValue(name: string): string
}

interface StubElement {
  id: string
  dataset: Record<string, string>
  textContent: string
  style: StubStyle
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  appendChild(child: StubElement): void
  remove(): void
}

function createStyleBag(): StubStyle {
  const props = new Map<string, string>()
  return {
    setProperty(name, value) { props.set(name, value) },
    removeProperty(name) { props.delete(name) },
    getPropertyValue(name) { return props.get(name) ?? '' },
  }
}

function installDocumentStub(): { html: StubElement; get: (id: string) => StubElement | null } {
  const nodes = new Map<string, StubElement>()
  const make = (id = ''): StubElement => {
    const attrs = new Map<string, string>()
    const style = createStyleBag()
    const el: StubElement = {
      id,
      dataset: {},
      textContent: '',
      style,
      getAttribute(name) { return attrs.get(name) ?? null },
      setAttribute(name, value) {
        attrs.set(name, value)
        if (name === 'id') {
          if (el.id) nodes.delete(el.id)
          el.id = value
          nodes.set(value, el)
        }
      },
      removeAttribute(name) { attrs.delete(name) },
      appendChild(child) {
        if (child.id) nodes.set(child.id, child)
      },
      remove() {
        if (el.id) nodes.delete(el.id)
      },
    }
    if (id) nodes.set(id, el)
    return el
  }
  const html = make()
  const head = make()
  const global = globalThis as typeof globalThis & { document?: unknown }
  global.document = {
    documentElement: html,
    head,
    getElementById(id: string) { return nodes.get(id) ?? null },
    createElement(tag: string) { return make(tag === 'style' ? '' : tag) },
  }
  return { html, get: (id) => nodes.get(id) ?? null }
}

function dropDocumentStub(): void {
  delete (globalThis as { document?: unknown }).document
}

describe('reconcileCustomVarKeys', () => {
  it('removes previously written keys that are absent from the next set', () => {
    const result = reconcileCustomVarKeys(['--foo', '--bar'], { '--bar': '2', '--baz': '3' })
    expect(result.toRemove.sort()).toEqual(['--foo'])
    expect(result.toWrite).toEqual({ '--bar': '2', '--baz': '3' })
    expect(result.kept.sort()).toEqual(['--bar', '--baz'])
  })

  it('clears every previously written key when resetting to empty vars', () => {
    const result = reconcileCustomVarKeys(['--foo', '--accent-extra'], {})
    expect(result.toRemove.sort()).toEqual(['--accent-extra', '--foo'])
    expect(result.toWrite).toEqual({})
    expect(result.kept).toEqual([])
  })

  it('lists the gated --dsd-* theme properties so a reset can strip them', () => {
    expect(THEME_PROPERTY_KEYS).toContain('--dsd-accent')
    expect(THEME_PROPERTY_KEYS).toContain('--dsd-wallpaper')
    expect(THEME_PROPERTY_KEYS).toContain('--dsd-gradient')
  })
})

describe('previewBar.exit', () => {
  it('hides the bar and restores the last saved theme', () => {
    const applied: string[] = []
    previewBar.setRestore(() => { applied.push('saved') })
    previewBar.show()
    expect(previewBar.getSnapshot()).toBe(true)
    previewBar.exit()
    expect(previewBar.getSnapshot()).toBe(false)
    expect(applied).toEqual(['saved'])
    previewBar.setRestore(undefined)
  })
})

describe('AppearanceSettingsController preview vs myPresets', () => {
  it('does not cancel an in-progress preview when only myPresets change', async () => {
    const doc: SessionDeskSettings = {
      ...DEFAULT_SETTINGS,
      accent: '#c2788f',
      gradient: 'linear-gradient(red, blue)',
      myPresets: {},
    }
    const scope: AppearanceScope = {
      get: () => doc,
      update: (patch) => {
        Object.assign(doc, patch)
      },
    }
    const applied: CustomThemeConfig[] = []
    const controller = new AppearanceSettingsController(scope, DEFAULTS, (config) => {
      applied.push(config)
    })
    controller.setField('accent', '#1e8f7e')
    controller.preview()
    expect(controller.getSnapshot().previewing).toBe(true)
    expect(previewBar.getSnapshot()).toBe(true)
    const painted = applied.at(-1)?.accent
    await controller.saveMyPreset('keep-preview')
    expect(controller.getSnapshot().previewing).toBe(true)
    expect(previewBar.getSnapshot()).toBe(true)
    expect(applied.at(-1)?.accent).toBe(painted)
    previewBar.exit()
    previewBar.setRestore(undefined)
  })

  it('applies neutrals when Reset runs during an in-progress preview', async () => {
    const doc: SessionDeskSettings = {
      ...DEFAULT_SETTINGS,
      accent: '#c2788f',
      gradient: 'linear-gradient(red, blue)',
    }
    const scope: AppearanceScope = {
      get: () => doc,
      update: (patch) => {
        Object.assign(doc, patch)
      },
    }
    const applied: CustomThemeConfig[] = []
    const controller = new AppearanceSettingsController(scope, DEFAULTS, (config) => {
      applied.push(config)
    })
    controller.setField('accent', '#1e8f7e')
    controller.preview()
    expect(applied.at(-1)?.accent).toBe('#1e8f7e')
    await controller.resetAll()
    expect(controller.getSnapshot().previewing).toBe(false)
    expect(previewBar.getSnapshot()).toBe(false)
    expect(applied.at(-1)?.accent).toBe(DEFAULTS.accent)
    expect(applied.at(-1)?.gradient).toBe(DEFAULTS.gradient)
    previewBar.setRestore(undefined)
  })
})

describe('isNeutralConfig wallpaperBlur and preset', () => {
  it('is false when wallpaperBlur or preset differs from defaults', () => {
    expect(isNeutralConfig(DEFAULTS)).toBe(true)
    expect(isNeutralConfig({ ...DEFAULTS, wallpaperBlur: 0 })).toBe(false)
    expect(isNeutralConfig({ ...DEFAULTS, preset: 'dusk' })).toBe(false)
  })
})

describe('applyConfig glass off blur', () => {
  afterEach(() => dropDocumentStub())

  it('writes --dsd-blur 0px when glass is off even if stored blur is 14', () => {
    const stub = installDocumentStub()
    const config = normalizeConfig({
      wallpaper: 'https://example.com/wall.png',
      glass: 'off',
      wallpaperBlur: 14,
    }, undefined)
    expect(config.wallpaperBlur).toBe(GLASS_LEVELS.off.blur)
    applyConfig(config)
    expect(stub.html.style.getPropertyValue('--dsd-blur')).toBe('0px')
  })
})

describe('appearance apply dispose', () => {
  afterEach(() => dropDocumentStub())

  it('clears data-dsd-active and theme style tags on effect cleanup', () => {
    const stub = installDocumentStub()
    const disposers: Array<() => void> = []
    const value: Partial<SessionDeskSettings> = {
      wallpaper: 'https://example.com/wall.png',
      glass: 'frosted',
      wallpaperBlur: 14,
    }
    apply({
      effect(fn) {
        const off = fn()
        if (typeof off === 'function') disposers.push(off)
      },
      locale: {
        register: () => () => {},
        bind: () => (key: string) => key,
      },
      slots: {
        inject() { return () => {} },
        register() { return {} },
      },
      settingsScope: {
        bind: () => ({
          getSnapshot: () => ({ value }),
          subscribe: () => () => {},
          set: async () => {},
          unset: async () => {},
        }),
      },
    })
    expect(stub.html.getAttribute('data-dsd-active')).toBe('1')
    expect(stub.get('dsh-session-desk-theme-style')).not.toBeNull()
    for (const off of disposers) off()
    expect(stub.html.getAttribute('data-dsd-active')).toBeNull()
    expect(stub.get('dsh-session-desk-theme-style')).toBeNull()
    expect(stub.html.style.getPropertyValue('--dsd-blur')).toBe('')
  })
})
