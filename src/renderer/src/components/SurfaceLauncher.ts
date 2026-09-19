import { html, css, LitElement } from 'lit'
import { customElement } from 'lit/decorators.js'
import type { SplitSurface } from '../state/file-state'

@customElement('writemd-surface-launcher')
export class SurfaceLauncher extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      font-family: 'Geist Mono', monospace;
      color: #ffffff;
      user-select: none;
      box-sizing: border-box;
      padding: 24px;
    }

    .container {
      width: 100%;
      max-width: 340px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
    }

    .title {
      font-size: 16px;
      font-weight: 400;
      color: #ffffff;
      letter-spacing: 0.02em;
    }

    .list {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 38px;
      padding: 0 12px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 100ms ease;
    }

    .row:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    .left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .icon {
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #595959;
      transition: color 100ms ease;
    }

    .row:hover .icon {
      color: #8c8c8c;
    }

    .icon svg {
      width: 15px;
      height: 15px;
    }

    .label {
      font-size: 14px;
      color: #ffffff;
    }

    .shortcut {
      font-size: 10px;
      color: #737373;
      letter-spacing: 0.02em;
    }
  `

  private handleSelect(surface: SplitSurface): void {
    this.dispatchEvent(
      new CustomEvent('select-surface', {
        detail: { surface },
        bubbles: true,
        composed: true
      })
    )
  }

  render(): unknown {
    return html`
      <div class="container">
        <div class="title">Open a surface</div>
        <div class="list">
          <div class="row" @click=${() => this.handleSelect('files')}>
            <div class="left">
              <span class="icon">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
                  />
                </svg>
              </span>
              <span class="label">Files</span>
            </div>
            <span class="shortcut">Ctrl + shift + e</span>
          </div>

          <div class="row" @click=${() => this.handleSelect('file')}>
            <div class="left">
              <span class="icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="12" y1="3" x2="12" y2="21" />
                </svg>
              </span>
              <span class="label">Split view</span>
            </div>
            <span class="shortcut">Ctrl + alt + s</span>
          </div>

          <div class="row" @click=${() => this.handleSelect('backlinks')}>
            <div class="left">
              <span class="icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </span>
              <span class="label">Backlinks</span>
            </div>
            <span class="shortcut">Ctrl + shift + b</span>
          </div>

          <div class="row" @click=${() => this.handleSelect('ai')}>
            <div class="left">
              <span class="icon">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L9.5 8.5L3 11L9.5 13.5L12 20L14.5 13.5L21 11L14.5 8.5L12 2Z" />
                </svg>
              </span>
              <span class="label">Ai</span>
            </div>
            <span class="shortcut">Ctrl + alt + a</span>
          </div>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-surface-launcher': SurfaceLauncher
  }
}
