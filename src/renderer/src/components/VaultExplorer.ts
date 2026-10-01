import { html, css, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { scrollbarStyles } from './scrollbars'
import type { ElectronAPI, VaultTreeNode } from '../../../shared/electron-api'
import { FileState } from '../state/file-state'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

@customElement('writemd-vault-explorer')
export class VaultExplorer extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow-y: auto;
      box-sizing: border-box;
      padding: 12px 8px;
      font-family: 'Geist Mono', monospace;
      color: var(--text);
      user-select: none;
    }

    .tree-root {
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: 100%;
    }

    .node-row {
      display: flex;
      align-items: center;
      height: 28px;
      padding: 0 8px;
      border-radius: 4px;
      cursor: pointer;
      gap: 6px;
      font-size: 13px;
      line-height: 28px;
      transition:
        background 100ms ease,
        color 100ms ease;
    }

    .node-row:hover {
      background: var(--bg-hover);
      color: var(--text);
    }

    .node-row.active {
      background: var(--bg-active);
      color: var(--text);
      font-weight: 500;
    }

    .icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      color: var(--text-muted);
    }

    .node-row:hover .icon {
      color: var(--text-secondary);
    }

    .chevron {
      transition: transform 120ms ease;
    }

    .chevron.expanded {
      transform: rotate(90deg);
    }

    .node-name {
      white-space: nowrap;
      overflow: hidden;
      -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
      mask-image: linear-gradient(to right, black 80%, transparent 100%);
      flex: 1;
    }

    .children {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-left: 14px;
    }

    .empty-msg {
      padding: 24px 16px;
      color: var(--text-muted);
      font-size: 13px;
      text-align: center;
    }

    svg {
      width: 14px;
      height: 14px;
    }
    ${scrollbarStyles}

    .retry {
      display: block;
      margin: 8px auto 0;
      background: var(--bg-hover);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm, 4px);
      padding: 4px 12px;
      font-size: 12px;
      cursor: pointer;
    }

    .retry:hover {
      background: var(--bg-active);
    }

    .retry:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
    }

    .node-row:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: -2px;
    }
  `

  @state() private rootNode: VaultTreeNode | null = null
  @state() private expandedDirs = new Set<string>()
  @state() private loadError = false
  @state() private activePath: string | null = null
  private fileState = FileState.getInstance()
  private unsubscribeFileState: (() => void) | null = null

  connectedCallback(): void {
    super.connectedCallback()
    // The active-document highlight was read straight from getState() during
    // render with no subscription, so it only refreshed when something else
    // happened to re-render the panel. Subscribe instead.
    this.unsubscribeFileState = this.fileState.subscribe(() => {
      const state = this.fileState.getState()
      const next = state.secondaryDoc?.path ?? state.path ?? null
      if (next !== this.activePath) this.activePath = next
    })
    void this.refreshTree()
  }

  disconnectedCallback(): void {
    this.unsubscribeFileState?.()
    this.unsubscribeFileState = null
    super.disconnectedCallback()
  }

  async refreshTree(): Promise<void> {
    try {
      const tree = await api()?.vault?.getTree?.()
      // The panel can be torn down while the tree is in flight.
      if (!this.isConnected) return
      if (tree) {
        this.loadError = false
        this.rootNode = tree
        if (tree.path && !this.expandedDirs.has(tree.path)) {
          this.expandedDirs.add(tree.path)
        }
      }
    } catch (e) {
      if (!this.isConnected) return
      console.error('Failed to get vault tree:', e)
      // Without this the panel rendered "Loading files..." forever, because the
      // loading state doubled as the empty state and a rejection left rootNode
      // null with no way to retry.
      this.loadError = true
    }
  }

  private toggleDir(path: string, e: Event): void {
    e.stopPropagation()
    const next = new Set(this.expandedDirs)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    this.expandedDirs = next
  }

  /** Activate a row from the keyboard. The action and path ride on data-* so
   *  one listener serves both row types. */
  private handleRowKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const el = e.currentTarget as HTMLElement
    const path = el.dataset['path']
    if (!path) return
    e.preventDefault()
    if (el.dataset['action'] === 'dir') this.toggleDir(path, e)
    else void this.openFileNode(path, e)
  }

  private async openFileNode(path: string, e: Event): Promise<void> {
    e.stopPropagation()
    try {
      const fileContent = await api()?.file?.read?.(path)
      if (fileContent) {
        this.fileState.openSecondaryFile(path, fileContent.content)
      }
    } catch (e) {
      console.error(`Failed to open ${path}:`, e)
      // Previously the click simply did nothing, with no feedback at all.
      alert(`Could not open ${path.split(/[/\\]/).pop() ?? path}`)
    }
  }

  private renderNode(node: VaultTreeNode, depth = 0): unknown {
    if (node.isDirectory) {
      const isExpanded = this.expandedDirs.has(node.path)
      // Root level doesn't need indentation
      return html`
        <div class="dir-group">
          ${
            depth > 0
              ? html`
                  <div
                    class="node-row"
                    role="treeitem"
                    tabindex="0"
                    data-action="dir"
                    data-path=${node.path}
                    aria-expanded=${isExpanded ? 'true' : 'false'}
                    @click=${(e: Event) => this.toggleDir(node.path, e)}
                    @keydown=${this.handleRowKey}
                  >
                    <span class="icon">
                      <svg
                        class="chevron ${isExpanded ? 'expanded' : ''}"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </span>
                    <span class="icon">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path
                          d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
                        />
                      </svg>
                    </span>
                    <span class="node-name">${node.name}</span>
                  </div>
                `
              : ''
          }
          ${
            isExpanded || depth === 0
              ? html`
                  <div class="${depth > 0 ? 'children' : 'tree-root'}">
                    ${
                      node.children && node.children.length > 0
                        ? node.children.map((child) => this.renderNode(child, depth + 1))
                        : html`<div class="empty-msg">No markdown notes</div>`
                    }
                  </div>
                `
              : ''
          }
        </div>
      `
    }

    const isActive = this.activePath === node.path

    return html`
      <div
        class="node-row ${isActive ? 'active' : ''}"
        role="treeitem"
        tabindex="0"
        aria-selected=${isActive ? 'true' : 'false'}
        data-action="file"
        data-path=${node.path}
        @click=${(e: Event) => void this.openFileNode(node.path, e)}
        @keydown=${this.handleRowKey}
      >
        <span class="icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </span>
        <span class="node-name">${node.name}</span>
      </div>
    `
  }

  render(): unknown {
    if (this.loadError) {
      return html`
        <div class="empty-msg" role="alert">
          Could not read the vault.
          <button class="retry" @click=${() => void this.refreshTree()}>Retry</button>
        </div>
      `
    }
    if (!this.rootNode) {
      return html`<div class="empty-msg" aria-live="polite">Loading files...</div>`
    }
    return html`
      <div class="tree-root" role="tree" aria-label="Vault files">
        ${this.renderNode(this.rootNode, 0)}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-vault-explorer': VaultExplorer
  }
}
