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
      flex: 0 1 169px;
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
      color: #737373;
      font-weight: 400;
      transition:
        background 120ms ease,
        color 120ms ease;
    }

    .tab-btn:hover {
      color: #a3a3a3;
    }

    :host([active]) .tab-btn {
      background: rgba(255, 255, 255, 0.05);
      color: #d4d4d4;
      font-weight: 600;
    }

    .tab-btn:focus-visible {
      outline: 1px solid var(--border-focus, rgba(255, 255, 255, 0.2));
      outline-offset: -1px;
    }

    .separator {
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 2px;
      height: 8px;
      background: #171717;
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
    }

    .dirty-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #a3a3a3;
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

  private handleSelectKey(e: KeyboardEvent): void {
    // Ignore key events bubbled from child controls (e.g. the close button
    // keeps its native Enter/Space activation).
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      this.handleSelect()
    }
  }

  render(): unknown {
    return html`
      <span class="separator"></span>
      <div
        class="tab-btn"
        role="button"
        tabindex="0"
        @click=${this.handleSelect}
        @keydown=${this.handleSelectKey}
      >
        <span class="label">${this.label}</span>
        ${this.dirty ? html`<span class="dirty-dot" title="Unsaved changes"></span>` : ''}
        ${
          this.active && this.showClose
            ? html`
                <button
                  class="close-btn"
                  type="button"
                  @click=${this.handleClose}
                  aria-label="Close tab"
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
