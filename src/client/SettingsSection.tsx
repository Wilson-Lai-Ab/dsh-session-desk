/** Settings section: config-only tabs for sessions, trash, minimap/board, pet, appearance. */
import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, GLASS_LEVELS, HISTORY_POSITIONS, PET_SIZE_MAX, PET_SIZE_MIN, PET_THEME_IDS, clampPetSize, type GlassLevel, type HistoryPosition, type PetThemeId, type SessionDeskSettings } from '../shared.ts'
import { sanitizeWallpaperUrl } from '../sanitize.ts'
import { AppearanceSection } from './appearance/AppearanceSection.tsx'
import { applyConfig } from './appearance/apply.ts'
import type { SessionDeskKey } from './locales.ts'

type TabId = 'sessions' | 'trash' | 'minimap' | 'pet' | 'appearance'

interface Translator {
  (key: SessionDeskKey, vars?: Record<string, string | number>): string
}

export interface SessionDeskSectionProps {
  t?: Translator
  useScope?: <T>(select: (snapshot: { value: SessionDeskSettings }) => T) => T
  update?: (patch: Partial<SessionDeskSettings>) => Promise<void> | void
}

const styles = `
.dsd-page{display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.dsd-tabs{display:flex;flex-wrap:wrap;gap:6px}
.dsd-tabs button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:inherit;border-radius:999px;padding:4px 10px;cursor:pointer}
.dsd-tabs button[aria-selected="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.dsd-hint{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsd-error{padding:8px 10px;border-radius:8px;border:1px solid rgba(239,68,68,.45);color:#f87171;background:var(--dsw-alias-bg-layer-3)}
.dsd-field{display:flex;flex-direction:column;gap:5px}
.dsd-field input,.dsd-field select{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;background:var(--dsw-alias-bg-layer-2);color:inherit}
.dsd-group{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:8px 14px;background:var(--dsw-alias-bg-layer-3)}
.dsd-setting{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l2)}
.dsd-setting:first-child{border-top:none;padding-top:0}
.dsd-setting:last-child{padding-bottom:0}
.dsd-setting>span{flex:1;min-width:0}
.dsd-setting select,.dsd-setting input[type=number],.dsd-setting input[type=text],.dsd-setting input:not([type]){flex:0 1 230px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;background:var(--dsw-alias-bg-layer-2);color:inherit}
.dsd-setting input[type=checkbox]{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary)}
.dsd-setting button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;border-radius:8px;padding:5px 12px;cursor:pointer}
`

function fallbackT(key: SessionDeskKey, vars?: Record<string, string | number>): string {
  const table: Record<string, string> = {
    nav: '会话管理',
    'tab.sessions': '会话',
    'tab.trash': '废纸篓',
    'tab.minimap': '小地图与看板',
    'tab.pet': '小宠物',
    'tab.appearance': '外观',
    'tab.placeholder': '此栏将在后续版本提供。',
    'root.label': '会话根目录',
    'root.hint': '留空则使用环境变量或 ~/.dsh/sessions；更换根目录不会带走旧废纸篓。',
    'root.relative': '请填写绝对路径，或留空使用默认位置。',
    'root.empty': '留空则使用环境变量或 ~/.dsh/sessions',
    'retention.label': '废纸篓保留天数',
    'trash.glass': '废纸篓毛玻璃',
    'glass.off': '不透明',
    'glass.light': '轻玻璃',
    'glass.frosted': '毛玻璃',
    'glass.mica': 'Mica',
    'history.position': '小地图位置',
    'history.position.off': '关闭',
    'history.position.left': '左侧',
    'history.position.right': '右侧',
    'history.limit': '显示条数（0 为全部，最多 120）',
    'board.enabled': '在对话页显示看板 Tab',
    'pet.enabled': '显示小宠物',
    'pet.mode': '运行位置',
    'pet.mode.desktop': '桌面',
    'pet.mode.browser': '浏览器',
    'pet.theme': '宠物主题',
    'pet.theme.blue-whale': '蓝鲸',
    'pet.theme.orange-cat': '橘猫',
    'pet.theme.silver-shaded-cat': '银渐层猫',
    'pet.theme.dshpet': '大肥鱼',
    'pet.theme.custom': '自定义图片',
    'pet.size': '宠物宽度（px）',
    'pet.image': '形象 URL',
    'pet.imageHint': '留空使用内置蓝鲸。仅允许 http(s)、data:image 或同源路径。',
    'pet.reset': '重置位置',
  }
  let text = table[key] ?? key
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

function isRelativePath(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '~' || trimmed.startsWith('~/')) return false
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\')) return false
  return !trimmed.startsWith('/')
}

export function SettingsSection(props: SessionDeskSectionProps): ReactNode {
  const t = props.t ?? fallbackT
  const scoped = props.useScope ? props.useScope(snapshot => snapshot.value) : undefined
  const settings: SessionDeskSettings = { ...DEFAULT_SETTINGS, ...(scoped ?? {}) }

  const [tab, setTab] = useState<TabId>('sessions')
  const [rootDraft, setRootDraft] = useState(settings.sessionsRoot)
  const [retentionDraft, setRetentionDraft] = useState(String(settings.retentionDays))
  const [limitDraft, setLimitDraft] = useState(String(settings.historyLimit))
  const [petImageDraft, setPetImageDraft] = useState(settings.petImage)
  const [petSizeDraft, setPetSizeDraft] = useState(String(settings.petSize))
  const [error, setError] = useState('')

  useEffect(() => { setRootDraft(settings.sessionsRoot) }, [settings.sessionsRoot])
  useEffect(() => { setRetentionDraft(String(settings.retentionDays)) }, [settings.retentionDays])
  useEffect(() => { setLimitDraft(String(settings.historyLimit)) }, [settings.historyLimit])
  useEffect(() => { setPetImageDraft(settings.petImage) }, [settings.petImage])
  useEffect(() => { setPetSizeDraft(String(settings.petSize)) }, [settings.petSize])

  const persist = async (patch: Partial<SessionDeskSettings>): Promise<void> => {
    if (props.update) await props.update(patch)
  }

  const commitRoot = async (): Promise<void> => {
    if (isRelativePath(rootDraft)) {
      setRootDraft(settings.sessionsRoot)
      setError(t('root.relative'))
      return
    }
    setError('')
    await persist({ sessionsRoot: rootDraft.trim() })
  }

  const commitRetention = async (): Promise<void> => {
    const parsed = Number.parseInt(retentionDraft, 10)
    const next = Number.isFinite(parsed) ? Math.min(365, Math.max(1, parsed)) : settings.retentionDays
    setRetentionDraft(String(next))
    await persist({ retentionDays: next })
  }

  const commitLimit = async (): Promise<void> => {
    const parsed = Number.parseInt(limitDraft, 10)
    const next = Number.isFinite(parsed) ? Math.min(120, Math.max(0, parsed)) : settings.historyLimit
    setLimitDraft(String(next))
    await persist({ historyLimit: next })
  }

  const commitPetImage = async (): Promise<void> => {
    const trimmed = petImageDraft.trim()
    if (trimmed === '') {
      setPetImageDraft('')
      await persist({ petImage: '' })
      return
    }
    const safe = sanitizeWallpaperUrl(trimmed)
    if (safe === null) {
      setPetImageDraft(settings.petImage)
      return
    }
    setPetImageDraft(safe)
    await persist({ petImage: safe })
  }

  const commitPetSize = async (): Promise<void> => {
    const parsed = Number.parseInt(petSizeDraft, 10)
    const next = Number.isFinite(parsed) ? clampPetSize(parsed) : settings.petSize
    setPetSizeDraft(String(next))
    await persist({ petSize: next })
  }

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'sessions', label: t('tab.sessions') },
    { id: 'trash', label: t('tab.trash') },
    { id: 'minimap', label: t('tab.minimap') },
    { id: 'pet', label: t('tab.pet') },
    { id: 'appearance', label: t('tab.appearance') },
  ]

  return (
    <div className="dsd-page">
      <style>{styles}</style>
      <div className="dsd-tabs" role="tablist">
        {tabs.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error !== '' && <div className="dsd-error">{error}</div>}

      {tab === 'sessions' && (
        <section className="dsd-group">
          <label className="dsd-field">
            <span>{t('root.label')}</span>
            <input
              value={rootDraft}
              placeholder={t('root.empty')}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setRootDraft(event.target.value)}
              onBlur={() => { void commitRoot() }}
            />
            <span className="dsd-hint">{t('root.hint')}</span>
          </label>
        </section>
      )}

      {tab === 'trash' && (
        <section className="dsd-group">
          <label className="dsd-setting">
            <span>{t('retention.label')}</span>
            <input
              type="number"
              min={1}
              max={365}
              value={retentionDraft}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setRetentionDraft(event.target.value)}
              onBlur={() => { void commitRetention() }}
            />
          </label>
          <label className="dsd-setting">
            <span>{t('trash.glass')}</span>
            <select
              value={settings.trashGlass}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const next = event.target.value as GlassLevel
                if ((GLASS_LEVELS as readonly string[]).includes(next)) void persist({ trashGlass: next })
              }}
            >
              {(GLASS_LEVELS as readonly string[]).map(level => (
                <option key={level} value={level}>{t(`glass.${level}` as SessionDeskKey)}</option>
              ))}
            </select>
          </label>
        </section>
      )}

      {tab === 'minimap' && (
        <section className="dsd-group">
          <label className="dsd-setting">
            <span>{t('history.position')}</span>
            <select
              value={settings.historyPosition}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const next = event.target.value as HistoryPosition
                if ((HISTORY_POSITIONS as readonly string[]).includes(next)) void persist({ historyPosition: next })
              }}
            >
              <option value="right">{t('history.position.right')}</option>
              <option value="left">{t('history.position.left')}</option>
              <option value="off">{t('history.position.off')}</option>
            </select>
          </label>
          <label className="dsd-setting">
            <span>{t('history.limit')}</span>
            <input
              type="number"
              min={0}
              max={120}
              value={limitDraft}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setLimitDraft(event.target.value)}
              onBlur={() => { void commitLimit() }}
            />
          </label>
          <label className="dsd-setting">
            <span>{t('board.enabled')}</span>
            <input
              type="checkbox"
              checked={settings.boardTab}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                void persist({ boardTab: event.target.checked })
              }}
            />
          </label>
        </section>
      )}

      {tab === 'pet' && (
        <section className="dsd-group">
          <label className="dsd-setting">
            <span>{t('pet.enabled')}</span>
            <input
              type="checkbox"
              checked={settings.petEnabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                void persist({ petEnabled: event.target.checked })
              }}
            />
          </label>
          <label className="dsd-setting">
            <span>{t('pet.mode')}</span>
            <select
              value={settings.petDesktop ? 'desktop' : 'browser'}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const desktop = event.target.value === 'desktop'
                void persist({ petDesktop: desktop })
                void fetch('/session-desk/pet-desktop/' + (desktop ? 'spawn' : 'close'), {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'x-dsh-session-desk': '1' },
                  body: JSON.stringify(desktop ? {} : { petDesktop: false }),
                })
              }}
            >
              <option value="browser">{t('pet.mode.browser')}</option>
              <option value="desktop">{t('pet.mode.desktop')}</option>
            </select>
          </label>
          <label className="dsd-setting">
            <span>{t('pet.theme')}</span>
            <select
              value={settings.petTheme}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const next = event.target.value as PetThemeId
                if ((PET_THEME_IDS as readonly string[]).includes(next)) void persist({ petTheme: next })
              }}
            >
              {PET_THEME_IDS.map(id => (
                <option key={id} value={id}>{t(`pet.theme.${id}`)}</option>
              ))}
            </select>
          </label>
          <label className="dsd-setting">
            <span>{t('pet.size')}</span>
            <input
              type="number"
              min={PET_SIZE_MIN}
              max={PET_SIZE_MAX}
              value={petSizeDraft}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPetSizeDraft(event.target.value)}
              onBlur={() => { void commitPetSize() }}
            />
          </label>
          <label className="dsd-setting">
            <span>{t('pet.image')}</span>
            <input
              value={petImageDraft}
              placeholder={t('pet.imageHint')}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPetImageDraft(event.target.value)}
              onBlur={() => { void commitPetImage() }}
            />
          </label>
          <div className="dsd-hint">{t('pet.imageHint')}</div>
          <div className="dsd-setting">
            <span></span>
            <button
              type="button"
              onClick={() => { void persist({ petX: -1, petY: -1 }) }}
            >
              {t('pet.reset')}
            </button>
          </div>
        </section>
      )}

      {tab === 'appearance' && (
        <AppearanceSection
          t={t}
          settings={settings}
          update={persist}
          onPreview={applyConfig}
        />
      )}
    </div>
  )
}
