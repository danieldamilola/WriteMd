import { api } from '../api'
import type { ModelCapabilities } from '../../../shared/ai/model-options'
import {
  EMPTY_OPENCODE_AUTH,
  type OpenCodeAuthView,
  type OpenCodeModelView
} from '../../../shared/ai/opencode'

/** Account state comes from main; renderer stores no OAuth credentials. */
export class OpenCodeState {
  private static instance: OpenCodeState
  private value: OpenCodeAuthView = { ...EMPTY_OPENCODE_AUTH }
  private catalog: OpenCodeModelView[] = []
  private listeners = new Set<() => void>()
  private bridge: NonNullable<Window['electronAPI']>['ai']['opencode']
  private unsubscribe?: () => void
  private initializing: Promise<void> | null = null

  static getInstance(): OpenCodeState {
    return (this.instance ??= new OpenCodeState())
  }
  state(): OpenCodeAuthView {
    return this.value
  }
  label(model: string): string {
    return this.catalog.find((entry) => entry.id === model)?.label ?? model
  }
  capabilities(model: string): ModelCapabilities {
    return (
      this.catalog.find((entry) => entry.id === model)?.options ?? {
        reasoning: [],
        serviceTiers: []
      }
    )
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    void this.init()
    return () => this.listeners.delete(listener)
  }
  private notify(): void {
    for (const listener of this.listeners) listener()
  }
  apply = (state: OpenCodeAuthView): void => {
    if (state.connectionId !== this.value.connectionId || state.connected !== this.value.connected)
      this.catalog = []
    this.value = state
    this.notify()
  }
  init(): Promise<void> {
    const bridge = api()?.ai?.opencode
    if (bridge !== this.bridge) {
      this.unsubscribe?.()
      this.bridge = bridge
      this.initializing = null
      this.value = { ...EMPTY_OPENCODE_AUTH }
      this.catalog = []
      this.unsubscribe = bridge?.onChanged(this.apply)
    }
    return (this.initializing ??=
      bridge
        ?.state()
        .then((state) => {
          if (this.bridge === bridge) this.apply(state)
        })
        .catch(() => undefined) ?? Promise.resolve())
  }
  async models(): Promise<OpenCodeModelView[]> {
    const id = this.value.connectionId
    const catalog = await this.bridge?.models()
    if (!catalog || this.value.connectionId !== id) return []
    this.catalog = catalog
    this.notify()
    return catalog
  }
}
