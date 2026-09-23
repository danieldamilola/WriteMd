import { html, css, LitElement } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { menuStyles, menuIcon, menuCheck } from './menu-styles'
import { FileState, type ViewMode } from '../state/file-state'
import type { ElectronAPI } from '../../../shared/electron-api'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

/**
 * Document strip: parent/file path left, renameable title center,
 * reading toggle + note menu right. Rendered inside the top bar in
 * vertical-tabs mode (Figma 148:145/132/133) and inside the editor
 * panel otherwise. Talks to FileState/electronAPI directly.
 */
@customElement('writemd-doc-bar')
export class DocBar extends LitElement {
  static styles = [
    menuStyles,
    css`
      :host {
        display: flex;
        flex: 1;
        min-width: 0;
        min-height: 0;
        /* Top-bar slot is a window-drag region; opt out so clicks land. */
        -webkit-app-region: no-drag;
      }
      .sub-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 49px;
        width: 100%;
        padding: 0 20px;
        flex-shrink: 0;
        user-select: none;
        font-family: 'Geist Mono', monospace;
        font-size: 14px;
        box-sizing: border-box;
      }
      .sub-header-left {
        display: flex;
        align-items: center;
        color: #595959;
        font-size: 13px;
        overflow: hidden;
        white-space: nowrap;
        -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
        mask-image: linear-gradient(to right, black 80%, transparent 100%);
        flex: 1;
      }
      .sub-header-center {
        color: #d4d4d4;
        font-size: 14px;
        font-weight: 500;
        text-align: center;
        flex: 1;
        overflow: hidden;
        white-space: nowrap;
      }
      input.title-input {
        background: transparent;
        border: 1px solid transparent;
        color: inherit;
        font-family: inherit;
        font-size: inherit;
        font-weight: inherit;
        text-align: center;
        width: 100%;
        outline: none;
        padding: 2px 4px;
        border-radius: 4px;
        box-sizing: border-box;
      }
      input.title-input:hover,
      input.title-input:focus {
        background: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.1);
      }
      .sub-header-right {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: flex-end;
        flex: 1;
      }
      .icon-action {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        color: #6b6b6b;
        cursor: pointer;
        transition:
          color 120ms ease,
          background 120ms ease;
      }
      .icon-action:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.06);
      }
      .icon-action svg {
        width: 14px;
        height: 14px;
      }
      .icon-action.faint {
        opacity: 0.35;
      }
      .icon-action.faint:hover {
        opacity: 1;
      }
      .menu-wrap {
        position: relative;
      }
      .menu-backdrop {
        position: fixed;
        inset: 0;
        z-index: 90;
      }
      .m-panel.note-menu {
        /* Fixed so the menu escapes the top bar's overflow:hidden slot. */
        position: fixed;
        min-width: 230px;
        z-index: 200;
      }
      :host([compact]) .sub-header {
        height: 28px;
        /* Left offset aligns path/title with the inner panel below:
           rail (20 padding + 196 width + 12 margin = 228) minus
           top-bar leading (28 padding + 94 buttons + 21 slot margin = 143),
           plus the standard 12px gutter. */
        padding: 0 12px 0 97px;
      }
      :host([compact]) .icon-action svg {
        width: 18px;
        height: 18px;
      }
    `
  ]

  @state() private filePath: string | null = null
  @state() private viewMode: ViewMode = 'live'
  @state() private showMoreMenu = false
  @state() private menuPos: { x: number; y: number } | null = null
  @property({ type: Boolean, reflect: true }) compact = false
  private fileState = FileState.getInstance()
  private unsubscribe: (() => void) | null = null

  connectedCallback(): void {
    super.connectedCallback()
    const s = this.fileState.getState()
    this.filePath = s.path
    this.viewMode = s.viewMode === 'wysiwyg' ? 'live' : s.viewMode
    this.unsubscribe = this.fileState.subscribe((fs) => {
      const mode = fs.viewMode === 'wysiwyg' ? 'live' : fs.viewMode
      if (this.filePath !== fs.path || this.viewMode !== mode) {
        this.filePath = fs.path
        this.viewMode = mode
      }
    })
  }

  disconnectedCallback(): void {
    this.unsubscribe?.()
    super.disconnectedCallback()
  }

  private getDisplayPath(fullPath: string | null): string {
    if (!fullPath) return 'Untitled.md'
    const parts = fullPath.replace(/\\/g, '/').split('/')
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
    }
    return parts[parts.length - 1] || 'Untitled.md'
  }

  private getDisplayTitle(fullPath: string | null): string {
    if (!fullPath) return 'Untitled'
    const fileName = fullPath.replace(/\\/g, '/').split('/').pop() || 'Untitled'
    return fileName.replace(/\.[^/.]+$/, '')
  }

  private renderToggleIcon(mode: ViewMode): unknown {
    if (mode === 'reading') {
      return html`
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
      `
    }
    return html`
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    `
  }

  private noteMenuItems(): Array<{
    id: string
    label: string
    icon: string
    dividerBefore?: boolean
    danger?: boolean
    checked?: boolean
  }> {
    return [
      { id: 'backlinks', label: 'Backlinks in document', icon: 'backlinks' },
      {
        id: 'reading',
        label: 'Reading view',
        icon: 'eye',
        dividerBefore: true,
        checked: this.viewMode === 'reading'
      },
      { id: 'source', label: 'Source mode', icon: 'code', checked: this.viewMode === 'source' },
      { id: 'split', label: 'Split right', icon: 'split', dividerBefore: true },
      { id: 'rename', label: 'Rename', icon: 'pencil', dividerBefore: true },
      { id: 'move', label: 'Move file to', icon: 'folder' },
      { id: 'pdf', label: 'Export to PDF', icon: 'file', dividerBefore: true },
      { id: 'docx', label: 'Export to Word', icon: 'file' },
      { id: 'find', label: 'Find', icon: 'search', dividerBefore: true },
      { id: 'replace', label: 'Replace', icon: 'search' },
      { id: 'copy-path', label: 'Copy path', icon: 'copy', dividerBefore: true },
      { id: 'reveal-explorer', label: 'Show in system explorer', icon: 'external' },
      { id: 'reveal-nav', label: 'Reveal file in navigation', icon: 'reveal' },
      { id: 'delete', label: 'Delete file', icon: 'trash', dividerBefore: true, danger: true }
    ]
  }

  private toggleMoreMenu(e: MouseEvent): void {
    e.stopPropagation()
    if (this.showMoreMenu) {
      this.showMoreMenu = false
      this.menuPos = null
      return
    }
    const btn = e.currentTarget as HTMLElement
    const rect = btn.getBoundingClientRect()
    this.menuPos = {
      x: Math.max(8, rect.right - 230),
      y: rect.bottom + 4
    }
    this.showMoreMenu = true
  }

  private async handleNoteAction(id: string): Promise<void> {
    this.showMoreMenu = false
    this.menuPos = null
    switch (id) {
      case 'backlinks':
        this.fileState.setSplitSurface('backlinks')
        break
      case 'reading':
        this.fileState.setExplicitMode('reading')
        break
      case 'source':
        this.fileState.setExplicitMode('source')
        break
      case 'split':
        this.fileState.toggleSplitView(true)
        break
      case 'rename': {
        const input = this.shadowRoot?.querySelector('.title-input') as HTMLInputElement | null
        input?.focus()
        input?.select()
        break
      }
      case 'move':
        await this.fileState.moveActiveFile()
        break
      case 'pdf':
      case 'docx':
        await this.handleExport(id)
        break
      case 'find':
      case 'replace':
        window.dispatchEvent(new CustomEvent('writemd-find', { detail: { mode: id } }))
        break
      case 'copy-path': {
        const path = this.fileState.getState().path
        if (path) {
          try {
            await navigator.clipboard.writeText(path)
          } catch (err) {
            console.error('Copy path failed:', err)
          }
        }
        break
      }
      case 'reveal-explorer': {
        const path = this.fileState.getState().path
        if (path) {
          await api()
            ?.shell?.showInFolder?.(path)
            .catch(() => undefined)
        }
        break
      }
      case 'reveal-nav':
        this.fileState.setSplitSurface('files')
        break
      case 'delete': {
        const path = this.fileState.getState().path
        if (!path) break
        const base = path.split(/[/\\]/).pop() ?? path
        if (!confirm(`Move ${base} to trash?`)) break
        const ok = await api()?.file?.delete?.(path)
        if (!ok) {
          alert('Could not delete file')
          break
        }
        const idx = this.fileState.getState().tabs.findIndex((t) => t.path === path)
        if (idx >= 0) await this.fileState.closeTab(idx)
        break
      }
    }
  }

  private async handleExport(kind: 'pdf' | 'docx'): Promise<void> {
    const bridge = api()?.export
    if (!bridge) {
      alert('Export is unavailable. Restart the app to load the latest version.')
      return
    }
    const s = this.fileState.getState()
    try {
      const result = await bridge[kind](s.content, s.path)
      if (!result.ok && result.reason !== 'canceled') {
        alert(`Export failed: ${result.reason ?? 'unknown error'}`)
      }
    } catch (err) {
      console.error(`Export ${kind} failed:`, err)
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async handleRename(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement
    const newName = input.value.trim()
    if (!newName) {
      input.value = this.getDisplayTitle(this.filePath)
      input.blur()
      return
    }
    await this.fileState.renameFile(newName, false)
  }

  private handleRenameKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      ;(e.target as HTMLInputElement).blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      const input = e.target as HTMLInputElement
      input.value = this.getDisplayTitle(this.filePath)
      input.blur()
    }
  }

  render(): unknown {
    return html`
      <div class="sub-header">
        <div class="sub-header-left" title=${this.filePath ?? ''}>
          ${this.getDisplayPath(this.filePath)}
        </div>
        <div class="sub-header-center">
          <input
            type="text"
            class="title-input"
            .value=${this.getDisplayTitle(this.filePath)}
            @blur=${(e: Event) => void this.handleRename(e)}
            @keydown=${this.handleRenameKeyDown}
          />
        </div>
        <div class="sub-header-right">
          <div
            class="icon-action"
            title="Toggle Reading / Live Mode"
            @click=${() => this.fileState.quickToggle()}
          >
            ${this.renderToggleIcon(this.viewMode)}
          </div>
          <div class="menu-wrap">
            <div
              class="icon-action faint"
              title="More Options"
              @click=${this.toggleMoreMenu}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </div>
            ${this.showMoreMenu
              ? html`
                  <div
                    class="menu-backdrop"
                    @click=${() => {
                      this.showMoreMenu = false
                      this.menuPos = null
                    }}
                  ></div>
                  <div
                    class="m-panel note-menu"
                    style="left: ${this.menuPos?.x ?? 0}px; top: ${this.menuPos?.y ?? 0}px;"
                  >
                    ${this.noteMenuItems().map(
                      (item) => html`
                        ${item.dividerBefore ? html`<div class="m-divider"></div>` : ''}
                        <div
                          class=${item.danger ? 'm-item danger' : 'm-item'}
                          @click=${() => void this.handleNoteAction(item.id)}
                        >
                          ${menuIcon(item.icon)}
                          <span>${item.label}</span>
                          ${item.checked ? menuCheck() : ''}
                        </div>
                      `
                    )}
                  </div>
                `
              : ''}
          </div>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-doc-bar': DocBar
  }
}
