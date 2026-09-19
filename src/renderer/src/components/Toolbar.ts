import { html, css, LitElement } from 'lit'
import { customElement } from 'lit/decorators.js'
import { FileState, type ViewMode } from '../state/file-state'
import { SettingsStore } from '../state/settings'

@customElement('writemd-toolbar')
export class Toolbar extends LitElement {
  static styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      min-height: 44px;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      overflow-x: auto;
    }
    .toolbar-group {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 0 8px;
      border-right: 1px solid var(--border-subtle);
    }
    .toolbar-group:last-child {
      border-right: none;
      margin-left: auto;
    }
    .toolbar-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 32px;
      height: 32px;
      padding: 0 6px;
      gap: 6px;
      border-radius: 4px;
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
    }
    .toolbar-btn:hover {
      background: var(--bg-hover);
      color: var(--text);
    }
    .toolbar-btn.active {
      background: var(--accent);
      color: var(--accent-text);
    }
    .toolbar-btn svg {
      width: 16px;
      height: 16px;
    }
    kbd {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
      background: var(--bg);
      padding: 1px 5px;
      border-radius: 4px;
    }
    .mode-toggle {
      display: flex;
      background: var(--bg);
      border-radius: 8px;
      padding: 2px;
    }
  `

  private fileState = FileState.getInstance()
  private settingsStore = SettingsStore.getInstance()
  private unsubscribe: (() => void) | null = null

  connectedCallback(): void {
    super.connectedCallback()
    this.unsubscribe = this.fileState.subscribe(() => this.requestUpdate())
  }

  disconnectedCallback(): void {
    this.unsubscribe?.()
    super.disconnectedCallback()
  }

  render(): unknown {
    if (!this.settingsStore.get('appearance.toolbarVisible', true)) return html``
    const { viewMode, dirty } = this.fileState.getState()
    const mode = (m: ViewMode, label: string): unknown => html`
      <button
        class="toolbar-btn ${viewMode === m ? 'active' : ''}"
        @click=${() => this.fileState.setViewMode(m)}
        title="${label}"
        aria-pressed=${viewMode === m}
      >
        ${label}
      </button>
    `
    return html`
      <div class="toolbar-group">
        <button class="toolbar-btn" @click=${() => void this.fileState.newFile()} title="New file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New <kbd>Ctrl+N</kbd>
        </button>
        <button
          class="toolbar-btn"
          @click=${() => this.dispatchEvent(new CustomEvent('open-file', { bubbles: true, composed: true }))}
          title="Open file"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Open <kbd>Ctrl+O</kbd>
        </button>
        <button
          class="toolbar-btn"
          @click=${() => void this.fileState.save()}
          title="Save"
          ?disabled=${!dirty}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
          </svg>
          Save <kbd>Ctrl+S</kbd>
        </button>
      </div>
      <div class="toolbar-group">
        <div class="mode-toggle" role="group" aria-label="View mode">
          ${mode('wysiwyg', 'Write')} ${mode('split', 'Split')} ${mode('source', 'Source')}
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-toolbar': Toolbar
  }
}
