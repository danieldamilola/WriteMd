import type { ElectronAPI } from '../../../shared/electron-api'
import { DEFAULT_SETTINGS, type WriteMDSettings } from '../../../shared/settings-schema'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

export function applySettingsToDOM(store: SettingsStore): void {
  if (typeof document === 'undefined') return
  const theme = store.get('appearance.theme', 'dark')
  document.documentElement.setAttribute('data-theme', theme)

  const fontSize = store.get('editor.fontSize', 15)
  const lineHeight = store.get('editor.lineHeight', 1.7)
  const fontFamily = store.get('editor.fontFamily', 'JetBrains Mono')
  const accentColor = store.get('appearance.accentColor', '') as string

  const root = document.documentElement
  root.style.setProperty('--editor-font-size', `${fontSize}px`)
  root.style.setProperty('--editor-line-height', String(lineHeight))
  if (fontFamily) {
    root.style.setProperty('--font-mono', `'${fontFamily}', monospace`)
  }
  if (accentColor && accentColor !== '#ffffff') {
    root.style.setProperty('--accent', accentColor)
    root.style.setProperty('--accent-hover', accentColor)
    root.style.setProperty('--border-focus', accentColor)
  } else {
    // If monochrome is selected or default
    root.style.removeProperty('--accent')
    root.style.removeProperty('--accent-hover')
    root.style.removeProperty('--border-focus')

    // Fallback to monochrome for UI elements but keep syntax highlights
    root.style.setProperty('--accent', 'var(--text)')
    root.style.setProperty('--accent-hover', 'var(--text-secondary)')
    root.style.setProperty('--border-focus', 'var(--text)')
  }
}

export class SettingsStore {
  private static instance: SettingsStore
  private settings: WriteMDSettings = structuredClone(DEFAULT_SETTINGS)
  private listeners = new Map<string, Set<(value: unknown) => void>>()
  private initialized = false

  static getInstance(): SettingsStore {
    if (!SettingsStore.instance) {
      SettingsStore.instance = new SettingsStore()
    }
    return SettingsStore.instance
  }

  async init(): Promise<void> {
    if (this.initialized) return
    try {
      const loaded = (await api()?.settings?.get?.()) as WriteMDSettings | undefined
      this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(loaded ?? {}) }
    } catch {
      this.settings = structuredClone(DEFAULT_SETTINGS)
    }
    this.initialized = true
    applySettingsToDOM(this)
  }

  /** Reset to factory defaults and persist. */
  reset(): void {
    this.settings = structuredClone(DEFAULT_SETTINGS)
    void api()?.settings?.set?.(this.settings)
    applySettingsToDOM(this)
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
    void api()?.settings?.set?.(this.settings)
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
}
