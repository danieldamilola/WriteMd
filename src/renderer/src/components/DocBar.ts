import { html, css, LitElement } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { menuStyles, menuIcon, menuCheck } from './menu-styles'
import {
  FileState,
  type ViewMode,
  type FileStateData,
  type SecondaryDocState
} from '../state/file-state'
import { api } from '../api'
import { displayPath, displayTitle } from '../utils/links'
import { showConfirm } from '../services/confirm'
import { emit } from '../events/bus'
import './ContextMenu'

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
        min-width: 0;
        min-height: 0;
        /* Top-bar slot is a window-drag region; opt out so clicks land. */
        -webkit-app-region: no-drag;
      }
      :host([compact]) {
        flex: 1;
      }
      .sub-header {
        position: relative;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        align-items: center;
        justify-content: space-between;
        height: 49px;
        width: 100%;
        padding: 0 20px;
        flex-shrink: 0;
        user-select: none;
        font-family: var(--font-ui);
        font-size: 13px;
        box-sizing: border-box;
      }
      .sub-header-left {
        display: flex;
        align-items: center;
        color: var(--text-muted);
        font-size: 13px;
        overflow: hidden;
        white-space: nowrap;
        -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
        mask-image: linear-gradient(to right, black 80%, transparent 100%);
        flex: 1;
      }
      .sub-header-center {
        color: var(--text);
        font-size: 14px;
        font-weight: 500;
        text-align: center;
        flex: 1;
        overflow: hidden;
        white-space: nowrap;
        min-width: 0;
        width: 100%;
        max-width: 240px;
        justify-self: center;
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
        background: var(--bg-hover);
        border-color: var(--border);
      }
      .sub-header-right {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: flex-end;
        flex: 1;
        min-width: 0;
      }
      .icon-action {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        color: var(--text-muted);
        cursor: pointer;
        transition:
          color 120ms ease,
          background 120ms ease,
          transform 100ms ease;
      }

      .icon-action:active {
        transform: scale(0.92);
      }
      .icon-action:hover {
        color: var(--text);
        background: var(--bg-hover);
      }
      .icon-action svg {
        width: 14px;
        height: 14px;
      }
      .menu-wrap {
        position: relative;
      }
      .m-panel.note-menu {
        width: max-content;
        min-width: 230px;
        pointer-events: auto;
      }

      :host-context([data-motion='reduced']) {
        .icon-action {
          transition: none;
        }
        .icon-action:active {
          transform: none;
        }
      }
      :host([compact]) .sub-header {
        height: var(--shell-header-height);
        padding: 0 24px;
      }
      :host([compact]) .sub-header-left {
        display: flex;
        font-size: 12px;
        min-width: 0;
      }
      :host([compact]) .sub-header-right {
        flex: 0 0 auto;
        padding-right: var(--document-caption-inset, 0px);
        pointer-events: auto;
      }
      :host([compact]) .sub-header-center {
        width: calc(100% - 80px);
        pointer-events: auto;
      }
      :host([compact]) .sub-header-left {
        pointer-events: auto;
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
  private menuAnchor: HTMLElement | null = null
  @property({ type: Boolean, reflect: true }) compact = false
  @property({ type: Boolean, reflect: true }) secondary = false
  private fileState = FileState.getInstance()
  private unsubscribe: (() => void) | null = null
  private get document(): FileStateData | SecondaryDocState | null {
    const state = this.fileState.getState()
    return this.secondary ? state.secondaryDoc : state
  }
  private setMode(mode: ViewMode): void {
    if (this.secondary) this.fileState.setSecondaryViewMode(mode)
    else this.fileState.setExplicitMode(mode)
  }

  connectedCallback(): void {
    super.connectedCallback()
    const sync = (): void => {
      const fs = this.document
      if (!fs) return
      const mode = fs.viewMode === 'wysiwyg' ? 'live' : fs.viewMode
      if (this.filePath !== fs.path || this.viewMode !== mode) {
        this.filePath = fs.path
        this.viewMode = mode
      }
    }
    sync()
    this.unsubscribe = this.fileState.subscribe(sync)
  }

  disconnectedCallback(): void {
    this.unsubscribe?.()
    super.disconnectedCallback()
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
      {
        id: this.secondary ? 'close' : 'split',
        label: this.secondary ? 'Close split pane' : 'Split right',
        icon: 'split',
        dividerBefore: true
      },
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
    ].filter((item) => !this.secondary || item.id !== 'backlinks')
  }

  private toggleMoreMenu(e: Event): void {
    e.stopPropagation()
    if (this.showMoreMenu) {
      this.showMoreMenu = false
      this.menuAnchor = null
      return
    }
    this.menuAnchor = e.currentTarget as HTMLElement
    this.showMoreMenu = true
  }

  /** Enter/Space on an icon-action div, so it is reachable by keyboard. */
  private handleIconKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).click()
  }

  private async handleNoteAction(id: string): Promise<void> {
    this.showMoreMenu = false
    this.menuAnchor = null
    await this.updateComplete
    switch (id) {
      case 'backlinks':
        this.fileState.setSplitSurface('backlinks')
        break
      case 'reading':
        this.setMode('reading')
        break
      case 'source':
        this.setMode('source')
        break
      case 'split':
        this.fileState.toggleSplitView(true)
        break
      case 'close':
        this.fileState.closeSecondaryFile()
        break
      case 'rename': {
        const input = this.shadowRoot?.querySelector('.title-input') as HTMLInputElement | null
        input?.focus()
        input?.select()
        break
      }
      case 'move':
        await this.fileState.moveActiveFile(this.secondary)
        break
      case 'pdf':
      case 'docx':
        await this.handleExport(id)
        break
      case 'find':
      case 'replace':
        emit('find:open', { mode: id, pane: this.secondary ? 'secondary' : 'primary' })
        break
      case 'copy-path': {
        const path = this.document?.path
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
        const path = this.document?.path
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
        const path = this.document?.path
        if (!path) break
        const base = path.split(/[/\\]/).pop() ?? path
        if (!(await showConfirm(`Move ${base} to trash?`, 'Delete file'))) break
        const ok = await api()?.file?.delete?.(path)
        if (!ok) {
          alert('Could not delete file')
          break
        }
        if (this.fileState.getState().secondaryDoc?.path === path)
          this.fileState.closeSecondaryFile()
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
    const s = this.document
    if (!s) return
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
      input.value = displayTitle(this.filePath)
      input.blur()
      return
    }
    await this.fileState.renameFile(newName, this.secondary)
  }

  private handleRenameKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      ;(e.target as HTMLInputElement).blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      const input = e.target as HTMLInputElement
      input.value = displayTitle(this.filePath)
      input.blur()
    }
  }

  render(): unknown {
    return html`
      <div class="sub-header">
        <div class="sub-header-left" title=${this.filePath ?? ''}>
          ${displayPath(this.filePath)}
        </div>
        <div class="sub-header-center">
          <input
            type="text"
            class="title-input"
            aria-label=${this.secondary ? 'Split pane document title' : 'Document title'}
            .value=${displayTitle(this.filePath)}
            @blur=${(e: Event) => void this.handleRename(e)}
            @keydown=${this.handleRenameKeyDown}
          />
        </div>
        <div class="sub-header-right">
          <div
            class="icon-action"
            role="button"
            tabindex="0"
            aria-label="Toggle Reading / Live Mode"
            title="Toggle Reading / Live Mode"
            @click=${() => (this.secondary ? this.setMode(this.viewMode === 'reading' ? 'live' : 'reading') : this.fileState.quickToggle())}
            @keydown=${this.handleIconKey}
          >
            ${this.renderToggleIcon(this.viewMode)}
          </div>
          <div class="menu-wrap">
            <div
              class="icon-action"
              role="button"
              tabindex="0"
              aria-label="More Options"
              aria-haspopup="menu"
              aria-expanded=${this.showMoreMenu ? 'true' : 'false'}
              title="More Options"
              @click=${this.toggleMoreMenu}
              @keydown=${this.handleIconKey}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </div>
            ${
              this.showMoreMenu
                ? html`
                    <writemd-context-menu
                      .anchor=${this.menuAnchor}
                      placement="bottom-end"
                      @menu-dismiss=${() => {
                        this.showMoreMenu = false
                        this.menuAnchor = null
                      }}
                    >
                      <div class="m-panel note-menu" role="menu" aria-label="Document options">
                        ${this.noteMenuItems().map(
                          (item) => html`
                            ${
                              item.dividerBefore
                                ? html`<div class="m-divider" role="separator"></div>`
                                : ''
                            }
                            <div
                              class=${item.danger ? 'm-item danger' : 'm-item'}
                              role="menuitem"
                              tabindex="-1"
                              data-id=${item.id}
                              @click=${() => void this.handleNoteAction(item.id)}
                            >
                              ${menuIcon(item.icon)}
                              <span>${item.label}</span>
                              ${item.checked ? menuCheck() : ''}
                            </div>
                          `
                        )}
                      </div>
                    </writemd-context-menu>
                  `
                : ''
            }
          </div>
          ${this.secondary ? html`<div class="icon-action" role="button" tabindex="0" aria-label="Close split pane" title="Close split pane" @click=${() => this.fileState.closeSecondaryFile()} @keydown=${this.handleIconKey}>${menuIcon('x')}</div>` : ''}
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
