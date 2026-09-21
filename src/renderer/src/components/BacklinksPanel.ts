import { html, css, LitElement } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { scrollbarStyles } from './scrollbars'
import type { ElectronAPI, VaultTreeNode } from '../../../shared/electron-api'
import { FileState } from '../state/file-state'
import { SettingsStore } from '../state/settings'
import { backlinkSnippet, basenameNoExt, linksToFile, shortPath } from '../utils/links'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

interface BacklinkHit {
  path: string
  snippet: string
}

function flattenTree(node: VaultTreeNode, out: string[]): void {
  if (node.isDirectory) {
    for (const child of node.children ?? []) flattenTree(child, out)
  } else if (node.path) {
    out.push(node.path)
  }
}

@customElement('writemd-backlinks-panel')
export class BacklinksPanel extends LitElement {
  static styles = [
    scrollbarStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow-y: auto;
        box-sizing: border-box;
        padding: 12px 8px;
        font-family: 'Geist Mono', monospace;
        color: #d4d4d4;
      }
      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 8px 8px 8px;
        color: #737373;
        font-size: 12px;
      }
      .toolbar button {
        display: flex;
        align-items: center;
        gap: 6px;
        background: transparent;
        border: none;
        color: #737373;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 4px;
      }
      .toolbar button:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.06);
      }
      .toolbar button svg {
        width: 13px;
        height: 13px;
      }
      .hit {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px;
        border-radius: 6px;
        cursor: pointer;
      }
      .hit:hover {
        background: rgba(255, 255, 255, 0.05);
      }
      .hit-name {
        font-size: 13px;
        color: #e8e8e8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .hit-snippet {
        font-size: 12px;
        color: #737373;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .empty-msg {
        padding: 24px 16px;
        color: #595959;
        font-size: 13px;
        text-align: center;
      }
    `
  ]

  @property({ type: String }) currentPath: string | null = null

  @state() private hits: BacklinkHit[] = []
  @state() private loading = false

  private fileState = FileState.getInstance()
  private settingsStore = SettingsStore.getInstance()
  private runId = 0

  connectedCallback(): void {
    super.connectedCallback()
    void this.refresh()
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('currentPath')) void this.refresh()
  }

  /** Re-scan open tabs, recent files (any folder) and the vault for links here. */
  async refresh(): Promise<void> {
    const target = this.currentPath
    const id = ++this.runId
    if (!target) {
      this.hits = []
      this.loading = false
      return
    }
    this.loading = true
    try {
      const contents = new Map<string, string>()
      // Open tabs first: live (possibly unsaved) content wins.
      for (const tab of this.fileState.getState().tabs) {
        if (tab.path && !contents.has(tab.path)) contents.set(tab.path, tab.content)
      }
      const recent = this.settingsStore.get<string[]>('files.recentFiles', [])
      const tree = await api()
        ?.vault?.getTree?.()
        .catch(() => undefined)
      const vaultPaths: string[] = []
      if (tree) flattenTree(tree, vaultPaths)
      const toRead = [...vaultPaths, ...recent].filter((p) => !contents.has(p))
      await Promise.all(
        toRead.map(async (p) => {
          try {
            const result = await api()?.file?.read?.(p)
            if (result && id === this.runId) contents.set(p, result.content)
          } catch {
            // Unreadable or deleted files simply don't participate.
          }
        })
      )
      if (id !== this.runId) return
      const found: BacklinkHit[] = []
      for (const [path, content] of contents) {
        if (path === target) continue
        if (linksToFile(path, content, target)) {
          found.push({ path, snippet: backlinkSnippet(content, path, target) })
        }
      }
      found.sort((a, b) => basenameNoExt(a.path).localeCompare(basenameNoExt(b.path)))
      this.hits = found
    } finally {
      if (id === this.runId) this.loading = false
    }
  }

  private async openHit(path: string): Promise<void> {
    await this.fileState.openFile(path)
  }

  render(): unknown {
    if (this.loading) {
      return html`<div class="empty-msg">Scanning for links…</div>`
    }
    return html`
      <div class="toolbar">
        <span>${this.hits.length === 1 ? '1 link' : `${this.hits.length} links`}</span>
        <button @click=${() => void this.refresh()} title="Rescan">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Rescan
        </button>
      </div>
      ${
        this.hits.length === 0
          ? html`<div class="empty-msg">No backlinks found for this document.</div>`
          : this.hits.map(
              (hit) => html`
                <div class="hit" @click=${() => void this.openHit(hit.path)} title=${hit.path}>
                  <div class="hit-name">${shortPath(hit.path)}</div>
                  ${hit.snippet ? html`<div class="hit-snippet">${hit.snippet}</div>` : ''}
                </div>
              `
            )
      }
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-backlinks-panel': BacklinksPanel
  }
}
