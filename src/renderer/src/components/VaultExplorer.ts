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
      color: #d4d4d4;
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
      background: rgba(255, 255, 255, 0.05);
      color: #ffffff;
    }

    .node-row.active {
      background: rgba(255, 255, 255, 0.08);
      color: #ffffff;
      font-weight: 500;
    }

    .icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      color: #737373;
    }

    .node-row:hover .icon {
      color: #a3a3a3;
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
      color: #595959;
      font-size: 13px;
      text-align: center;
    }

    svg {
      width: 14px;
      height: 14px;
    }
    ${scrollbarStyles}
  `

  @state() private rootNode: VaultTreeNode | null = null
  @state() private expandedDirs = new Set<string>()
  private fileState = FileState.getInstance()

  async connectedCallback(): Promise<void> {
    super.connectedCallback()
    await this.refreshTree()
  }

  async refreshTree(): Promise<void> {
    try {
      const tree = await api()?.vault?.getTree?.()
      if (tree) {
        this.rootNode = tree
        if (tree.path && !this.expandedDirs.has(tree.path)) {
          this.expandedDirs.add(tree.path)
        }
      }
    } catch (e) {
      console.error('Failed to get vault tree:', e)
    }
  }

  private toggleDir(path: string, e: MouseEvent): void {
    e.stopPropagation()
    const next = new Set(this.expandedDirs)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    this.expandedDirs = next
  }

  private async openFileNode(path: string, e: MouseEvent): Promise<void> {
    e.stopPropagation()
    const fileContent = await api()?.file?.read?.(path)
    if (fileContent) {
      this.fileState.openSecondaryFile(path, fileContent.content)
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
                  <div class="node-row" @click=${(e: MouseEvent) => this.toggleDir(node.path, e)}>
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

    const currentSecondary = this.fileState.getState().secondaryDoc?.path
    const isActive = currentSecondary === node.path

    return html`
      <div
        class="node-row ${isActive ? 'active' : ''}"
        @click=${(e: MouseEvent) => this.openFileNode(node.path, e)}
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
    if (!this.rootNode) {
      return html`<div class="empty-msg">Loading files...</div>`
    }
    return html`<div class="tree-root">${this.renderNode(this.rootNode, 0)}</div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-vault-explorer': VaultExplorer
  }
}
