import { html, css, LitElement, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { ViewMode } from '../state/file-state'
import './ModeMenu'

/**
 * The document footer: word and character counts, and the editor mode button.
 *
 * Counts run in one pass.
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
    /*
     * A full-width footer rather than a floating box over the text.
     *
     * The box was absolutely positioned in the pane's bottom-right corner, so
     * it covered the last line of a document and only had room for itself in
     * wide panes. In normal flow the editor gives up the height instead: the
     * text always ends above the footer, and narrow panes get a real bar
     * instead of a squeezed one.
     *
     * No border and no rule. The document content is masked so it fades out as
     * it reaches this bar, which does the separating without drawing a line
     * across the pane.
     *
     * The bar is a material layer rather than a flat one: it paints the same
     * editor surface the pane does and blurs whatever sits behind it, so it
     * follows the translucent appearance and window material the user picked
     * rather than inventing its own opacity. At full surface opacity the blur
     * is 0px and this is indistinguishable from the pane.
     */
    :host {
      position: relative;
      display: flex;
      flex: 0 0 auto;
      width: 100%;
      min-height: 30px;
      box-sizing: border-box;
      padding: 0 8px;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      background: var(--editor-surface);
      backdrop-filter: blur(var(--surface-blur, 0px));
      z-index: 50;
      user-select: none;
    }

    /*
     * The path sits on the left and the counts on the right, with the mode
     * button beside them. Long paths fade out at the left edge instead of
     * being cut mid-glyph, matching how the document header showed it.
     */
    .path {
      display: flex;
      align-items: center;
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      white-space: nowrap;
      color: var(--text-muted);
      font-size: 12px;
      -webkit-mask-image: linear-gradient(to right, black 82%, transparent 100%);
      mask-image: linear-gradient(to right, black 82%, transparent 100%);
    }

    .path:hover {
      color: var(--text-secondary);
    }

    .right {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      flex: 0 0 auto;
      max-width: 100%;
      /*
       * Keeps the counts on the right when the path is hidden. With
       * space-between and the path removed, .right is the only child and
       * lands at flex-start, which slid the whole control to the left edge.
       */
      margin-left: auto;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      max-width: 100%;
      min-height: 30px;
      font-family: var(--font-ui);
      font-size: 12px;
      color: var(--text-secondary);
    }

    /*
     * The menu anchors to the host, which is now the full pane width, so it
     * needs the footer's own inset or it opens flush against the window edge.
     */
    writemd-mode-menu {
      right: 8px;
    }

    .mode-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--text);
      border: 0;
      background: transparent;
      min-width: 22px;
      min-height: 24px;
      transition: color 120ms ease;
      padding: 2px;
      margin-left: -2px;
    }

    .mode-btn:hover {
      color: var(--text);
    }
    .mode-btn:focus-visible {
      outline: 2px solid var(--border-focus);
      border-radius: var(--radius-sm);
    }

    .mode-btn svg {
      width: var(--icon-size, 18px);
      height: var(--icon-size, 18px);
      flex-shrink: 0;
    }

    .counts {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 4px 8px;
      white-space: nowrap;
    }

    .count-item {
      letter-spacing: 0.02em;
    }
  `

  @property({ type: String }) content = ''
  @property({ type: String }) mode: ViewMode = 'live'
  /** Short document path shown on the left. Empty hides the label entirely. */
  @property({ type: String }) path = ''
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
      ${
        this.path
          ? html`<div class="path" title=${this.path}>${this.path}</div>`
          : // Nothing at all rather than an empty box, so hiding the path does
            // not leave a gap on the left of the bar.
            ''
      }

      <div class="pill right">
        <button
          class="mode-btn"
          title="Change Editor Mode"
          aria-label="Change editor mode"
          aria-expanded=${this.menuOpen}
          aria-haspopup="menu"
          @click=${this.toggleMenu}
        >
          ${this.renderModeIcon()}
        </button>
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
