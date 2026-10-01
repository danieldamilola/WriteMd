import { html, css, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { SettingsStore } from '../state/settings'

/**
 * The element that actually holds focus, descending through open shadow roots.
 * `document.activeElement` only reports the outermost host, and calling focus()
 * on that host does nothing, so focus would land back on body.
 */
import { scrollbarStyles } from './scrollbars'
import { COMMANDS, effectiveBinding, formatBinding, fuzzyMatch } from '../state/shortcuts'
import { deepActiveElement } from '../utils/links'

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
        background: var(--scrim, rgba(0, 0, 0, 0.5));
      }
      .panel {
        width: min(560px, 92vw);
        background: var(--bg-elevated);
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        box-shadow: var(--shadow-3);
        overflow: hidden;
      }
      input {
        width: 100%;
        box-sizing: border-box;
        background: transparent;
        border: none;
        border-bottom: 1px solid var(--border-subtle);
        padding: 12px 16px;
        color: var(--text);
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
        color: var(--text-secondary);
        font-size: 13px;
      }
      .item.selected {
        background: var(--bg-active);
        color: var(--text);
      }
      .hint {
        color: var(--text-muted);
        font-size: 12px;
        font-family: var(--font-mono, monospace);
      }
      .empty {
        padding: 16px;
        color: var(--text-muted);
        font-size: 13px;
        text-align: center;
      }
    `
  ]

  @state() private query = ''
  @state() private selected = 0

  private settingsStore = SettingsStore.getInstance()

  private previouslyFocused: HTMLElement | null = null

  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('click', this.handleBackdropClick)
    // Capture whatever opened the palette so focus can go back to it on close.
    this.previouslyFocused = deepActiveElement() as HTMLElement | null
  }

  disconnectedCallback(): void {
    this.removeEventListener('click', this.handleBackdropClick)
    super.disconnectedCallback()
  }

  firstUpdated(): void {
    this.shadowRoot?.querySelector('input')?.focus()
  }

  private close(): void {
    const target = this.previouslyFocused
    this.previouslyFocused = null
    // Restore after the event that dispatched this finishes, since the host
    // removes the palette during its own handler.
    queueMicrotask(() => {
      if (target?.isConnected) target.focus()
    })
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  private handleBackdropClick = (e: MouseEvent): void => {
    if (e.target === this) this.close()
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
      // Capture phase: App also listens for Escape on window, and a sibling
      // listener cannot be silenced with stopPropagation alone.
      e.stopImmediatePropagation()
      this.close()
    } else if (e.key === 'Tab') {
      // The input and the list are the only focusables, so trap rather than let
      // Tab walk into the document behind the dialog.
      e.preventDefault()
      this.shadowRoot?.querySelector('input')?.focus()
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
          role="combobox"
          aria-label="Search commands"
          aria-expanded="true"
          aria-controls="cmd-list"
          aria-activedescendant=${list[this.selected] ? `cmd-${this.selected}` : ''}
          autocomplete="off"
          placeholder="Type a command..."
          .value=${this.query}
          @input=${this.handleInput}
          @keydown=${this.handleKeyDown}
        />
        <div class="list" id="cmd-list" role="listbox" aria-label="Commands">
          ${
            list.length === 0
              ? html`<div class="empty">No matching commands</div>`
              : list.map(
                  (c, i) => html`
                    <div
                      id=${`cmd-${i}`}
                      role="option"
                      aria-selected=${i === this.selected ? 'true' : 'false'}
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
