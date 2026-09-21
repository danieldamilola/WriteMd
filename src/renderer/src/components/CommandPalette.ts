import { html, css, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { SettingsStore } from '../state/settings'
import { scrollbarStyles } from './scrollbars'
import { COMMANDS, effectiveBinding, formatBinding, fuzzyMatch } from '../state/shortcuts'

@customElement('writemd-command-palette')
export class CommandPalette extends LitElement {
  static styles = [
    scrollbarStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 400;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding-top: 12vh;
        background: rgba(0, 0, 0, 0.5);
      }
      .panel {
        width: min(560px, 92vw);
        background: #141414;
        border: 1px solid #2e2e32;
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        overflow: hidden;
      }
      input {
        width: 100%;
        box-sizing: border-box;
        background: transparent;
        border: none;
        border-bottom: 1px solid #2a2a2e;
        padding: 12px 16px;
        color: #e8e8e8;
        font-size: 14px;
        outline: none;
        font-family: inherit;
      }
      .list {
        max-height: 320px;
        overflow-y: auto;
        padding: 4px;
      }
      .item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-radius: 4px;
        cursor: pointer;
        color: #c9c9c9;
        font-size: 13px;
      }
      .item.selected {
        background: #2b2b2f;
        color: #ffffff;
      }
      .hint {
        color: #8a8a8a;
        font-size: 12px;
        font-family: var(--font-mono, monospace);
      }
      .empty {
        padding: 16px;
        color: #8a8a8a;
        font-size: 13px;
        text-align: center;
      }
    `
  ]

  @state() private query = ''
  @state() private selected = 0

  private settingsStore = SettingsStore.getInstance()

  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('click', this.handleBackdropClick)
  }

  disconnectedCallback(): void {
    this.removeEventListener('click', this.handleBackdropClick)
    super.disconnectedCallback()
  }

  firstUpdated(): void {
    this.shadowRoot?.querySelector('input')?.focus()
  }

  private handleBackdropClick = (e: MouseEvent): void => {
    if (e.target === this) this.close()
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  private get filtered(): typeof COMMANDS {
    return COMMANDS.filter((c) => fuzzyMatch(this.query, `${c.title} ${c.category}`))
  }

  private bindingLabel(id: string): string {
    const overrides = this.settingsStore.get<Record<string, string>>('shortcuts.bindings', {})
    const b = effectiveBinding(id, overrides)
    return b ? formatBinding(b) : ''
  }

  private run(id: string): void {
    this.dispatchEvent(
      new CustomEvent('run-command', { detail: { id }, bubbles: true, composed: true })
    )
  }

  private handleInput(e: InputEvent): void {
    this.query = (e.target as HTMLInputElement).value
    this.selected = 0
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const list = this.filtered
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      this.selected = Math.min(this.selected + 1, list.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      this.selected = Math.max(this.selected - 1, 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = list[this.selected]
      if (cmd) this.run(cmd.id)
    } else if (e.key === 'Escape') {
      this.close()
    }
  }

  render(): unknown {
    const list = this.filtered
    return html`
      <div
        class="panel"
        role="dialog"
        aria-modal="true"
        @click=${(e: MouseEvent) => e.stopPropagation()}
      >
        <input
          type="text"
          placeholder="Type a command..."
          .value=${this.query}
          @input=${this.handleInput}
          @keydown=${this.handleKeyDown}
        />
        <div class="list">
          ${
            list.length === 0
              ? html`<div class="empty">No matching commands</div>`
              : list.map(
                  (c, i) => html`
                    <div
                      class=${i === this.selected ? 'item selected' : 'item'}
                      @click=${() => this.run(c.id)}
                      @mousemove=${() => {
                        if (this.selected !== i) this.selected = i
                      }}
                    >
                      <span>${c.title}</span>
                      <span class="hint">${this.bindingLabel(c.id)}</span>
                    </div>
                  `
                )
          }
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-command-palette': CommandPalette
  }
}
