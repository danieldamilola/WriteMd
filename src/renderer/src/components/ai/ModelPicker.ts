import { OpenCodeState } from '../../state/opencode'
import { css, html, LitElement } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { api } from '../../api'
import { SettingsStore } from '../../state/settings'
import { ChatgptState } from '../../state/chatgpt'
import { icon } from '../icons'
import { chromeIcon } from '../../design/icons'
import { controlStyles } from '../../design/controls'
import { scrollbarStyles } from '../scrollbars'
import { providerIcon } from './provider-icons'
import { emit, on } from '../../events/bus'

@customElement('writemd-ai-model-picker')
export class AiModelPicker extends LitElement {
  @property({ type: Boolean }) disabled = false
  @state() private open = false
  @state() private loading = false
  @state() private error = ''
  @state() private search = ''
  @state() private menuLeft = 8
  @state() private menuBottom = 8
  @state() private below = false
  @state() private menuTop = 8
  @state() private menuWidth = 280
  @state() private menuHeight = 360
  private settings = SettingsStore.getInstance()
  private unsubscribe?: () => void
  private unsubscribeChatgpt?: () => void
  private chatgpt = ChatgptState.getInstance()
  private opencode = OpenCodeState.getInstance()
  private unsubscribeOpenCode?: () => void
  private request = 0
  private identity = ''
  private unsubscribeMenu?: () => void

  connectedCallback(): void {
    super.connectedCallback()
    this.unsubscribeMenu = on('menu:open', ({ owner }) => {
      if (owner !== this) this.open = false
    })
    this.unsubscribeChatgpt = this.chatgpt.subscribe(this.onConnectionChanged)
    this.unsubscribeOpenCode = this.opencode.subscribe(this.onConnectionChanged)
    this.identity = this.connectionIdentity()
    this.unsubscribe = this.settings.subscribe('ai', this.onConnectionChanged)
    document.addEventListener('pointerdown', this.onOutside)
    document.addEventListener('focusin', this.onOutside)
    window.addEventListener('resize', this.onResize)
  }

  disconnectedCallback(): void {
    this.unsubscribe?.()
    this.unsubscribeMenu?.()
    this.unsubscribeChatgpt?.()
    this.unsubscribeOpenCode?.()
    this.request++
    document.removeEventListener('pointerdown', this.onOutside)
    document.removeEventListener('focusin', this.onOutside)
    window.removeEventListener('resize', this.onResize)
    super.disconnectedCallback()
  }

  private onConnectionChanged = (): void => {
    const identity = this.connectionIdentity()
    if (identity !== this.identity) {
      this.identity = identity
      this.request++
      this.loading = false
      this.error = ''
      this.open = false
      this.settings.set('ai.cachedModels', [])
    }
    this.requestUpdate()
  }

  private modelLabel(model: string): string {
    const provider = this.settings.get<string>('ai.providerId', '')
    return provider === 'chatgpt'
      ? this.chatgpt.label(model)
      : provider === 'opencode'
        ? this.opencode.label(model)
        : model
  }

  private connectionIdentity(): string {
    return JSON.stringify([
      this.settings.get('ai.providerId', ''),
      this.settings.get('ai.baseUrl', ''),
      this.settings.get('ai.apiKeySet', false),
      this.settings.get<string>('ai.providerId', '') === 'opencode'
        ? [this.opencode.state().connectionId, this.opencode.state().connected]
        : null,
      this.settings.get<string>('ai.providerId', '') === 'chatgpt'
        ? [this.chatgpt.state().activeId, this.chatgpt.state().connected]
        : null
    ])
  }

  private onOutside = (event: Event): void => {
    if (!event.composedPath().includes(this)) this.open = false
  }

  private close(): void {
    this.open = false
    this.shadowRoot?.querySelector<HTMLButtonElement>('.trigger')?.focus()
  }

  private onResize = (): void => {
    if (this.open) this.positionMenu()
  }

  private positionMenu(): void {
    const trigger = this.shadowRoot?.querySelector('.trigger')
    if (!trigger) return
    const bounds = trigger.getBoundingClientRect()
    const width = document.documentElement.clientWidth || window.innerWidth
    const height = document.documentElement.clientHeight || window.innerHeight
    this.menuWidth = Math.min(280, Math.max(0, width - 16))
    this.menuLeft = Math.max(8, Math.min(bounds.left, width - this.menuWidth - 8))
    const above = Math.max(0, bounds.top - 16)
    const below = Math.max(0, height - bounds.bottom - 16)
    this.below = below > above
    this.menuBottom = Math.max(8, height - bounds.top + 8)
    this.menuTop = Math.max(8, bounds.bottom + 8)
    this.menuHeight = Math.min(360, this.below ? below : above)
  }

  private async toggle(): Promise<void> {
    if (this.disabled) return
    this.open = !this.open
    this.search = ''
    if (!this.open) return
    emit('menu:open', { owner: this })
    this.positionMenu()
    // Keys can change without changing apiKeySet. Refresh on opening so the
    // cached list cannot keep showing another key's available models.
    void this.fetchModels()
    await this.updateComplete
    this.shadowRoot?.querySelector<HTMLElement>('.menu')?.showPopover?.()
    this.shadowRoot?.querySelector<HTMLInputElement>('input')?.focus()
  }

  private async fetchModels(): Promise<void> {
    if (this.loading || this.disabled) return
    const token = ++this.request
    // The request counter alone cannot spot a sign-out or account switch, which
    // does not call fetchModels. Capturing the account keeps a late reply for the
    // previous account from writing its catalogue into settings.
    const identity = this.connectionIdentity()
    this.loading = true
    this.error = ''
    try {
      const fetch = api()?.ai?.fetchModels
      if (!fetch) throw new Error('Model discovery is unavailable.')
      const chatgpt = this.settings.get<string>('ai.providerId', '') === 'chatgpt'
      const models = chatgpt
        ? (await this.chatgpt.models()).map((model) => model.id)
        : this.settings.get<string>('ai.providerId', '') === 'opencode'
          ? (await this.opencode.models()).map((model) => model.id)
          : await fetch(
              this.settings.get('ai.providerId', 'openai'),
              this.settings.get('ai.baseUrl', ''),
              ''
            )
      if (token !== this.request || this.connectionIdentity() !== identity) return
      this.settings.set(
        'ai.cachedModels',
        // A key-based catalogue is an unordered set of ids, so it is trimmed,
        // deduped and sorted. The account catalogue arrives in the order the
        // account lists it, which is curated, and re-sorting would bury the
        // model the plan is built around. Main already filtered and deduped it.
        chatgpt
          ? [...new Set(models)]
          : [...new Set(models.map((model) => model.trim()).filter(Boolean))].sort()
      )
      if (!models.length) this.error = 'No models returned. Check your provider in Settings.'
    } catch (error) {
      if (token === this.request)
        this.error = error instanceof Error ? error.message : String(error)
    } finally {
      if (token === this.request) this.loading = false
    }
  }

  private choose(model: string): void {
    if (this.disabled) return
    this.settings.set('ai.model', model)
    this.close()
  }

  protected updated(): void {
    if (this.disabled && this.open) this.open = false
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.close()
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [
      ...(this.shadowRoot?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
    ]
    if (!items.length) return
    const active = this.shadowRoot?.activeElement
    if ((event.key === 'Home' || event.key === 'End') && active?.tagName === 'INPUT') return
    event.preventDefault()
    const index = items.indexOf(active as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : index < 0
            ? event.key === 'ArrowDown'
              ? 0
              : items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
    items[next]?.scrollIntoView?.({ block: 'nearest' })
  }

  render(): unknown {
    const current = this.settings.get('ai.model', '')
    const cached = this.settings.get<string[]>('ai.cachedModels', [])
    const models = [...new Set([...(current ? [current] : []), ...cached])].filter((model) =>
      `${model} ${this.modelLabel(model)}`.toLowerCase().includes(this.search.toLowerCase())
    )
    return html`
      <button
        class="trigger"
        title=${current || 'Choose a model'}
        aria-label="Choose AI model"
        aria-haspopup="dialog"
        aria-expanded=${this.open && !this.disabled}
        ?disabled=${this.disabled}
        @click=${this.toggle}
      >
        ${providerIcon(this.settings.get<string>('ai.providerId', ''), 14)}
        <span>${this.modelLabel(current) || 'Choose model'}</span>${icon('chevron-down', 12)}
      </button>
      ${
        this.open && !this.disabled
          ? html` <section
              class="menu"
              popover="manual"
              role="dialog"
              aria-label="Choose AI model"
              style=${`left: ${this.menuLeft}px; ${this.below ? `top: ${this.menuTop}px` : `bottom: ${this.menuBottom}px`}; width: ${this.menuWidth}px; max-height: ${this.menuHeight}px;`}
              @keydown=${this.onKeyDown}
            >
              <div class="heading">
                <span>Model</span
                ><button
                  class="refresh"
                  aria-label="Refresh models"
                  title="Refresh models from your provider"
                  ?disabled=${this.loading}
                  @click=${this.fetchModels}
                >
                  ${chromeIcon('refresh', 16)}
                </button>
              </div>
              <input
                aria-label="Search models"
                placeholder="Search models…"
                .value=${this.search}
                @input=${(event: Event) => {
                  this.search = (event.target as HTMLInputElement).value
                }}
              />
              ${this.loading ? html`<p role="status">Loading available models…</p>` : null}
              ${
                this.error
                  ? html`<p role="alert">${this.error}</p>
                      <button class="retry" @click=${this.fetchModels}>Try again</button>`
                  : null
              }
              <div class="models" role="listbox" aria-label="Available models">
                ${models.map(
                  (model) =>
                    html`<button
                      role="option"
                      aria-selected=${model === current}
                      title=${model}
                      @click=${() => this.choose(model)}
                    >
                      ${providerIcon(this.settings.get<string>('ai.providerId', ''), 14)}
                      <span>${this.modelLabel(model)}</span>
                      ${model === current ? icon('check', 16) : null}
                    </button>`
                )}
              </div>
              ${!models.length && !this.loading && !this.error ? html`<p>No matching models.</p>` : null}
              ${current && !cached.includes(current) ? html`<p>Your configured model stays available until you choose another.</p>` : null}
            </section>`
          : null
      }
    `
  }

  static styles = [
    scrollbarStyles,
    controlStyles,
    css`
      :host {
        display: block;
        position: relative;
        min-width: 0;
        font: 12px var(--font-ui);
      }
      button,
      input {
        font: inherit;
        color: var(--text-secondary);
      }
      button {
        border: 0;
        cursor: pointer;
        background: transparent;
        border-radius: var(--radius-sm);
      }
      button:hover:not(:disabled) {
        background: var(--bg-hover);
        color: var(--text);
      }
      button:focus-visible,
      input:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: 2px;
      }
      button:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .trigger {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        height: 28px;
        border-radius: var(--radius-full);
        padding: 0 8px;
      }
      .trigger span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      svg {
        flex-shrink: 0;
      }
      .menu {
        position: fixed;
        inset: auto;
        margin: 0;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        padding: 4px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--menu-bg);
        box-shadow: var(--shadow-3);
        z-index: 20;
        overflow-y: auto;
      }
      .heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 6px 8px;
        font-weight: 500;
        color: var(--text);
      }
      .refresh {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border-radius: var(--radius-full);
      }
      input {
        width: 100%;
        box-sizing: border-box;
        padding: 8px;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        flex-shrink: 0;
      }
      .models {
        max-height: min(220px, 35vh);
        min-height: 36px;
        overflow-y: auto;
        margin-top: 8px;
      }
      .models button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        text-align: left;
        padding: 6px 10px;
        font-size: 13px;
        border-radius: var(--radius-md);
      }
      .models span {
        overflow-wrap: anywhere;
        min-width: 0;
      }
      .models button > span:not([data-provider-icon]) {
        flex: 1;
      }
      [aria-selected='true'] {
        background: var(--bg-active);
        color: var(--text);
      }
      p {
        font-size: 11px;
        line-height: 1.5;
        color: var(--text-muted);
        margin: 8px 4px;
        overflow-wrap: anywhere;
      }
      [role='alert'] {
        color: var(--danger);
      }
      .retry {
        padding: 4px 8px;
        text-decoration: underline;
      }
    `
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-ai-model-picker': AiModelPicker
  }
}
