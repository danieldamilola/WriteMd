import { html, css, LitElement } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { EditorView } from '@codemirror/view'
import {
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
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
      z-index: 400;
      width: min(440px, calc(100% - 32px));
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
    .field input::selection {
      background: var(--selection, rgba(120, 140, 180, 0.4));
    }
    .match-count {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
      min-width: 0;
    }
    .match-count.zero {
      color: var(--danger, #e06c75);
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
      background: transparent;
      border: none;
      padding: 0;
      font: inherit;
    }
    .btn:hover {
      background: var(--bg-active);
      color: var(--text);
    }
    .btn:focus-visible {
      outline: 1px solid var(--border-focus);
      outline-offset: -1px;
    }
    .btn:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .btn svg {
      width: 14px;
      height: 14px;
    }
    .btn.active {
      color: var(--accent, var(--text));
    }
    .btn.toggle {
      color: var(--text-muted);
    }
    .toggle-spacer {
      width: 28px;
      flex-shrink: 0;
    }
  `

  @property({ attribute: false }) view: EditorView | null = null
  @property({ type: String }) mode: 'find' | 'replace' = 'find'
  @property({ type: String }) initialQuery = ''
  @property({ type: Boolean }) initialWholeWord = false
  @property({ type: Boolean }) initialCaseSensitive = false
  @property({ type: Boolean }) initialRegex = false

  @state() private query = ''
  @state() private replaceText = ''
  @state() private matchIndex = 0
  @state() private matchTotal = 0
  @state() private queryValid = true
  @state() private pendingFlags: Partial<{
    wholeWord: boolean
    caseSensitive: boolean
    regexp: boolean
  }> = {}

  connectedCallback(): void {
    super.connectedCallback()
    this.query = this.initialQuery
    this.pendingFlags = {
      wholeWord: this.initialWholeWord,
      caseSensitive: this.initialCaseSensitive,
      regexp: this.initialRegex
    }
  }

  firstUpdated(): void {
    // The built-in CodeMirror search panel must never show: we render our own.
    // findNext/findPrevious open it when the query is invalid, so all nav
    // paths below guard on hasValidQuery().
    if (this.view) closeSearchPanel(this.view)
    this.focusFindInput()
    this.applyQuery(true)
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('view') && this.view) {
      this.applyQuery(false)
    }
    if (changedProperties.has('initialQuery') && this.initialQuery !== this.query) {
      this.query = this.initialQuery
      this.applyQuery(false)
    }
  }

  /** Reseed the query when the panel is already open (e.g. second Ctrl+F). */
  setQuery(q: string): void {
    if (q === this.query) {
      this.applyQuery(false)
      return
    }
    this.query = q
    this.applyQuery(false)
    this.requestUpdate()
  }

  /** Bring the panel back to the front and focus the find input. */
  focusPanel(): void {
    this.focusFindInput()
  }

  private focusFindInput(select = true): void {
    const input = this.shadowRoot?.querySelector<HTMLInputElement>('.find-input')
    input?.focus()
    if (select) input?.select()
  }

  private close(): void {
    const flags = this.view ? this.currentFlags() : null
    if (this.view) closeSearchPanel(this.view)
    this.dispatchEvent(
      new CustomEvent('close', {
        detail: flags ?? undefined,
        bubbles: true,
        composed: true
      })
    )
    this.view?.focus()
  }

  private hasValidQuery(): boolean {
    if (!this.view) return false
    const q = getSearchQuery(this.view.state)
    return !!q && q.valid && q.search.length > 0
  }

  private currentFlags(): { wholeWord: boolean; caseSensitive: boolean; regexp: boolean } {
    const query = this.view ? getSearchQuery(this.view.state) : null
    return {
      wholeWord: query?.wholeWord ?? false,
      caseSensitive: query?.caseSensitive ?? false,
      regexp: query?.regexp ?? false
    }
  }

  private applyQuery(selectInitialMatch = false): void {
    if (!this.view) return
    // Initial (seeded) flags apply only to the first dispatch, so reopening
    // the panel doesn't reset the user's in-session toggles.
    const seeded = this.pendingFlags
    this.pendingFlags = {}
    const current = this.currentFlags()
    const query = new SearchQuery({
      search: this.query || '',
      replace: this.replaceText,
      wholeWord: seeded.wholeWord ?? current.wholeWord,
      caseSensitive: seeded.caseSensitive ?? current.caseSensitive,
      regexp: seeded.regexp ?? current.regexp
    })
    // Rebuilding the query keeps the editor's SearchPanel in sync even when
    // the panel is closed, so the next open starts from the right state.
    try {
      this.view.dispatch({ effects: setSearchQuery.of(query) })
      this.updateMatchCount(query)
      if (selectInitialMatch && query.valid && query.search) {
        findNext(this.view)
      }
    } catch (e) {
      console.error('Failed to apply search query', e)
    }
  }

  private updateMatchCount(query: SearchQuery): void {
    if (!this.view) return
    this.queryValid = query.valid
    if (!query.valid || !query.search) {
      this.matchIndex = 0
      this.matchTotal = 0
      return
    }
    const { from } = this.view.state.selection.main
    let total = 0
    let index = 0
    let found = false
    const cursor = query.getCursor(this.view.state, 0)
    let next = cursor.next()
    while (!next.done) {
      total += 1
      if (!found && next.value.from >= from) {
        index = total
        found = true
      }
      next = cursor.next()
    }
    // Cursor past the last match: next search wraps, so show the first.
    if (total > 0 && !found) index = 1
    this.matchTotal = total
    this.matchIndex = total === 0 ? 0 : index
  }

  private setFlag(flag: 'wholeWord' | 'caseSensitive' | 'regexp', value: boolean): void {
    if (!this.view) return
    const current = this.currentFlags()
    this.view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: this.query || '',
          replace: this.replaceText,
          wholeWord: flag === 'wholeWord' ? value : current.wholeWord,
          caseSensitive: flag === 'caseSensitive' ? value : current.caseSensitive,
          regexp: flag === 'regexp' ? value : current.regexp
        })
      )
    })
    this.refreshCounts()
    this.focusFindInput(false)
  }

  /** Refresh counts after navigation/replace operations move the cursor. */
  refreshCounts(): void {
    if (!this.view) return
    const query = getSearchQuery(this.view.state)
    if (query) this.updateMatchCount(query)
  }

  private handleQueryInput(e: Event): void {
    this.query = (e.target as HTMLInputElement).value
    this.applyQuery()
  }

  private handleReplaceInput(e: Event): void {
    this.replaceText = (e.target as HTMLInputElement).value
    this.applyQuery()
  }

  private handleQueryKey(e: KeyboardEvent): void {
    e.stopPropagation()
    if (this.handleFlagShortcut(e)) return
    if (e.key === 'Enter') {
      e.preventDefault()
      this.dispatchEvent(
        new CustomEvent(e.shiftKey ? 'find-previous' : 'find-next', {
          bubbles: true,
          composed: true
        })
      )
    } else if (e.key === 'Escape') {
      this.close()
    }
  }

  private handleReplaceKey(e: KeyboardEvent): void {
    e.stopPropagation()
    if (this.handleFlagShortcut(e)) return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        this.dispatchEvent(new CustomEvent('replace-all', { bubbles: true, composed: true }))
      } else {
        this.dispatchEvent(new CustomEvent('replace-next', { bubbles: true, composed: true }))
      }
    } else if (e.key === 'Escape') {
      this.close()
    }
  }

  /** Alt+C / Alt+W / Alt+R toggle the match flags without leaving the input. */
  private handleFlagShortcut(e: KeyboardEvent): boolean {
    if (!e.altKey || e.ctrlKey || e.metaKey) return false
    const key = e.key.toLowerCase()
    if (key === 'c') {
      e.preventDefault()
      this.setFlag('caseSensitive', !this.currentFlags().caseSensitive)
      return true
    }
    if (key === 'w') {
      e.preventDefault()
      this.setFlag('wholeWord', !this.currentFlags().wholeWord)
      return true
    }
    if (key === 'r') {
      e.preventDefault()
      this.setFlag('regexp', !this.currentFlags().regexp)
      return true
    }
    return false
  }

  doFindPrevious(): void {
    if (!this.view) return
    this.applyQuery()
    if (!this.hasValidQuery()) return
    findPrevious(this.view)
    this.refreshCounts()
  }

  doFindNext(): void {
    if (!this.view) return
    this.applyQuery()
    if (!this.hasValidQuery()) return
    findNext(this.view)
    this.refreshCounts()
  }

  doReplace(): void {
    if (!this.view) return
    this.applyQuery()
    if (!this.hasValidQuery()) return
    replaceNext(this.view)
    this.refreshCounts()
    this.focusFindInput(false)
  }

  doReplaceAll(): void {
    if (!this.view) return
    this.applyQuery()
    if (!this.hasValidQuery()) return
    replaceAll(this.view)
    this.refreshCounts()
    this.focusFindInput(false)
  }

  private toggleMode(): void {
    this.mode = this.mode === 'find' ? 'replace' : 'find'
    this.dispatchEvent(
      new CustomEvent('toggle-mode', { detail: { mode: this.mode }, bubbles: true, composed: true })
    )
    this.focusPanel()
  }

  render(): unknown {
    const flags = this.currentFlags()
    const status = !this.queryValid
      ? 'Invalid regex'
      : this.matchTotal === 0
        ? 'No results'
        : `${this.matchIndex} of ${this.matchTotal}`
    return html`
      <div
        class="bar"
        role="dialog"
        aria-label=${this.mode === 'replace' ? 'Find and replace' : 'Find'}
        @click=${(e: MouseEvent) => e.stopPropagation()}
      >
        <div class="row">
          <button
            class="btn toggle"
            title=${this.mode === 'replace' ? 'Hide replace' : 'Show replace'}
            aria-label="Toggle replace mode"
            aria-expanded=${this.mode === 'replace'}
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${this.toggleMode}
          >
            ${
              this.mode === 'replace'
                ? html`<svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <polyline points="18 15 12 9 6 15" />
                  </svg>`
                : html`<svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>`
            }
          </button>
          <div class="field">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              class="find-input"
              placeholder="Find..."
              aria-label="Find"
              .value=${this.query}
              @input=${this.handleQueryInput}
              @keydown=${this.handleQueryKey}
            />
            ${
              this.query.length > 0
                ? html`<span
                    class="match-count ${this.matchTotal === 0 ? 'zero' : ''}"
                    role="status"
                    >${status}</span
                  >`
                : ''
            }
          </div>
          <button
            class="btn ${flags.caseSensitive ? 'active' : ''}"
            title="Match Case (Alt+C)"
            aria-label="Match case"
            aria-pressed=${flags.caseSensitive}
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${() => this.setFlag('caseSensitive', !flags.caseSensitive)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 20V7l3-3 3 3v13" />
              <path d="M4 13h6" />
              <path d="M14 12h6" />
            </svg>
          </button>
          <button
            class="btn ${flags.wholeWord ? 'active' : ''}"
            title="Match Whole Word (Alt+W)"
            aria-label="Match whole word"
            aria-pressed=${flags.wholeWord}
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${() => this.setFlag('wholeWord', !flags.wholeWord)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 6v12" />
              <path d="M20 6v12" />
              <rect x="8" y="9" width="8" height="6" rx="1" />
            </svg>
          </button>
          <button
            class="btn ${flags.regexp ? 'active' : ''}"
            title="Use Regular Expression (Alt+R)"
            aria-label="Use regular expression"
            aria-pressed=${flags.regexp}
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${() => this.setFlag('regexp', !flags.regexp)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 20c4 0 4-16 8-16s4 10 6 10" />
              <circle cx="18" cy="17" r="2.5" />
            </svg>
          </button>
          <button
            class="btn"
            title="Previous (Shift+Enter)"
            aria-label="Previous match"
            ?disabled=${this.query.length === 0}
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${this.doFindPrevious}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
          <button
            class="btn"
            title="Next (Enter)"
            aria-label="Next match"
            ?disabled=${this.query.length === 0}
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${this.doFindNext}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
          </button>
          <button
            class="btn"
            title="Close (Esc)"
            aria-label="Close find"
            @mousedown=${(e: MouseEvent) => e.preventDefault()}
            @click=${() => this.close()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        ${
          this.mode === 'replace'
            ? html`
                <div class="row">
                  <span class="toggle-spacer" aria-hidden="true"></span>
                  <div class="field">
                    <input
                      type="text"
                      class="replace-input"
                      placeholder="Replace..."
                      aria-label="Replace"
                      .value=${this.replaceText}
                      @input=${this.handleReplaceInput}
                      @keydown=${this.handleReplaceKey}
                    />
                  </div>
                  <button
                    class="btn"
                    title="Replace (Enter)"
                    aria-label="Replace next"
                    ?disabled=${this.query.length === 0}
                    @mousedown=${(e: MouseEvent) => e.preventDefault()}
                    @click=${this.doReplace}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="17 1 21 5 17 9" />
                      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                      <polyline points="7 23 3 19 7 15" />
                      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                    </svg>
                  </button>
                  <button
                    class="btn"
                    title="Replace all (Shift+Enter)"
                    aria-label="Replace all"
                    ?disabled=${this.query.length === 0}
                    @mousedown=${(e: MouseEvent) => e.preventDefault()}
                    @click=${this.doReplaceAll}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="17 1 21 5 17 9" />
                      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                      <line x1="3" y1="21" x2="21" y2="21" />
                    </svg>
                  </button>
                </div>
              `
            : ''
        }
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-find-panel': FindPanel
  }
}
