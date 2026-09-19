import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import './IconButton'
import type { ElectronAPI } from '../../../shared/electron-api'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

@customElement('writemd-top-bar')
export class WriteMDTopBar extends LitElement {
  static styles = css`
    :host {
      display: flex;
      align-items: flex-end;
      height: 43px;
      padding: 0 12px 6px 12px;
      flex-shrink: 0;
      -webkit-app-region: drag;
      user-select: none;
      box-sizing: border-box;
      gap: 0;
    }

    .left-group {
      display: flex;
      align-items: center;
      gap: 4px;
      -webkit-app-region: no-drag;
      flex-shrink: 0;
    }

    .tabs-slot {
      display: flex;
      align-items: center;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      -webkit-app-region: no-drag;
      margin-left: 4px;
    }

    .right-group {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      flex-shrink: 0;
      -webkit-app-region: no-drag;
    }

    .window-controls {
      display: flex;
      gap: 4px;
    }
  `

  @property({ type: Boolean }) showSplitButton = true
  @property({ type: Boolean }) splitActive = false

  private emit(event: string): void {
    this.dispatchEvent(new CustomEvent(event, { bubbles: true, composed: true }))
  }

  render(): unknown {
    return html`
      <div class="left-group">
        <writemd-icon-button title="Menu" @click=${() => this.emit('open-menu')}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M15.0375 8.25H2.9625C2.569 8.25 2.25 8.569 2.25 8.9625V9.0375C2.25 9.431 2.569 9.75 2.9625 9.75H15.0375C15.431 9.75 15.75 9.431 15.75 9.0375V8.9625C15.75 8.569 15.431 8.25 15.0375 8.25Z"
              fill="currentColor"
            />
            <path
              d="M15.0375 12H2.9625C2.569 12 2.25 12.319 2.25 12.7125V12.7875C2.25 13.181 2.569 13.5 2.9625 13.5H15.0375C15.431 13.5 15.75 13.181 15.75 12.7875V12.7125C15.75 12.319 15.431 12 15.0375 12Z"
              fill="currentColor"
            />
            <path
              d="M15.0375 4.5H2.9625C2.569 4.5 2.25 4.819 2.25 5.2125V5.2875C2.25 5.681 2.569 6 2.9625 6H15.0375C15.431 6 15.75 5.681 15.75 5.2875V5.2125C15.75 4.819 15.431 4.5 15.0375 4.5Z"
              fill="currentColor"
            />
          </svg>
        </writemd-icon-button>

        <writemd-icon-button title="Settings" @click=${() => this.emit('open-settings')}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M8.5785 2.25C8.112 2.25 7.734 2.628 7.734 3.09375L7.63275 3.8025C7.61199 3.94748 7.55384 4.08456 7.46404 4.20026C7.37423 4.31595 7.25586 4.40628 7.12055 4.46235C6.98525 4.51843 6.83768 4.53832 6.69236 4.52006C6.54705 4.50181 6.40898 4.44604 6.29175 4.35825L5.71875 3.9285C5.6404 3.85015 5.54739 3.788 5.44502 3.7456C5.34265 3.70319 5.23293 3.68137 5.12213 3.68137C5.01132 3.68137 4.9016 3.70319 4.79923 3.7456C4.69686 3.788 4.60385 3.85015 4.5255 3.9285L3.9285 4.5255C3.5985 4.8555 3.5985 5.38875 3.9285 5.718L4.35825 6.29175C4.44603 6.40893 4.50181 6.54694 4.5201 6.6922C4.5384 6.83747 4.51857 6.98499 4.46258 7.12028C4.40659 7.25556 4.31636 7.37395 4.20076 7.4638C4.08516 7.55365 3.94817 7.61188 3.80325 7.63275L3.09375 7.73475C2.628 7.73475 2.25 8.112 2.25 8.57775V9.42225C2.25 9.88725 2.628 10.2653 3.09375 10.2653L3.8025 10.3673C3.94748 10.388 4.08456 10.4462 4.20026 10.536C4.31595 10.6258 4.40628 10.7441 4.46235 10.8794C4.51843 11.0147 4.53832 11.1623 4.52006 11.3076C4.50181 11.453 4.44604 11.591 4.35825 11.7083L3.9285 12.2812C3.5985 12.6112 3.5985 13.1452 3.9285 13.4745L4.5255 14.0715C4.8555 14.4015 5.38875 14.4015 5.718 14.0715L6.29175 13.6417C6.40893 13.554 6.54694 13.4982 6.6922 13.4799C6.83747 13.4616 6.98499 13.4814 7.12028 13.5374C7.25556 13.5934 7.37395 13.6836 7.4638 13.7992C7.55365 13.9148 7.61188 14.0518 7.63275 14.1968L7.73475 14.9062C7.73475 15.372 8.112 15.75 8.57775 15.75H9.42225C9.88725 15.75 10.2653 15.372 10.2653 14.9062L10.3673 14.1975C10.388 14.0525 10.4462 13.9154 10.536 13.7997C10.6258 13.684 10.7441 13.5937 10.8794 13.5376C11.0147 13.4816 11.1623 13.4617 11.3076 13.4799C11.453 13.4982 11.591 13.554 11.7083 13.6417L12.2812 14.0715C12.6112 14.4015 13.1452 14.4015 13.4745 14.0715L14.0715 13.4745C14.4007 13.1445 14.4007 12.6112 14.0715 12.282L13.6417 11.7083C13.554 11.5911 13.4982 11.4531 13.4799 11.3078C13.4616 11.1625 13.4814 11.015 13.5374 10.8797C13.5934 10.7444 13.6836 10.626 13.7992 10.5362C13.9148 10.4463 14.0518 10.3881 14.1968 10.3673L14.9062 10.2653C15.372 10.2653 15.75 9.888 15.75 9.42225V8.57775C15.75 8.11275 15.372 7.73475 14.9062 7.73475L14.1975 7.63275C14.0525 7.61199 13.9154 7.55384 13.7997 7.46404C13.684 7.37423 13.5937 7.25586 13.5376 7.12055C13.4816 6.98525 13.4617 6.83768 13.4799 6.69236C13.4982 6.54705 13.554 6.40898 13.6417 6.29175L14.0715 5.71875C14.4007 5.38875 14.4007 4.85475 14.0715 4.5255L13.4745 3.9285C13.3163 3.77049 13.1018 3.68174 12.8783 3.68174C12.6547 3.68174 12.4402 3.77049 12.282 3.9285L11.7083 4.35825C11.5911 4.44603 11.4531 4.50181 11.3078 4.5201C11.1625 4.5384 11.015 4.51857 10.8797 4.46258C10.7444 4.40659 10.626 4.31636 10.5362 4.20076C10.4463 4.08516 10.3881 3.94817 10.3673 3.80325L10.2653 3.09375C10.2653 2.628 9.888 2.25 9.42225 2.25H8.5785ZM9 10.6875C9.44755 10.6875 9.87677 10.5097 10.1932 10.1932C10.5097 9.87677 10.6875 9.44755 10.6875 9C10.6875 8.55245 10.5097 8.12323 10.1932 7.80676C9.87677 7.49029 9.44755 7.3125 9 7.3125C8.55245 7.3125 8.12323 7.49029 7.80676 7.80676C7.49029 8.12323 7.3125 8.55245 7.3125 9C7.3125 9.44755 7.49029 9.87677 7.80676 10.1932C8.12323 10.5097 8.55245 10.6875 9 10.6875Z"
              fill="currentColor"
            />
          </svg>
        </writemd-icon-button>
      </div>

      <div class="tabs-slot">
        <slot name="tabs"></slot>
      </div>

      <div class="right-group">
        ${
          this.showSplitButton
            ? html`
                <writemd-icon-button title="Split view" @click=${() => this.emit('toggle-split')}>
                  ${
                    this.splitActive
                      ? html`
                          <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
                            <!-- Filled right pane -->
                            <path
                              d="M15 0C16.1046 0 17 0.895431 17 2V15C17 16.0357 16.2128 16.887 15.2041 16.9893L15 17H2L1.7959 16.9893C0.854346 16.8938 0.1062 16.1457 0.0107422 15.2041L0 15V2C0 0.895431 0.895431 4.0266e-09 2 0H15ZM2 1C1.44772 1 1 1.44772 1 2V15C1 15.5523 1.44772 16 2 16H6V1H2ZM8 15V2C8 1.44772 8.44772 1 9 1H15C15.5523 1 16 1.44772 16 2V15C16 15.5523 15.5523 16 15 16H9C8.44772 16 8 15.5523 8 15Z"
                              fill="currentColor"
                            />
                          </svg>
                        `
                      : html`
                          <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
                            <!-- Outline pane -->
                            <path
                              d="M15 0C16.1046 0 17 0.895431 17 2V15C17 16.0357 16.2128 16.887 15.2041 16.9893L15 17H2L1.7959 16.9893C0.854346 16.8938 0.1062 16.1457 0.0107422 15.2041L0 15V2C0 0.895431 0.895431 4.0266e-09 2 0H15ZM2 1C1.44772 1 1 1.44772 1 2V15C1 15.5523 1.44772 16 2 16H6V1H2ZM7 16H15C15.5523 16 16 15.5523 16 15V2C16 1.44772 15.5523 1 15 1H7V16Z"
                              fill="currentColor"
                            />
                          </svg>
                        `
                  }
                </writemd-icon-button>
              `
            : ''
        }

        <div class="window-controls">
          <writemd-icon-button
            size="md"
            title="Minimize"
            @click=${() => void api()?.window?.minimize?.()}
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
              <line x1="2" y1="6" x2="10" y2="6" />
            </svg>
          </writemd-icon-button>

          <writemd-icon-button
            size="md"
            title="Maximize"
            @click=${() => void api()?.window?.maximize?.()}
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2" y="2" width="8" height="8" rx="1" />
            </svg>
          </writemd-icon-button>

          <writemd-icon-button
            size="md"
            variant="close"
            title="Close"
            @click=${async () => {
              const fs = await import('../state/file-state').then(m => m.FileState);
              const state = fs.getInstance().getState();
              if (state.dirty || state.secondaryDoc?.dirty) {
                const ConfirmDialog = await import('./ConfirmDialog');
                const ok = await ConfirmDialog.showConfirm('You have unsaved changes. Close anyway?');
                if (!ok) return;
              }
              void api()?.window?.close?.()
            }}
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
              <line x1="3" y1="3" x2="9" y2="9" />
              <line x1="9" y1="3" x2="3" y2="9" />
            </svg>
          </writemd-icon-button>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-top-bar': WriteMDTopBar
  }
}
