import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { ViewMode } from '../state/file-state'

@customElement('writemd-mode-menu')
export class ModeMenu extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      flex-direction: column;
      position: absolute;
      bottom: calc(100% + 8px);
      right: 0;
      width: 110px;
      background: #181818;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      padding: 4px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
      z-index: 100;
      font-family: 'Geist Mono', monospace;
      box-sizing: border-box;
      user-select: none;
    }

    .item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 8px;
      border-radius: 4px;
      font-size: 11px;
      color: #a3a3a3;
      cursor: pointer;
      transition:
        background 100ms ease,
        color 100ms ease;
    }

    .item:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #ffffff;
    }

    .item.active {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.05);
    }

    .icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    .icon svg {
      width: 12px;
      height: 12px;
    }
  `

  @property({ type: String }) activeMode: ViewMode = 'live'

  private handleSelect(mode: ViewMode, e: MouseEvent): void {
    e.stopPropagation()
    this.dispatchEvent(
      new CustomEvent('mode-select', {
        detail: { mode },
        bubbles: true,
        composed: true
      })
    )
  }

  render(): unknown {
    const isLive = this.activeMode === 'live' || this.activeMode === 'wysiwyg'
    const isReading = this.activeMode === 'reading'
    const isSource = this.activeMode === 'source'

    return html`
      <div
        class="item ${isSource ? 'active' : ''}"
        @click=${(e: MouseEvent) => this.handleSelect('source', e)}
      >
        <span class="icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </span>
        <span>Source mode</span>
      </div>

      <div
        class="item ${isReading ? 'active' : ''}"
        @click=${(e: MouseEvent) => this.handleSelect('reading', e)}
      >
        <span class="icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
        </span>
        <span>Reading</span>
      </div>

      <div
        class="item ${isLive ? 'active' : ''}"
        @click=${(e: MouseEvent) => this.handleSelect('live', e)}
      >
        <span class="icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
        </span>
        <span>Live preview</span>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-mode-menu': ModeMenu
  }
}
