import { html, css, LitElement } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { api } from '../api'
import { SettingsStore } from '../state/settings'
import { chromeIcon } from '../design/icons'
import { controlStyles } from '../design/controls'
import { displayTitle, shortPath } from '../utils/links'
import { effectiveBinding, formatBinding } from '../state/shortcuts'
import './Panel'

interface RecentFile {
  name: string
  path: string
  fullPath: string
}

/** Home content shares the application's shell, controls, and empty-pane artwork. */
@customElement('writemd-welcome-screen')
export class WelcomeScreen extends LitElement {
  static styles = [
    controlStyles,
    css`
      :host {
        display: flex;
        flex: 1;
        min-width: 0;
        min-height: 0;
        font-family: var(--font-ui);
        color: var(--text);
      }
      .home {
        width: 100%;
        max-width: 640px;
        box-sizing: border-box;
        margin: auto;
        padding: clamp(28px, 7cqi, 64px) clamp(20px, 5cqi, 40px);
      }
      h1 {
        margin: 0;
        font-size: clamp(28px, 5cqi, 36px);
        line-height: 1.2;
        font-weight: 600;
        letter-spacing: -0.04em;
      }
      .intro {
        margin: 12px 0 28px;
        color: var(--text-secondary);
        font-size: 14px;
        line-height: 1.6;
      }
      .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      .actions .secondary {
        min-height: 40px;
        padding: 8px 14px;
        gap: 10px;
        font-size: 13px;
        color: var(--text);
      }
      .actions .primary {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--accent-text);
      }
      .actions .primary:hover {
        background: var(--accent-hover);
      }
      .actions .primary:focus-visible {
        outline: 2px solid var(--text);
      }
      kbd {
        margin-left: 12px;
        font: 11px var(--font-ui);
        opacity: 0.75;
      }
      .recent {
        margin-top: 40px;
      }
      h2 {
        margin: 0 0 12px;
        font-size: 12px;
        font-weight: 500;
        color: var(--text-secondary);
      }
      .file-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        list-style: none;
        margin: 0 -10px;
        padding: 0;
      }
      .recent-item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 56px;
        padding: 8px 10px;
        border: 0;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text-secondary);
        text-align: left;
      }
      .recent-item:hover,
      .recent-item:focus-visible {
        background: var(--bg-hover);
        color: var(--text);
      }
      .file-label {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .file-name,
      .file-path {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .file-name {
        color: var(--text);
        font-size: 14px;
        font-weight: 500;
      }
      .file-path {
        color: var(--text-secondary);
        font-size: 12px;
      }
      .empty-state {
        margin: 0;
        padding: 12px 0;
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-secondary);
      }
      .utilities {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 8px;
        margin: 28px -8px 0;
      }
      .utility {
        width: auto;
        min-height: 34px;
        font-size: 12px;
        color: var(--text-secondary);
      }
      @container (max-width: 440px) {
        .actions .secondary {
          flex: 1 1 100%;
        }
        kbd {
          margin-left: auto;
        }
        .recent {
          margin-top: 28px;
        }
      }
    `
  ]

  @property({ type: Boolean }) vertical = true
  @state() private recentFiles: RecentFile[] = []
  @state() private recentLoading = true
  @state() private fromVault = false
  private settingsStore = SettingsStore.getInstance()
  private unsubscribes: Array<() => void> = []
  private loadVersion = 0

  connectedCallback(): void {
    super.connectedCallback()
    this.unsubscribes = [
      this.settingsStore.subscribe('files.recentFiles', () => void this.loadRecentFiles()),
      this.settingsStore.subscribe('files.vaultPath', () => void this.loadRecentFiles()),
      this.settingsStore.subscribe('shortcuts.bindings', () => this.requestUpdate())
    ]
    void this.loadRecentFiles()
  }

  disconnectedCallback(): void {
    this.loadVersion++
    this.unsubscribes.forEach((unsubscribe) => unsubscribe())
    this.unsubscribes = []
    super.disconnectedCallback()
  }

  private async loadRecentFiles(): Promise<void> {
    const version = ++this.loadVersion
    try {
      const recent = this.settingsStore.get<string[]>('files.recentFiles', [])
      const paths =
        recent.length > 0
          ? recent
          : ((await api()?.vault?.listFiles?.()) ?? []).map((file) => file.path)
      if (!this.isConnected || version !== this.loadVersion) return
      this.fromVault = recent.length === 0 && paths.length > 0
      this.recentFiles = [...new Set(paths)].slice(0, 4).map((fullPath) => ({
        name: displayTitle(fullPath),
        path: shortPath(fullPath),
        fullPath
      }))
    } catch {
      if (!this.isConnected || version !== this.loadVersion) return
      this.recentFiles = []
    } finally {
      if (this.isConnected && version === this.loadVersion) this.recentLoading = false
    }
  }

  private emit(action: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(action, { detail, bubbles: true, composed: true }))
  }

  private shortcut(id: string): string {
    const binding = effectiveBinding(id, this.settingsStore.get('shortcuts.bindings', {}))
    return binding ? formatBinding(binding) : ''
  }

  render(): unknown {
    return html`<writemd-panel .empty=${true}>
      <main class="home" aria-labelledby="welcome-title">
        <h1 id="welcome-title">WriteMd</h1>
        <p class="intro">Start a note or pick up where you left off.</p>
        <div class="actions">
          <button class="secondary primary" @click=${() => this.emit('new-file')}>
            ${chromeIcon('plus')}<span>New note</span>
            ${this.shortcut('new-file') ? html`<kbd>${this.shortcut('new-file')}</kbd>` : ''}
          </button>
          <button class="secondary" @click=${() => this.emit('open-file')}>
            ${chromeIcon('folder-open')}<span>Open file</span>
            ${this.shortcut('open-file') ? html`<kbd>${this.shortcut('open-file')}</kbd>` : ''}
          </button>
        </div>
        <section class="recent" aria-labelledby="recent-title" aria-busy=${this.recentLoading}>
          <h2 id="recent-title">${this.fromVault ? 'From your vault' : 'Recent notes'}</h2>
          ${
            this.recentLoading
              ? html`<p class="empty-state" role="status">Loading notes...</p>`
              : this.recentFiles.length === 0
                ? html`<p class="empty-state">
                    No recent notes yet. Create a note or open a Markdown file to get started.
                  </p>`
                : html`<ul class="file-list">
                    ${this.recentFiles.map(
                      (file) =>
                        html` <li>
                          <button
                            class="recent-item"
                            data-path=${file.fullPath}
                            title=${file.fullPath}
                            @click=${() => this.emit('open-recent', { path: file.fullPath })}
                          >
                            ${chromeIcon('file-text')}
                            <span class="file-label"
                              ><span class="file-name">${file.name}</span>
                              <span class="file-path">${file.path}</span></span
                            >
                          </button>
                        </li>`
                    )}
                  </ul>`
          }
        </section>
        <div class="utilities">
          <button class="nav-row utility" @click=${() => this.emit('open-vault')}>
            ${chromeIcon('folder-tree')}Open vault folder
          </button>
          ${
            this.vertical
              ? ''
              : html`<button class="nav-row utility" @click=${() => this.emit('open-settings')}>
                  ${chromeIcon('settings')}Settings
                </button>`
          }
        </div>
      </main>
    </writemd-panel>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-welcome-screen': WelcomeScreen
  }
}
