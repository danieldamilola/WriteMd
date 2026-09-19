import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'

export type ViewMode = 'wysiwyg' | 'source' | 'split'

@customElement('writemd-mode-toggle')
export class WriteMDModeToggle extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      position: relative;
      user-select: none;
      z-index: 10;
    }

    .pill {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 5px 8px 5px 7px;
      border-radius: 5px;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(40, 40, 40, 0.6);
      box-sizing: border-box;
    }

    .mode-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      border: none;
      background: none;
      color: #737373;
      font-family: 'Geist Mono', monospace;
      font-size: 12px;
      line-height: 16px;
      padding: 3px 6px;
      border-radius: 3px;
      cursor: pointer;
      transition:
        background 120ms ease,
        color 120ms ease;
    }

    .mode-btn:hover {
      color: #d4d4d4;
      background: rgba(255, 255, 255, 0.05);
    }

    .mode-btn.active {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.1);
      font-weight: 500;
    }

    .shortcut {
      font-family: 'Geist Mono', monospace;
      font-size: 10px;
      color: #595959;
      margin-left: 4px;
    }
  `

  @property({ type: String }) mode: ViewMode = 'wysiwyg'

  private setMode(mode: ViewMode): void {
    this.mode = mode
    this.dispatchEvent(
      new CustomEvent('mode-change', {
        detail: { mode },
        bubbles: true,
        composed: true
      })
    )
  }

  render(): unknown {
    return html`
      <div class="pill">
        <button
          type="button"
          class="mode-btn ${this.mode === 'wysiwyg' ? 'active' : ''}"
          @click=${() => this.setMode('wysiwyg')}
        >
          Live
        </button>
        <button
          type="button"
          class="mode-btn ${this.mode === 'source' ? 'active' : ''}"
          @click=${() => this.setMode('source')}
        >
          Source
        </button>
        <button
          type="button"
          class="mode-btn ${this.mode === 'split' ? 'active' : ''}"
          @click=${() => this.setMode('split')}
        >
          Split
        </button>
        <span class="shortcut">Ctrl+Shift+E</span>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-mode-toggle': WriteMDModeToggle
  }
}
