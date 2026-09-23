import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import './Tab'

export interface VerticalTab {
  path: string | null
  dirty: boolean
}

function tabLabel(path: string | null): string {
  return path?.split(/[/\\]/).pop() ?? 'Untitled.md'
}

@customElement('writemd-vertical-tab-bar')
export class VerticalTabBar extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 196px;
      flex-shrink: 0;
      min-height: 0;
      padding: 22px 0 12px 20px;
      margin-right: 12px;
      box-sizing: border-box;
      user-select: none;
    }
    .tab-list {
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow-y: auto;
      overflow-x: hidden;
    }
    writemd-tab {
      width: 100%;
      max-width: none;
      flex: none;
      height: 32px;
    }
    .tab-add {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 20px;
      margin-top: 20px;
      border-radius: 5px;
      color: var(--text-muted);
      cursor: pointer;
      flex-shrink: 0;
    }
    .tab-add:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.06);
    }
  `

  @property({ type: Array }) tabs: VerticalTab[] = []
  @property({ type: Number }) activeTab = 0
  @property({ type: String }) secondaryPath: string | null = null
  @property({ type: Boolean }) secondaryDirty = false

  render(): unknown {
    return html`
      <div class="tab-list">
        ${this.tabs.map(
          (t, i) => html`
            <writemd-tab
              label=${tabLabel(t.path)}
              ?active=${i === this.activeTab}
              .dirty=${t.dirty}
              @select=${(): void => {
                this.dispatchEvent(
                  new CustomEvent('select-tab', { detail: { index: i }, bubbles: true, composed: true })
                )
              }}
              @close=${(): void => {
                this.dispatchEvent(
                  new CustomEvent('close-tab', { detail: { index: i }, bubbles: true, composed: true })
                )
              }}
            ></writemd-tab>
          `
        )}
        ${this.secondaryPath
          ? html`
              <writemd-tab
                label=${tabLabel(this.secondaryPath)}
                ?active=${false}
                .dirty=${this.secondaryDirty}
                @close=${(): void => {
                  this.dispatchEvent(new CustomEvent('close-secondary', { bubbles: true, composed: true }))
                }}
              ></writemd-tab>
            `
          : ''}
      </div>
      <div
        class="tab-add"
        title="Open file in new tab"
        @click=${(): void => {
          this.dispatchEvent(new CustomEvent('add-tab', { bubbles: true, composed: true }))
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
          <line x1="7" y1="2" x2="7" y2="12" />
          <line x1="2" y1="7" x2="12" y2="7" />
        </svg>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-vertical-tab-bar': VerticalTabBar
  }
}
