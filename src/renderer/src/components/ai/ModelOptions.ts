import { css, html, LitElement, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SettingsStore } from '../../state/settings'
import { OpenCodeState } from '../../state/opencode'
import {
  modelCapabilities,
  modelPreference,
  modelPreferenceKey,
  validModelPreferences,
  REASONING_LABELS,
  SERVICE_TIER_LABELS,
  type ModelPreference
} from '../../../../shared/ai/model-options'
import { menuStyles } from '../menu-styles'
import { scrollbarStyles } from '../scrollbars'
import { icon } from '../icons'
import { chromeIcon } from '../../design/icons'
import '../Popover'

@customElement('writemd-ai-model-options')
export class AiModelOptions extends LitElement {
  @property({ type: Boolean }) disabled = false
  @property({ type: Boolean }) settingsMode = false
  @state() private open = false
  private settings = SettingsStore.getInstance()
  private opencode = OpenCodeState.getInstance()
  private unsubs: (() => void)[] = []
  private identity = ''
  static styles = [
    menuStyles,
    scrollbarStyles,
    css`
      :host {
        display: block;
        flex-shrink: 0;
        font: 12px var(--font-ui);
      }
      button {
        font: inherit;
        cursor: pointer;
        color: var(--text-secondary);
      }
      .trigger {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        border: 0;
        padding: 0 8px;
        border-radius: var(--radius-full);
        background: transparent;
      }
      .trigger:hover {
        background: var(--bg-hover);
        color: var(--text);
      }
      .trigger:disabled {
        opacity: 0.5;
        cursor: default;
      }
      button:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: -2px;
      }
      .m-panel {
        position: relative;
        width: 230px;
        max-width: calc(100vw - 16px);
        max-height: min(70vh, var(--auto-size-available-height, 70vh));
        overflow-y: auto;
        box-sizing: border-box;
      }
      h3 {
        margin: 0;
        padding: 9px 10px 5px;
        color: var(--text-muted);
        text-transform: uppercase;
        font-size: 10px;
        font-weight: 500;
        letter-spacing: 0.04em;
      }
      .m-item {
        background: transparent;
        border: 0;
        width: 100%;
        text-align: left;
        font: 12px var(--font-ui);
        min-height: 30px;
      }
      .m-item[aria-checked='true'] {
        color: var(--text);
        background: var(--bg-active);
      }
      .m-item span {
        flex: 1;
      }
      p {
        margin: 5px 10px 9px;
        color: var(--text-muted);
        font-size: 11px;
        line-height: 1.5;
      }
    `
  ]
  connectedCallback(): void {
    super.connectedCallback()
    this.identity = this.currentIdentity()
    this.unsubs = [
      this.settings.subscribe('ai', () => {
        const identity = this.currentIdentity()
        if (identity !== this.identity) {
          this.open = false
          this.identity = identity
        }
        this.requestUpdate()
      }),
      this.opencode.subscribe(() => this.requestUpdate())
    ]
  }
  disconnectedCallback(): void {
    this.unsubs.forEach((unsubscribe) => unsubscribe())
    super.disconnectedCallback()
  }
  private currentIdentity(): string {
    return JSON.stringify([
      this.settings.get<string>('ai.providerId', ''),
      this.settings.get<string>('ai.model', '')
    ])
  }
  protected updated(changed: PropertyValues): void {
    if (changed.has('disabled') && this.disabled) this.open = false
  }
  private select(field: keyof ModelPreference, value: string): void {
    if (this.disabled) return
    const provider = this.settings.get<string>('ai.providerId', '')
    const model = this.settings.get<string>('ai.model', '')
    const preferences = this.settings.get<unknown>('ai.modelPreferences', {})
    const entry = { ...modelPreference(preferences, provider, model), [field]: value }
    const next = {
      ...(validModelPreferences(preferences) ? preferences : {}),
      [modelPreferenceKey(provider, model)]: entry
    }
    if (validModelPreferences(next)) this.settings.set('ai.modelPreferences', next)
  }
  private keydown(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [
      ...(this.shadowRoot?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])
    ]
    if (!items.length) return
    event.preventDefault()
    const index = items.indexOf(this.shadowRoot?.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
    items[next]?.scrollIntoView?.({ block: 'nearest' })
  }
  render(): unknown {
    const provider = this.settings.get<string>('ai.providerId', '')
    const model = this.settings.get<string>('ai.model', '')
    const capabilities =
      provider === 'opencode'
        ? this.opencode.capabilities(model)
        : modelCapabilities(provider, model)
    const preference = modelPreference(
      this.settings.get('ai.modelPreferences', {}),
      provider,
      model
    )
    const supported = capabilities.reasoning.length || capabilities.serviceTiers.length
    if (!supported && !this.settingsMode) return null
    const reasoning =
      preference.reasoning !== 'auto' && capabilities.reasoning.includes(preference.reasoning)
        ? preference.reasoning
        : 'auto'
    const tier =
      preference.serviceTier !== 'auto' &&
      capabilities.serviceTiers.includes(preference.serviceTier)
        ? preference.serviceTier
        : 'auto'
    const label = reasoning === 'auto' ? 'Default' : REASONING_LABELS[reasoning]
    return html`<button
        class="trigger"
        aria-label="Model options"
        aria-haspopup="dialog"
        aria-expanded=${this.open}
        ?disabled=${this.disabled || !model}
        title="Reasoning and service tier for this model"
        @click=${() => {
          this.open = !this.open
        }}
      >
        ${chromeIcon('sliders', 14)}<span>${this.settingsMode ? 'Reasoning and service tier' : label}${tier === 'priority' ? ' · Fast' : ''}</span>${icon('chevron-down', 12)}
      </button>
      ${
        this.open && !this.disabled
          ? html`<writemd-popover
              .anchor=${this.shadowRoot?.querySelector<HTMLElement>('.trigger') ?? null}
              placement=${this.settingsMode ? 'bottom-end' : 'top-end'}
              label="Model options"
              @popover-dismiss=${() => {
                this.open = false
              }}
            >
              <div class="m-panel" @keydown=${this.keydown}>
                ${
                  capabilities.reasoning.length
                    ? html`<h3 id="reasoning-label">Reasoning</h3>
                        <div role="radiogroup" aria-labelledby="reasoning-label">
                          ${(['auto', ...capabilities.reasoning] as const).map((value) => html`<button class="m-item" role="radio" aria-checked=${reasoning === value} @click=${() => this.select('reasoning', value)}><span>${REASONING_LABELS[value]}</span>${reasoning === value ? icon('check', 14) : null}</button>`)}
                        </div>`
                    : html`<h3>Reasoning</h3>
                        <p>This model uses the provider's default reasoning.</p>`
                }
                <div class="m-divider"></div>
                ${
                  capabilities.serviceTiers.length
                    ? html`<h3 id="tier-label">Service tier</h3>
                        <div role="radiogroup" aria-labelledby="tier-label">
                          ${(['auto', ...capabilities.serviceTiers] as const).map((value) => html`<button class="m-item" role="radio" aria-checked=${tier === value} @click=${() => this.select('serviceTier', value)}><span>${SERVICE_TIER_LABELS[value]}</span>${tier === value ? icon('check', 14) : null}</button>`)}
                        </div>
                        <p>Fast availability and pricing depend on your provider.</p>`
                    : html`<h3>Service tier</h3>
                        <p>Managed by your provider.</p>`
                }
              </div></writemd-popover
            >`
          : null
      }`
  }
}
