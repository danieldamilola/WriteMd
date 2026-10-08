import { SettingsStore } from './settings'
import { api } from '../api'
import type { BackgroundAsset } from '../../../shared/electron-api'
import type { WriteMdSettings } from '../../../shared/settings-schema'

type Effect = WriteMdSettings['appearance']['backgroundEffect']

/** One image/effect cache shared by workspace, AI and settings previews. */
export class BackgroundStore {
  private static instance: BackgroundStore
  private settings = SettingsStore.getInstance()
  private listeners = new Set<() => void>()
  private asset: BackgroundAsset | null = null
  private cache = new Map<Effect, string>()
  private worker: Worker | null = null
  private revision = 0
  private initialized = false
  private requestedId: string | null = null
  private requestedEffect: Effect | null = null
  url = ''
  error = ''
  loading = false
  static getInstance(): BackgroundStore {
    return (this.instance ??= new BackgroundStore())
  }
  subscribe(callback: () => void): () => void {
    this.listeners.add(callback)
    if (!this.initialized) {
      this.initialized = true
      this.settings.subscribe('appearance', () => this.sync())
      this.sync()
    }
    return () => this.listeners.delete(callback)
  }
  private sync(): void {
    const id = this.settings.get('appearance.backgroundId', '')
    const effect = this.settings.get<Effect>('appearance.backgroundEffect', 'none')
    if (id !== this.requestedId) {
      this.requestedId = id
      this.requestedEffect = effect
      void this.load()
    } else if (effect !== this.requestedEffect) {
      this.requestedEffect = effect
      if (this.asset?.id === id) void this.process()
    }
  }
  private notify(): void {
    this.listeners.forEach((callback) => callback())
  }
  private clearCache(): void {
    this.worker?.terminate()
    this.worker = null
    for (const url of this.cache.values()) URL.revokeObjectURL(url)
    this.cache.clear()
  }
  private async load(): Promise<void> {
    const revision = ++this.revision
    const id = this.settings.get('appearance.backgroundId', '')
    this.error = ''
    this.clearCache()
    try {
      const asset = id ? ((await api()?.appearance?.getBackground(id)) ?? null) : null
      if (revision !== this.revision) return
      this.asset = asset
      this.url = asset?.url ?? ''
      if (id && !asset) this.error = 'Background image is unavailable. Choose another image.'
      this.notify()
      await this.process()
    } catch (error) {
      if (revision !== this.revision) return
      this.asset = null
      this.url = ''
      this.error = error instanceof Error ? error.message : 'Could not load background'
      this.notify()
    }
  }
  private async process(): Promise<void> {
    const revision = ++this.revision
    this.worker?.terminate()
    this.worker = null
    const effect = this.settings.get<Effect>('appearance.backgroundEffect', 'none')
    const source = this.asset?.url ?? ''
    this.loading = false
    if (!source || effect === 'none' || effect === 'haze') {
      this.url = source
      this.notify()
      return
    }
    const cached = this.cache.get(effect)
    if (cached) {
      this.url = cached
      this.notify()
      return
    }
    this.loading = true
    this.notify()
    try {
      const image = new Image()
      image.src = source
      await image.decode()
      const bitmap = await createImageBitmap(image)
      if (revision !== this.revision) {
        bitmap.close()
        return
      }
      const worker = new Worker(new URL('../workers/background-effects.ts', import.meta.url), {
        type: 'module'
      })
      this.worker = worker
      worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string }>) => {
        if (revision !== this.revision) return
        this.loading = false
        if (event.data.blob) {
          const url = URL.createObjectURL(event.data.blob)
          this.cache.set(effect, url)
          this.url = url
          this.error = ''
        } else this.error = event.data.error ?? 'Could not apply image effect'
        worker.terminate()
        this.worker = null
        this.notify()
      }
      worker.onerror = () => {
        if (revision !== this.revision) return
        this.loading = false
        this.error = 'Could not apply image effect'
        worker.terminate()
        this.worker = null
        this.notify()
      }
      worker.postMessage({ bitmap, effect }, [bitmap])
    } catch (error) {
      if (revision !== this.revision) return
      this.loading = false
      this.error = error instanceof Error ? error.message : 'Could not apply image effect'
      this.notify()
    }
  }
}
