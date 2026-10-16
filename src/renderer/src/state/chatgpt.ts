import { api } from '../api'
import {
  EMPTY_CHATGPT_AUTH,
  type ChatgptAuthView,
  type ChatgptModelView
} from '../../../shared/ai/chatgpt'

/** Account state comes from main; renderer stores no OAuth credentials. */
export class ChatgptState {
  private static instance: ChatgptState
  private value: ChatgptAuthView = { ...EMPTY_CHATGPT_AUTH }
  private catalog: ChatgptModelView[] = []
  private listeners = new Set<() => void>()
  private bridge: NonNullable<Window['electronAPI']>['ai']['chatgpt']
  private unsubscribe?: () => void
  private initializing: Promise<void> | null = null

  static getInstance(): ChatgptState {
    return (this.instance ??= new ChatgptState())
  }
  state(): ChatgptAuthView {
    return this.value
  }
  label(model: string): string {
    return this.catalog.find((entry) => entry.id === model)?.label ?? model
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    void this.init()
    return () => this.listeners.delete(listener)
  }
  private notify(): void {
    for (const listener of this.listeners) listener()
  }
  apply = (state: ChatgptAuthView): void => {
    if (state.activeId !== this.value.activeId || state.connected !== this.value.connected)
      this.catalog = []
    this.value = state
    this.notify()
  }
  init(): Promise<void> {
    const bridge = api()?.ai?.chatgpt
    if (bridge !== this.bridge) {
      this.unsubscribe?.()
      this.bridge = bridge
      this.initializing = null
      this.value = { ...EMPTY_CHATGPT_AUTH }
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
  async models(): Promise<ChatgptModelView[]> {
    const id = this.value.activeId
    const catalog = await this.bridge?.models()
    if (!catalog || this.value.activeId !== id || !this.value.connected) return []
    this.catalog = catalog
    this.notify()
    return catalog
  }
}
