import { html, css, LitElement, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { ViewMode } from '../state/file-state'
import './ModeMenu'

/**
 * Words and characters, counted in one pass.
 *
 * This ran on every render, and the pill re-renders on every keystroke, so the
 * old `text.trim().split(/\s+/)` cost 350ms per keystroke on a 6 MB note and
 * allocated a million-element array each time. The profile put 31% of all
 * typing time in it. Counting transitions is allocation-free and ~40x faster.
 *
 * The whitespace set matches JS `\s`, which is what the old split used.
 */
export function countStats(text: string): { words: number; chars: number } {
  let words = 0
  let inWord = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const space =
      c === 32 ||
      (c >= 9 && c <= 13) ||
      c === 0xa0 ||
      c === 0x1680 ||
      (c >= 0x2000 && c <= 0x200a) ||
      c === 0x2028 ||
      c === 0x2029 ||
      c === 0x202f ||
      c === 0x205f ||
      c === 0x3000 ||
      c === 0xfeff
    if (space) inWord = false
    else if (!inWord) {
      inWord = true
      words++
    }
  }
  return { words, chars: text.length }
}

/** Long enough to settle between keystrokes, short enough to feel live. */
const COUNT_DELAY_MS = 250

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
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      font-family: 'Geist Mono', monospace;
      font-size: 10px;
      color: var(--text-muted);
      box-shadow: var(--shadow-2);
      backdrop-filter: blur(8px);
    }

    .mode-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--text-muted);
      transition: color 120ms ease;
      padding: 2px;
      margin-left: -2px;
    }

    .mode-btn:hover {
      color: var(--text);
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
  @state() private words = 0
  @state() private chars = 0

  private countTimer: number | null = null

  /**
   * Counting is deferred instead of done inline in render: the pill gets a new
   * `content` on every keystroke, and a note can be megabytes long. The count
   * is informational, so one recount per burst is enough, and the first paint
   * no longer waits on a full-document scan.
   */
  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('content')) this.scheduleCount()
  }

  private scheduleCount(): void {
    if (this.countTimer !== null) return
    this.countTimer = window.setTimeout(() => {
      this.countTimer = null
      const stats = countStats(this.content)
      this.words = stats.words
      this.chars = stats.chars
    }, COUNT_DELAY_MS)
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
    if (this.countTimer !== null) {
      window.clearTimeout(this.countTimer)
      this.countTimer = null
    }
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
    const formattedWords = this.words.toLocaleString()
    const formattedChars = this.chars.toLocaleString()

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
