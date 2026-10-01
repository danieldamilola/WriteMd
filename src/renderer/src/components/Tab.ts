import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'

@customElement('writemd-tab')
export class WriteMdTab extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      min-width: 80px;
      max-width: 169px;
      flex: 0 0 auto;
      height: 26px;
      position: relative;
      box-sizing: border-box;
      user-select: none;
      -webkit-app-region: no-drag;
    }

    .tab-btn {
      display: flex;
      align-items: center;
      width: 100%;
      height: 100%;
      border-radius: 5px;
      padding: 0 10px 0 11px;
      cursor: pointer;
      gap: 8px;
      box-sizing: border-box;
      background: none;
      border: none;
      font-family: 'Geist Mono', monospace;
      font-size: 14px;
      line-height: 18px;
      color: var(--text-muted);
      font-weight: 400;
      transition:
        background 120ms ease,
        color 120ms ease;
    }

    .tab-btn:hover {
      color: var(--text-secondary);
    }

    :host([active]) .tab-btn {
      background: var(--bg-hover);
      color: var(--text);
      font-weight: 600;
    }

    .tab-btn:focus-visible {
      outline: 1px solid var(--border-focus);
      outline-offset: -1px;
    }

    .separator {
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 2px;
      height: 8px;
      background: var(--bg-gutter);
      border-radius: 1px;
    }

    :host([active]) .separator {
      display: none;
    }

    .label {
      white-space: nowrap;
      overflow: hidden;
      flex: 1;
      min-width: 0;
      text-align: left;
      -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
      mask-image: linear-gradient(to right, black 80%, transparent 100%);
    }

    .close-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 12px;
      height: 12px;
      flex-shrink: 0;
      border: none;
      background: none;
      padding: 0;
      cursor: pointer;
      color: var(--text-muted);
      /* Space stays reserved while the button is invisible, so revealing it
         never reflows the strip. The button is never removed from flow, so it
         stays focusable for keyboard users. */
      opacity: 0;
      transition:
        opacity 100ms ease,
        color 100ms ease;
    }

    /* The active tab keeps its close button visible; inactive tabs reveal it on
       hover so the strip stays quiet until you reach for a tab. */
    :host([active]) .close-btn,
    :host(:hover) .close-btn,
    :host(:focus-within) .close-btn {
      opacity: 1;
    }

    .dirty-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: var(--text-secondary);
      flex-shrink: 0;
      margin-left: 2px;
    }

    .close-btn:hover {
      color: var(--text);
    }
  `

  @property({ type: String }) label = ''
  @property({ type: Boolean, reflect: true }) active = false
  @property({ type: Boolean }) showClose = true
  @property({ type: Boolean }) dirty = false

  private handleClose(e: MouseEvent): void {
    e.stopPropagation()
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  private handleSelect(): void {
    this.dispatchEvent(new CustomEvent('select', { bubbles: true, composed: true }))
  }

  /** Move DOM focus to this tab. */
  focus(): void {
    this.renderRoot?.querySelector<HTMLElement>('.tab-btn')?.focus()
  }

  /**
   * One handler for both jobs: Lit rejects duplicate attribute bindings on the
   * same element, so Enter/Space and the arrow keys cannot each own a
   * `@keydown`.
   */
  private handleKeyDown(e: KeyboardEvent): void {
    // Ignore key events bubbled from child controls (e.g. the close button
    // keeps its native Enter/Space activation).
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      this.handleSelect()
      return
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    // Left/right move along the strip, matching the standard tablist pattern.
    // Without it every tab has to be tabbed through individually.
    const root = this.getRootNode() as ParentNode
    const tabs = Array.from(root.querySelectorAll('writemd-tab')) as WriteMdTab[]
    if (tabs.length === 0) return
    const i = tabs.indexOf(this)
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
    next?.focus()
    next?.handleSelect()
  }

  render(): unknown {
    return html`
      <span class="separator"></span>
      <div
        class="tab-btn"
        role="tab"
        aria-selected=${this.active ? 'true' : 'false'}
        tabindex="0"
        @click=${this.handleSelect}
        @keydown=${this.handleKeyDown}
      >
        <span class="label">${this.label}</span>
        ${this.dirty ? html`<span class="dirty-dot" title="Unsaved changes"></span>` : ''}
        ${
          this.showClose
            ? html`
                <button
                  class="close-btn"
                  type="button"
                  @click=${this.handleClose}
                  aria-label=${`Close ${this.label}`}
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 8 8"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.2"
                  >
                    <line x1="0" y1="8" x2="8" y2="0" />
                    <line x1="8" y1="8" x2="0" y2="0" />
                  </svg>
                </button>
              `
            : ''
        }
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-tab': WriteMdTab
  }
}
