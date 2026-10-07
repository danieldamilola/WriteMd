import { css, html, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { chromeIcon } from '../design/icons'

/**
 * One search field for the whole app. Two modes, one look:
 *
 * - Launcher (default): a button styled like a field. Clicking dispatches
 *   `search-activate`; owners open the command palette from it.
 * - Filter (`filter` set): a live input. Typing dispatches `search-query`
 *   with the text; keydown bubbles untouched so owners can keep their own
 *   Enter/arrow handling.
 */
@customElement('writemd-search-bar')
export class SearchBar extends LitElement {
  static styles = css`
    :host {
      display: flex;
      min-width: 0;
      flex: 1;
      font-family: var(--font-ui);
    }
    .field {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      background: var(--bg-hover);
      color: var(--text-secondary);
      font-size: 12px;
    }
    button.field {
      cursor: pointer;
      font-family: inherit;
    }
    button.field:hover {
      background: var(--bg-active);
      color: var(--text);
    }
    button.field:focus-visible,
    .field:focus-within {
      outline: none;
      border-color: var(--border-focus);
    }
    .field-text {
      flex: 1;
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .field input {
      flex: 1;
      min-width: 0;
      border: 0;
      background: transparent;
      padding: 0;
      color: var(--text);
      font-size: inherit;
      font-family: inherit;
      outline: none;
    }
    .field input::placeholder {
      color: var(--text-secondary);
    }
    kbd {
      font-family: inherit;
      font-size: 11px;
      color: var(--text-muted);
      flex-shrink: 0;
    }
  `

  @property({ type: String }) placeholder = 'Search'
  /** Shortcut hint chip, e.g. "Ctrl+K". Empty hides it. */
  @property({ type: String }) kbd = ''
  /** Filter mode renders a live input instead of a launcher button. */
  @property({ type: Boolean }) filter = false
  /** Controlled text for filter mode. */
  @property({ type: String }) value = ''
  @property({ type: String, attribute: 'aria-label' }) ariaLabel = 'Search'

  private activate(): void {
    this.dispatchEvent(new CustomEvent('search-activate', { bubbles: true, composed: true }))
  }

  private query(e: InputEvent): void {
    const query = (e.target as HTMLInputElement).value
    this.value = query
    this.dispatchEvent(
      new CustomEvent<{ query: string }>('search-query', {
        detail: { query },
        bubbles: true,
        composed: true
      })
    )
  }

  /**
   * Enter/arrows steer the owner's match list (settings does this). The raw
   * keydown keeps bubbling for anything else listening, but the default
   * (caret moves, selects change) is suppressed so stepping never fights it.
   */
  private navigate(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    this.dispatchEvent(
      new CustomEvent<{ key: string }>('search-navigate', {
        detail: { key: e.key },
        bubbles: true,
        composed: true
      })
    )
  }

  render(): unknown {
    if (this.filter) {
      return html`
        <div class="field">
          ${chromeIcon('search')}
          <input
            type="text"
            aria-label=${this.ariaLabel}
            placeholder=${this.placeholder}
            .value=${this.value}
            @input=${this.query}
            @keydown=${this.navigate}
          />
          ${this.kbd ? html`<kbd>${this.kbd}</kbd>` : ''}
        </div>
      `
    }
    return html`
      <button type="button" class="field" aria-label=${this.ariaLabel} @click=${this.activate}>
        ${chromeIcon('search')}<span class="field-text">${this.placeholder}</span>
        ${this.kbd ? html`<kbd>${this.kbd}</kbd>` : ''}
      </button>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-search-bar': SearchBar
  }
}
