import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'

@customElement('writemd-tab')
export class WriteMDTab extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      min-width: 80px;
      max-width: 169px;
      flex: 0 1 169px;
      height: 32px;
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
      padding: 0 11px;
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
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
      text-align: left;
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
      opacity: 0.5;
      color: currentColor;
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
      opacity: 1;
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

  render(): unknown {
    return html`
      <span class="separator"></span>
      <button class="tab-btn" type="button">
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
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                  >
                    <line x1="2" y1="2" x2="10" y2="10" />
                    <line x1="10" y1="2" x2="2" y2="10" />
                  </svg>
                </button>
              `
            : ''
        }
      </button>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-tab': WriteMDTab
  }
}
