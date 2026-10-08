import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import './IconButton'
import './UpdateButton'
import { chromeIcon } from '../design/icons'
import { api } from '../api'

@customElement('writemd-top-bar')
export class WriteMdTopBar extends LitElement {
  static styles = css`
    :host {
      display: flex;
      align-items: center;
      height: 40px;
      padding: 6px 0 6px 28px;
      flex-shrink: 0;
      -webkit-app-region: drag;
      user-select: none;
      box-sizing: border-box;
      gap: 0;
    }

    .left-group {
      display: flex;
      align-items: center;
      gap: 8px;
      -webkit-app-region: no-drag;
      flex-shrink: 0;
    }

    .tabs-slot {
      display: flex;
      align-items: center;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      -webkit-app-region: drag;
      margin-left: 21px;
    }

    .tabs-slot > ::slotted(*) {
      -webkit-app-region: drag;
    }

    .right-group {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-left: auto;
      flex-shrink: 0;
      -webkit-app-region: no-drag;
      align-self: stretch;
    }

    .window-controls {
      display: flex;
      gap: 0;
      align-self: stretch;
      margin: -6px 0;
    }

    :host {
      height: var(--shell-header-height);
      position: relative;
      padding: 0 0 0 8px;
      font-family: var(--font-ui);
      background: var(--editor-surface);
      backdrop-filter: blur(var(--surface-blur, 0px));
    }
    .left-group,
    .right-group {
      gap: 4px;
    }
    .tabs-slot {
      margin-left: 8px;
    }
    .tabs-slot[hidden] {
      display: none;
    }
    .window-controls {
      margin: 0;
      background: transparent;
    }
    :host([document-header]) .tabs-slot {
      position: absolute;
      inset: 0;
      margin: 0;
      overflow: visible;
      pointer-events: none;
      --document-caption-inset: calc(3 * var(--caption-button-width) + 18px);
    }
    :host([document-header]) .left-group,
    :host([document-header]) .right-group {
      position: relative;
      z-index: 1;
    }
  `

  @property({ type: Boolean }) settingsOpen = false
  @property({ type: Boolean, reflect: true, attribute: 'document-header' }) documentHeader = false
  @property({ type: Boolean }) showSplitButton = true
  @property({ type: Boolean }) splitActive = false

  private emit(event: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(event, { detail, bubbles: true, composed: true }))
  }

  render(): unknown {
    return html`
      <div class="left-group">
        ${this.documentHeader ? '' : html`<writemd-update-button></writemd-update-button>`}
      </div>

      <div class="tabs-slot" ?hidden=${this.settingsOpen}>
        <slot name="tabs"></slot>
      </div>

      <div class="right-group">
        ${
          this.showSplitButton && !this.settingsOpen
            ? html`
                <writemd-icon-button title="Split view" @click=${() => this.emit('toggle-split')}
                  >${chromeIcon('split')}</writemd-icon-button
                >
              `
            : ''
        }
        <div class="window-controls">
          <writemd-icon-button
            size="caption"
            title="Minimize"
            @click=${() => void api()?.window?.minimize?.()}
          >
            <svg viewBox="0 0 10 10" fill="none">
              <path d="M0 5H10" stroke="currentColor" stroke-width="1" />
            </svg>
          </writemd-icon-button>

          <writemd-icon-button
            size="caption"
            title="Maximize"
            @click=${() => void api()?.window?.maximize?.()}
          >
            <svg viewBox="0 0 10 10" fill="none">
              <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1" />
            </svg>
          </writemd-icon-button>

          <writemd-icon-button
            size="caption"
            variant="close"
            title="Close"
            @click=${async () => {
              const fs = await import('../state/file-state').then((m) => m.FileState)
              const state = fs.getInstance().getState()
              if (state.dirty || state.secondaryDoc?.dirty) {
                const ConfirmDialog = await import('./ConfirmDialog')
                const ok = await ConfirmDialog.showConfirm(
                  'You have unsaved changes. Close anyway?'
                )
                if (!ok) return
              }
              void api()?.window?.close?.()
            }}
          >
            <svg viewBox="0 0 10 10" fill="none">
              <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" stroke-width="1" />
            </svg>
          </writemd-icon-button>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-top-bar': WriteMdTopBar
  }
}
