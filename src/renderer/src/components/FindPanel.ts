import { html, css, LitElement } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { EditorView } from '@codemirror/view'
import {
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel
} from '@codemirror/search'

@customElement('writemd-find-panel')
export class FindPanel extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 400;
      width: min(640px, 92vw);
    }
    .bar {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: var(--shadow-3);
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .field {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--bg-hover);
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 0 10px;
      height: 32px;
      min-width: 0;
    }
    .field:focus-within {
      border-color: var(--border-focus);
    }
    .field svg {
      width: 14px;
      height: 14px;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .field input {
      flex: 1;
      min-width: 0;
      background: transparent;
      border: none;
      outline: none;
      color: var(--text);
      font-size: 13px;
      font-family: inherit;
    }
    .field input::placeholder {
      color: var(--text-muted);
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 4px;
      color: var(--text-muted);
      cursor: pointer;
      flex-shrink: 0;
    }
    .btn:hover {
      background: var(--bg-active);
      color: var(--text);
    }
    .btn svg {
      width: 14px;
      height: 14px;
    }
  `

  @property({ attribute: false }) view: EditorView | null = null
  @property({ type: String }) mode: 'find' | 'replace' = 'find'
  @property({ type: String }) initialQuery = ''

  @state() private query = ''
  @state() private replaceText = ''

  connectedCallback(): void {
    super.connectedCallback()
    this.query = this.initialQuery
  }

  firstUpdated(): void {
    if (this.mode === 'replace') {
      this.shadowRoot?.querySelector<HTMLInputElement>('.replace-input')?.focus()
    } else {
      this.shadowRoot?.querySelector<HTMLInputElement>('.find-input')?.focus()
    }
    this.applyQuery()
  }

  private close(): void {
    if (this.view) closeSearchPanel(this.view)
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  private applyQuery(): void {
    if (!this.view) return
    // Include replaceText so doReplace actually replaces with the target string
    // Dispatch safely without stealing focus
    try {
      this.view.dispatch({ 
        effects: setSearchQuery.of(new SearchQuery({ search: this.query || '', replace: this.replaceText })) 
      })
    } catch (e) {
      console.error('Failed to apply search query', e)
    }
  }

  private handleQueryInput(e: Event): void {
    this.query = (e.target as HTMLInputElement).value
    this.applyQuery()
  }

  private handleQueryKey(e: KeyboardEvent): void {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      if (this.view) (e.shiftKey ? findPrevious : findNext)(this.view)
    } else if (e.key === 'Escape') {
      this.close()
    }
  }

  private handleReplaceKey(e: KeyboardEvent): void {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      this.doReplace()
    } else if (e.key === 'Escape') {
      this.close()
    }
  }

  private doFindPrevious(): void {
    if (!this.view) return
    this.applyQuery()
    findPrevious(this.view)
  }

  private doFindNext(): void {
    if (!this.view) return
    this.applyQuery()
    findNext(this.view)
  }

  private doReplace(): void {
    if (!this.view) return
    this.applyQuery()
    replaceNext(this.view)
  }

  private doReplaceAll(): void {
    if (!this.view) return
    this.applyQuery()
    replaceAll(this.view)
  }

  render(): unknown {
    return html`
      <div class="bar" @click=${(e: MouseEvent) => e.stopPropagation()}>
        <div class="row">
          <div class="field">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              class="find-input"
              placeholder="Find..."
              .value=${this.query}
              @input=${this.handleQueryInput}
              @keydown=${this.handleQueryKey}
            />
          </div>
          <div class="btn" title="Previous" @mousedown=${(e: MouseEvent) => e.preventDefault()} @click=${this.doFindPrevious}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </div>
          <div class="btn" title="Next" @mousedown=${(e: MouseEvent) => e.preventDefault()} @click=${this.doFindNext}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
          </div>
          <div
            class="btn"
            title="Toggle replace"
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${() => (this.mode = this.mode === 'find' ? 'replace' : 'find')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="14" y2="12" />
              <line x1="4" y1="17" x2="11" y2="17" />
            </svg>
          </div>
          <div class="btn" title="Close" @mousedown=${(e: MouseEvent) => e.preventDefault()} @click=${() => this.close()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
        </div>
        ${this.mode === 'replace'
          ? html`
              <div class="row">
                <div class="field">
                  <input
                    type="text"
                    class="replace-input"
                    placeholder="Replace..."
                    .value=${this.replaceText}
                    @input=${(e: InputEvent) => (this.replaceText = (e.target as HTMLInputElement).value)}
                    @keydown=${this.handleReplaceKey}
                  />
                </div>
                <div class="btn" title="Replace" @mousedown=${(e: MouseEvent) => e.preventDefault()} @click=${this.doReplace}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="17 1 21 5 17 9" />
                    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                    <polyline points="7 23 3 19 7 15" />
                    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                  </svg>
                </div>
                <div class="btn" title="Replace all" @mousedown=${(e: MouseEvent) => e.preventDefault()} @click=${this.doReplaceAll}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="17 1 21 5 17 9" />
                    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                    <line x1="3" y1="21" x2="21" y2="21" />
                  </svg>
                </div>
              </div>
            `
          : ''}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-find-panel': FindPanel
  }
}
