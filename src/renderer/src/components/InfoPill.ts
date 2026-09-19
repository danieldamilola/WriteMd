import { html, css, LitElement } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { ViewMode } from '../state/file-state'
import './ModeMenu'

@customElement('writemd-info-pill')
export class InfoPill extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      bottom: 12px;
      right: 16px;
      display: inline-flex;
      align-items: center;
      z-index: 50;
      user-select: none;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      height: 23px;
      padding: 0 10px;
      background: #1c1c1c;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      font-family: 'Geist Mono', monospace;
      font-size: 10px;
      color: #6b6b6b;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(8px);
    }

    .mode-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #8c8c8c;
      transition: color 120ms ease;
      padding: 2px;
      margin-left: -2px;
    }

    .mode-btn:hover {
      color: #ffffff;
    }

    .mode-btn svg {
      width: 12px;
      height: 12px;
    }

    .counts {
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }

    .count-item {
      letter-spacing: 0.02em;
    }
  `

  @property({ type: String }) content = ''
  @property({ type: String }) mode: ViewMode = 'live'
  @state() private menuOpen = false

  private countStats(text: string): { words: number; chars: number } {
    const chars = text.length
    const trimmed = text.trim()
    const words = trimmed ? trimmed.split(/\s+/).length : 0
    return { words, chars }
  }

  private toggleMenu = (e: MouseEvent): void => {
    e.stopPropagation()
    this.menuOpen = !this.menuOpen
  }

  private handleModeSelect = (e: CustomEvent<{ mode: ViewMode }>): void => {
    this.menuOpen = false
    this.dispatchEvent(
      new CustomEvent('mode-change', {
        detail: { mode: e.detail.mode },
        bubbles: true,
        composed: true
      })
    )
  }

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('click', this.handleOutsideClick)
  }

  disconnectedCallback(): void {
    window.removeEventListener('click', this.handleOutsideClick)
    super.disconnectedCallback()
  }

  private handleOutsideClick = (): void => {
    if (this.menuOpen) {
      this.menuOpen = false
    }
  }

  private renderModeIcon(): unknown {
    const isSource = this.mode === 'source'
    const isReading = this.mode === 'reading'

    if (isSource) {
      return html`
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      `
    }

    if (isReading) {
      return html`
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      `
    }

    // Default: live preview pencil
    return html`
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
      </svg>
    `
  }

  render(): unknown {
    const { words, chars } = this.countStats(this.content)
    const formattedWords = words.toLocaleString()
    const formattedChars = chars.toLocaleString()

    return html`
      ${
        this.menuOpen
          ? html`<writemd-mode-menu
              .activeMode=${this.mode}
              @mode-select=${this.handleModeSelect}
            ></writemd-mode-menu>`
          : ''
      }

      <div class="pill">
        <div class="mode-btn" title="Change Editor Mode" @click=${this.toggleMenu}>
          ${this.renderModeIcon()}
        </div>
        <div class="counts">
          <span class="count-item">${formattedWords} words</span>
          <span class="count-item">${formattedChars} characters</span>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-info-pill': InfoPill
  }
}
