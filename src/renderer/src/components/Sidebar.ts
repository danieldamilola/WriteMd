import { css, html, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { chromeIcon } from '../design/icons'
import { controlStyles } from '../design/controls'
import './IconButton'
import './SearchBar'
import './UpdateButton'

/**
 * Vertical document panel: palette search, icon-only quick actions, the
 * open-documents rail, and workspace shortcuts. Collapsed, it shrinks to a
 * slim strip holding only the expand button, so the panel can always be
 * reopened from the rail itself.
 */
@customElement('writemd-sidebar')
export class Sidebar extends LitElement {
  @property({ type: Boolean }) welcome = false
  @property({ type: Boolean }) collapsed = false
  static styles = [
    controlStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--frame-surface);
        font-family: var(--font-ui);
      }
      .panel-top {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 12px 8px 0;
        flex-shrink: 0;
      }
      .actions {
        display: flex;
        justify-content: center;
        gap: 4px;
        padding: 12px 8px;
      }
      .body {
        display: flex;
        flex: 1;
        flex-direction: column;
        overflow: hidden;
        min-height: 0;
      }
      .home-nav {
        padding: 0 8px;
      }
      .home-nav .nav-row[aria-current='page'] {
        color: var(--text);
      }
      .home-hint {
        margin: 20px 16px;
        color: var(--text-secondary);
        font-size: 12px;
        line-height: 1.6;
      }
      slot {
        display: flex;
        flex: 1;
        min-height: 0;
      }
      .footer {
        padding: 8px;
      }
      .version {
        padding: 8px;
        font-size: 11px;
        color: var(--text-muted);
      }
      .nav-row:hover {
        background: var(--bg-hover);
        color: var(--text);
      }
      .slim {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 48px;
        padding-top: 12px;
      }
    `
  ]
  private action(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }))
  }
  render(): unknown {
    if (this.collapsed) {
      return html`
        <div class="slim">
          <writemd-icon-button
            size="md"
            title="Expand panel"
            @click=${() => this.action('toggle-panel')}
            >${chromeIcon('sidebar')}</writemd-icon-button
          >
        </div>
      `
    }
    return html`
      <div class="panel-top">
        <writemd-search-bar
          placeholder="Search"
          kbd="Ctrl+K"
          aria-label="Search commands"
          @search-activate=${() => this.action('open-menu')}
        ></writemd-search-bar>
        <writemd-icon-button
          size="md"
          title="Collapse panel"
          @click=${() => this.action('toggle-panel')}
          >${chromeIcon('sidebar')}</writemd-icon-button
        >
      </div>
      <div class="actions">
        <writemd-icon-button size="md" title="New note" @click=${() => this.action('new-file')}
          >${chromeIcon('plus')}</writemd-icon-button
        >
        <writemd-icon-button size="md" title="Open file" @click=${() => this.action('open-file')}
          >${chromeIcon('folder-open')}</writemd-icon-button
        >
      </div>
      <div class="body">
        ${
          this.welcome
            ? html`
                <nav class="home-nav" aria-label="Workspace">
                  <div class="nav-row" aria-current="page">${chromeIcon('home')}Home</div>
                  <button class="nav-row" @click=${() => this.action('open-vault')}>
                    ${chromeIcon('folder-tree')}Vault folder
                  </button>
                </nav>
                <p class="home-hint">Open notes will appear here.</p>
              `
            : html`<slot></slot>`
        }
      </div>
      <div class="footer">
        <writemd-update-button sidebar></writemd-update-button>
        <button
          class="nav-row"
          ?disabled=${this.welcome}
          title=${this.welcome ? 'Open a note to use AI Assistant' : 'AI Assistant'}
          @click=${() => this.action('open-ai')}
        >
          ${chromeIcon('bot')}AI Assistant</button
        ><button class="nav-row" @click=${() => this.action('open-settings')}>
          ${chromeIcon('settings')}Settings
        </button>
      </div>
    `
  }
}
