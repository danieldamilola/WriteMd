import { html, css, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import type { ElectronAPI, VaultFile } from '../../../shared/electron-api'
import { FileState } from '../state/file-state'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

@customElement('writemd-sidebar')
export class Sidebar extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 280px;
      min-width: 220px;
      max-width: 400px;
      background: var(--bg-elevated);
      border-right: 1px solid var(--border);
      overflow: hidden;
      flex-shrink: 0;
    }
    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
    }
    .new-btn {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      color: var(--text-secondary);
    }
    .new-btn:hover {
      background: var(--bg-hover);
      color: var(--text);
    }
    .new-btn svg {
      width: 14px;
      height: 14px;
    }
    .file-tree {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .file-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
    }
    .file-item:hover {
      background: var(--bg-hover);
    }
    .file-item.active {
      background: var(--accent);
      color: var(--accent-text);
    }
    .file-item svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      color: var(--text-muted);
    }
    .file-item.active svg {
      color: var(--accent-text);
    }
    .file-name {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .empty-state {
      padding: 24px 16px;
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
    }
  `

  @state() private vaultFiles: VaultFile[] = []
  private fileState = FileState.getInstance()
  private unsubscribe: (() => void) | null = null

  connectedCallback(): void {
    super.connectedCallback()
    this.unsubscribe = this.fileState.subscribe(() => this.requestUpdate())
    void this.loadVaultFiles()
  }

  disconnectedCallback(): void {
    this.unsubscribe?.()
    super.disconnectedCallback()
  }

  private async loadVaultFiles(): Promise<void> {
    try {
      this.vaultFiles = (await api()?.vault?.listFiles?.()) ?? []
    } catch {
      this.vaultFiles = []
    }
  }

  render(): unknown {
    const currentPath = this.fileState.getState().path
    return html`
      <div class="sidebar-header">
        <span>Vault</span>
        <button
          class="new-btn"
          @click=${() => void this.fileState.newFile()}
          title="New file"
          aria-label="New file"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      <div class="file-tree">
        ${
          this.vaultFiles.length === 0
            ? html`<div class="empty-state">
                No files in vault yet.<br />Press Ctrl+N to create one.
              </div>`
            : this.vaultFiles.map(
                (file) => html`
                  <div
                    class="file-item ${currentPath === file.path ? 'active' : ''}"
                    @click=${() => void this.fileState.openFile(file.path)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span class="file-name">${file.name}</span>
                  </div>
                `
              )
        }
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-sidebar': Sidebar
  }
}
