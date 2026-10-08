import { api } from '../api'
import { DEFAULT_SETTINGS, type WriteMdSettings } from '../../../shared/settings-schema'
import { migrateDesign } from '../../../shared/design-migration'

export function applySettingsToDOM(store: SettingsStore): void {
  if (typeof document === 'undefined') return
  const theme = store.get<string>('appearance.theme', 'graphite')
  document.documentElement.setAttribute('data-theme', theme)
  const orientation = store.get('appearance.panelOrientation', 'vertical')
  document.documentElement.setAttribute('data-panel-orientation', orientation as string)

  const fontSize = store.get('editor.fontSize', 15)
  const lineHeight = store.get('editor.lineHeight', 1.7)
  const fontFamily = store.get('editor.fontFamily', 'JetBrains Mono')
  const accentColor = store.get('appearance.accentColor', '#f24e1e') as string

  const root = document.documentElement
  const light =
    theme === 'light' ||
    theme === 'paper' ||
    (theme === 'system' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: light)').matches)
  root.dataset.colorScheme = light ? 'light' : 'dark'
  root.style.setProperty('--theme-hue', String(store.get('appearance.themeHue', 240)))
  root.style.setProperty('--theme-saturation', `${store.get('appearance.themeSaturation', 0)}%`)
  root.style.setProperty(
    '--theme-dark-lightness',
    `${store.get('appearance.themeDarkLightness', 9)}%`
  )
  root.style.setProperty('--shell-sidebar-width', `${store.get('appearance.railWidth', 208)}px`)
  root.style.setProperty('--surface-opacity', String(store.get('appearance.surfaceOpacity', 100)))
  root.style.setProperty('--background-blur', `${store.get('appearance.backgroundBlur', 12)}px`)
  root.style.setProperty(
    '--surface-blur',
    store.get('appearance.surfaceOpacity', 100) < 100 ? '8px' : '0px'
  )
  root.dataset.windowMaterial = store.materialSupported
    ? store.get('appearance.windowMaterial', 'none')
    : 'none'
  root.style.setProperty('--editor-font-size', `${fontSize}px`)
  root.style.setProperty('--editor-line-height', String(lineHeight))
  if (fontFamily) {
    root.style.setProperty('--font-mono', `'${fontFamily}', monospace`)
  }
  if (accentColor && accentColor !== '#ffffff') {
    root.style.setProperty('--accent', accentColor)
    root.style.setProperty('--accent-hover', accentColor)
    root.style.setProperty('--border-focus', accentColor)
    const rgb = /^#[0-9a-f]{6}$/i.test(accentColor)
      ? [1, 3, 5].map((offset) => parseInt(accentColor.slice(offset, offset + 2), 16) / 255)
      : [0, 0, 0]
    const linear = rgb.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    )
    const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    root.style.setProperty(
      '--accent-text',
      luminance > 0.179 ? 'var(--accent-ink-dark)' : 'var(--accent-ink-light)'
    )
  } else {
    // If monochrome is selected or default
    root.style.removeProperty('--accent')
    root.style.removeProperty('--accent-hover')
    root.style.removeProperty('--border-focus')

    // Fallback to monochrome for UI elements but keep syntax highlights
    root.style.setProperty('--accent', 'var(--text)')
    root.style.setProperty('--accent-hover', 'var(--text-secondary)')
    root.style.setProperty('--border-focus', 'var(--text)')
    root.style.setProperty('--accent-text', 'var(--bg-elevated)')
  }
}

export class SettingsStore {
  private static instance: SettingsStore
  private settings: WriteMdSettings = structuredClone(DEFAULT_SETTINGS)
  private listeners = new Map<string, Set<(value: unknown) => void>>()
  private initialized = false
  materialSupported = false
  saveStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle'
  saveError = ''
  private saveListeners = new Set<() => void>()
  private saving: Promise<void> | null = null
  private pending: WriteMdSettings | null = null

  static getInstance(): SettingsStore {
    if (!SettingsStore.instance) {
      SettingsStore.instance = new SettingsStore()
    }
    return SettingsStore.instance
  }

  async init(): Promise<void> {
    if (this.initialized) return
    try {
      const raw = (await api()?.settings?.get?.()) as WriteMdSettings | undefined
      const loaded = raw
        ? (migrateDesign(raw as unknown as Record<string, unknown>) as unknown as WriteMdSettings)
        : undefined
      this.settings = structuredClone(DEFAULT_SETTINGS)
      if (loaded)
        for (const section of Object.keys(this.settings) as (keyof WriteMdSettings)[]) {
          const values = loaded[section]
          if (values && typeof values === 'object' && !Array.isArray(values))
            Object.assign(this.settings[section], values)
        }
    } catch {
      this.settings = structuredClone(DEFAULT_SETTINGS)
    }
    try {
      this.materialSupported = (await api()?.appearance?.materialSupport())?.supported ?? false
    } catch {
      this.materialSupported = false
    }
    this.initialized = true
    applySettingsToDOM(this)
    for (const key of this.listeners.keys()) this.notifyExact(key)
  }

  /** Reset to factory defaults and persist. */
  reset(): void {
    this.settings = structuredClone(DEFAULT_SETTINGS)
    applySettingsToDOM(this)
    for (const key of this.listeners.keys()) this.notifyExact(key)
    this.persist()
  }

  get<T>(key: string, defaultValue: T): T {
    let value: unknown = this.settings
    for (const k of key.split('.')) {
      if (value == null || typeof value !== 'object') return defaultValue
      value = (value as Record<string, unknown>)[k]
      if (value === undefined) return defaultValue
    }
    return value as T
  }

  set(key: string, value: unknown): void {
    const keys = key.split('.')
    let target = this.settings as unknown as Record<string, unknown>
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]
      const next = target[k]
      if (!next || typeof next !== 'object') {
        target[k] = {}
      }
      target = target[k] as Record<string, unknown>
    }
    target[keys[keys.length - 1]] = value
    this.notify(key, value)
    applySettingsToDOM(this)
    this.persist()
  }

  /**
   * Push the whole settings object to the main process.
   *
   * The rejection is caught and logged rather than left floating: `settings:set`
   * rethrows on a write failure, so an unhandled one surfaced as an unhandled
   * rejection in the renderer while the UI carried on as though the save had
   * landed. Nothing here can recover from it, but it should not be silent either.
   */
  private persist(): void {
    this.pending = structuredClone(this.settings)
    this.saveStatus = 'saving'
    this.saveError = ''
    this.saveListeners.forEach((listener) => listener())
    this.drain()
  }

  private drain(): void {
    if (this.saving || !this.pending) return
    this.saveStatus = 'saving'
    const snapshot = this.pending
    this.pending = null
    this.saving = Promise.resolve()
      .then(() => api()?.settings?.set?.(snapshot))
      .then(() => {
        this.saveStatus = 'saved'
      })
      .catch((error: unknown) => {
        this.saveStatus = 'error'
        this.saveError = error instanceof Error ? error.message : 'Settings could not be saved'
        console.error('Failed to persist settings:', error)
      })
      .finally(() => {
        this.saving = null
        this.saveListeners.forEach((listener) => listener())
        this.drain()
      })
  }

  subscribeSaveStatus(listener: () => void): () => void {
    this.saveListeners.add(listener)
    return () => this.saveListeners.delete(listener)
  }

  retrySave(): void {
    this.persist()
  }

  async whenSaved(): Promise<boolean> {
    while (this.saving) await this.saving
    return this.saveStatus !== 'error'
  }

  subscribe(key: string, callback: (value: unknown) => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }
    this.listeners.get(key)!.add(callback)
    return () => {
      this.listeners.get(key)?.delete(callback)
    }
  }

  private notify(key: string, value: unknown): void {
    this.listeners.get(key)?.forEach((cb) => cb(value))
    const prefix = key.split('.')[0]
    if (prefix !== key) {
      this.listeners.get(prefix)?.forEach((cb) => cb(this.get(prefix, undefined)))
    }
  }

  private notifyExact(key: string): void {
    const value = this.get(key, undefined)
    this.listeners.get(key)?.forEach((callback) => callback(value))
  }

  /** Apply a compound operation with one persistence request and one notification per key. */
  setMany(values: Record<string, unknown>, persist = true): void {
    const changed = new Set<string>()
    for (const [key, value] of Object.entries(values)) {
      const keys = key.split('.')
      let target = this.settings as unknown as Record<string, unknown>
      for (const part of keys.slice(0, -1)) {
        target = target[part] as Record<string, unknown>
      }
      target[keys[keys.length - 1]] = value
      changed.add(key)
      changed.add(keys[0])
    }
    applySettingsToDOM(this)
    for (const key of changed) this.notifyExact(key)
    if (persist) this.persist()
  }
}
