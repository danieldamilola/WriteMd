import { html, css, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import './TopBar'
import './Tab'
import './Editor'
import './SettingsModal'
import './WelcomeScreen'
import './ConflictDialog'
import type { ElectronAPI } from '../../../shared/electron-api'
import { SettingsStore } from '../state/settings'
import { FileState, type ConflictInfo } from '../state/file-state'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

@customElement('writemd-app')
export class WriteMDApp extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      width: 100vw;
      background: var(--bg);
      color: var(--text);
    }
    .app-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
    }
    :host-context([data-theme='dark']) .app-container {
      background: #0a0a0a;
    }
    .main-area {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }
    .editor-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
  `

  @state() private showWelcome = true
  @state() private showSettings = false
  @state() private splitActive = false
  @state() private currentPath: string | null = null
  @state() private isDirty = false
  @state() private secondaryPath: string | null = null
  @state() private secondaryDirty = false
  @state() private conflict: ConflictInfo | null = null
  private settingsStore = SettingsStore.getInstance()
  private fileState = FileState.getInstance()
  private unsubscribeFileState: (() => void) | null = null

  async connectedCallback(): Promise<void> {
    super.connectedCallback()
    await this.settingsStore.init()
    document.documentElement.setAttribute(
      'data-theme',
      this.settingsStore.get('appearance.theme', 'dark')
    )
    this.showWelcome = true
    this.unsubscribeFileState = this.fileState.subscribe((s) => {
      this.splitActive = s.splitActive
      this.currentPath = s.path
      this.isDirty = s.dirty
      this.secondaryPath = s.secondaryDoc?.path ?? null
      this.secondaryDirty = s.secondaryDoc?.dirty ?? false
      this.conflict = s.conflict
      this.requestUpdate()
    })

    api()?.onFileOpenExternal?.((path: string) => {
      void this.fileState.openFile(path)
      this.showWelcome = false
    })
    window.addEventListener('keydown', this.handleGlobalShortcuts)
    window.addEventListener('dragover', this.handleWindowDragOver)
    window.addEventListener('drop', this.handleWindowDrop)
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this.handleGlobalShortcuts)
    window.removeEventListener('dragover', this.handleWindowDragOver)
    window.removeEventListener('drop', this.handleWindowDrop)
    this.unsubscribeFileState?.()
    super.disconnectedCallback()
  }

  private handleWindowDragOver = (e: DragEvent): void => {
    e.preventDefault()
  }

  private handleWindowDrop = async (e: DragEvent): Promise<void> => {
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return
    const file = files[0]
    // If it's a markdown file dropped on the window (not image handled by editor)
    if (/\.(md|markdown|mdown|mkd)$/i.test(file.name)) {
      e.preventDefault()
      e.stopPropagation()
      // In Electron, File objects dropped from the OS have a 'path' property
      const filePath = (file as unknown as { path?: string }).path
      if (filePath) {
        await this.fileState.openFile(filePath)
        this.showWelcome = false
      }
    }
  }

  private handleGlobalShortcuts = (e: KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey
    if (!mod) return
    if (e.key === ',') {
      e.preventDefault()
      this.showSettings = true
    } else if (e.key === 'n') {
      e.preventDefault()
      void this.fileState.newFile()
      this.showWelcome = false
    } else if (e.key === 'o') {
      e.preventDefault()
      void this.openFileDialog()
    } else if (e.key === 's' && e.shiftKey) {
      e.preventDefault()
      void this.fileState.saveAs()
    } else if (e.key === 's' && e.altKey) {
      e.preventDefault()
      this.fileState.toggleSplitView()
    } else if (e.key === 's') {
      e.preventDefault()
      void this.fileState.save()
    } else if (e.key === 'e' && e.shiftKey) {
      e.preventDefault()
      this.fileState.setSplitSurface('files')
    } else if (e.key === 'b' && e.shiftKey) {
      e.preventDefault()
      this.fileState.setSplitSurface('backlinks')
    } else if (e.key === 'a' && e.altKey) {
      e.preventDefault()
      this.fileState.setSplitSurface('ai')
    } else if (e.key === 'e') {
      e.preventDefault()
      this.fileState.quickToggle()
    }
  }

  private async openFileDialog(): Promise<void> {
    const result = await api()?.file?.openDialog?.({
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }]
    })
    if (result && !result.canceled && result.filePaths[0]) {
      await this.fileState.openFile(result.filePaths[0])
      this.showWelcome = false
    }
  }

  private handleOpenVault = async (): Promise<void> => {
    const vaultPath = await api()
      ?.vault?.getPath?.()
      .catch(() => undefined)
    if (vaultPath) {
      await api()
        ?.shell?.openPath?.(vaultPath)
        .catch(() => undefined)
    }
  }

  render(): unknown {
    if (this.showWelcome) {
      return html`
        <div class="app-container">
          <writemd-welcome-screen
            @new-file=${() => {
              void this.fileState.newFile()
              this.showWelcome = false
            }}
            @open-file=${() => void this.openFileDialog()}
            @open-vault=${() => void this.handleOpenVault()}
            @open-settings=${() => (this.showSettings = true)}
            @open-recent=${(e: CustomEvent<{ path: string }>) => {
              void this.fileState.openFile(e.detail.path)
              this.showWelcome = false
            }}
          ></writemd-welcome-screen>
          ${this.showSettings ? html`<writemd-settings-modal @close=${() => (this.showSettings = false)}></writemd-settings-modal>` : ''}
          ${this.conflict ? html`<writemd-conflict-dialog .conflict=${this.conflict}></writemd-conflict-dialog>` : ''}
        </div>
      `
    }

    const currentPath = this.currentPath ?? this.fileState.getState().path ?? 'Untitled.md'
    const fileName = currentPath.split(/[/\\]/).pop() ?? 'Untitled.md'
    const secondaryName = this.secondaryPath
      ? (this.secondaryPath.split(/[/\\]/).pop() ?? 'Secondary.md')
      : null

    return html`
      <div class="app-container">
        <writemd-top-bar
          .splitActive=${this.splitActive}
          @open-menu=${() => void this.openFileDialog()}
          @open-settings=${() => (this.showSettings = true)}
          @toggle-split=${() => this.fileState.toggleSplitView()}
        >
          <div slot="tabs" style="display: flex; gap: 4px; align-items: center;">
            <writemd-tab
              label=${fileName}
              ?active=${true}
              .dirty=${this.isDirty}
              @close=${() => {
                if (this.isDirty && !confirm('You have unsaved changes. Close anyway?')) {
                  return
                }
                this.showWelcome = true
              }}
            ></writemd-tab>
            ${
              secondaryName
                ? html`
                    <writemd-tab
                      label=${secondaryName}
                      ?active=${false}
                      .dirty=${this.secondaryDirty}
                      @close=${() => {
                        if (
                          this.secondaryDirty &&
                          !confirm('You have unsaved changes in the split document. Close anyway?')
                        ) {
                          return
                        }
                        this.fileState.closeSecondaryFile()
                      }}
                    ></writemd-tab>
                  `
                : ''
            }
          </div>
        </writemd-top-bar>

        <div class="main-area">
          <div class="editor-wrapper">
            <writemd-editor></writemd-editor>
          </div>
        </div>

        ${
          this.showSettings
            ? html`<writemd-settings-modal
                @close=${() => (this.showSettings = false)}
              ></writemd-settings-modal>`
            : ''
        }
        ${
          this.conflict
            ? html`<writemd-conflict-dialog
                .conflict=${this.conflict}
              ></writemd-conflict-dialog>`
            : ''
        }
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-app': WriteMDApp
  }
}
