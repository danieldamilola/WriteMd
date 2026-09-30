import { html, css, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import './TopBar'
import './Tab'
import './VerticalTabBar'
import './DocBar'
import './Editor'
import './SettingsModal'
import './WelcomeScreen'
import './ConflictDialog'
import './CommandPalette'
import type { ElectronAPI } from '../../../shared/electron-api'
import { SettingsStore } from '../state/settings'
import { FileState, type ConflictInfo } from '../state/file-state'
import { COMMANDS, bindingFromEvent, bindingsEqual, effectiveBindings } from '../state/shortcuts'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

@customElement('writemd-app')
export class WriteMdApp extends LitElement {
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
    .tabs-row {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      width: 100%;
    }
    .tab-strip {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 0 1 auto;
      min-width: 0;
      /* offsetLeft on a tab is measured against this, so the scroll math in
         revealActiveTab() is only correct while the strip is the offset parent. */
      position: relative;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
      -webkit-app-region: drag;
    }
    .tab-strip::-webkit-scrollbar {
      display: none;
    }
    /* Only opt out of the window-drag region when tabs are actually hidden.
       A drag region swallows wheel events, so scrolling needs no-drag, but
       dropping it unconditionally would make the strip undraggable. */
    .tab-strip[data-more] {
      -webkit-app-region: no-drag;
    }
    /* Fade only the edge that still has hidden tabs, so a clipped tab reads as
       "scroll for more" rather than a rendering bug. */
    .tab-strip[data-more='right'] {
      -webkit-mask-image: linear-gradient(to right, black calc(100% - 24px), transparent 100%);
      mask-image: linear-gradient(to right, black calc(100% - 24px), transparent 100%);
    }
    .tab-strip[data-more='left'] {
      -webkit-mask-image: linear-gradient(to right, transparent 0, black 24px);
      mask-image: linear-gradient(to right, transparent 0, black 24px);
    }
    .tab-strip[data-more='both'] {
      -webkit-mask-image: linear-gradient(
        to right,
        transparent 0,
        black 24px,
        black calc(100% - 24px),
        transparent 100%
      );
      mask-image: linear-gradient(
        to right,
        transparent 0,
        black 24px,
        black calc(100% - 24px),
        transparent 100%
      );
    }
    .tab-add {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 20px;
      border-radius: 4px;
      color: var(--text-muted);
      cursor: pointer;
      flex-shrink: 0;
      -webkit-app-region: no-drag;
    }
    .tab-add:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.06);
    }
  `

  @state() private showWelcome = true
  @state() private showSettings = false
  @state() private showPalette = false
  @state() private splitActive = false
  @state() private panelOrientation: 'horizontal' | 'vertical' = 'horizontal'
  @state() private verticalPanelCollapsed = false
  @state() private tabs: Array<{ path: string | null; dirty: boolean }> = []
  @state() private activeTab = 0
  @state() private secondaryPath: string | null = null
  @state() private secondaryDirty = false
  @state() private conflict: ConflictInfo | null = null
  private settingsStore = SettingsStore.getInstance()
  private fileState = FileState.getInstance()
  private unsubscribeFileState: (() => void) | null = null
  private unsubscribeOrientation: (() => void) | null = null
  private unsubscribeFileOpen: (() => void) | null = null
  private stripObserver: ResizeObserver | null = null

  private get tabStrip(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.tab-strip')
  }

  /** Fade whichever edge still hides tabs. Cheap enough to run on every scroll. */
  private syncStripEdges(): void {
    const strip = this.tabStrip
    if (!strip) return
    const max = strip.scrollWidth - strip.clientWidth
    if (max <= 1) {
      strip.removeAttribute('data-more')
      return
    }
    const atStart = strip.scrollLeft <= 1
    const atEnd = strip.scrollLeft >= max - 1
    strip.dataset.more = atStart ? 'right' : atEnd ? 'left' : 'both'
  }

  private revealActiveTab(): void {
    const strip = this.tabStrip
    if (!strip) return
    this.syncStripEdges()
    const active = strip.querySelector<HTMLElement>('writemd-tab[active]')
    if (!active) return
    const pad = 12
    const left = active.offsetLeft
    const right = left + active.offsetWidth
    if (left < strip.scrollLeft + pad) {
      strip.scrollLeft = Math.max(0, left - pad)
    } else if (right > strip.scrollLeft + strip.clientWidth - pad) {
      strip.scrollLeft = right - strip.clientWidth + pad
    }
  }

  private handleStripScroll = (): void => {
    this.syncStripEdges()
  }

  connectedCallback(): void {
    super.connectedCallback()
    // Listener registration happens before the first await. An async
    // connectedCallback that adds listeners after an await can be torn down
    // while suspended, so disconnectedCallback runs first and removes nothing,
    // then the continuation attaches to a dead element with no teardown left.
    window.addEventListener('keydown', this.handleGlobalShortcuts)
    window.addEventListener('dragover', this.handleWindowDragOver)
    window.addEventListener('drop', this.handleWindowDrop)
    this.unsubscribeFileOpen =
      api()?.onFileOpenExternal?.((path: string) => {
        void this.fileState.openFile(path)
        this.showWelcome = false
      }) ?? null

    void this.initAsync()
  }

  private async initAsync(): Promise<void> {
    await this.settingsStore.init()
    if (!this.isConnected) return
    this.panelOrientation = this.settingsStore.get('appearance.panelOrientation', 'horizontal') as
      'horizontal' | 'vertical'
    this.unsubscribeOrientation = this.settingsStore.subscribe(
      'appearance.panelOrientation',
      (v) => {
        this.panelOrientation = (v as 'horizontal' | 'vertical') ?? 'horizontal'
      }
    )
    document.documentElement.setAttribute(
      'data-theme',
      this.settingsStore.get('appearance.theme', 'dark')
    )
    this.unsubscribeFileState = this.fileState.subscribe((s) => {
      this.splitActive = s.splitActive
      this.tabs = s.tabs
      this.activeTab = s.activeTab
      this.showWelcome = s.tabs.length === 0
      this.secondaryPath = s.secondaryDoc?.path ?? null
      this.secondaryDirty = s.secondaryDoc?.dirty ?? false
      this.conflict = s.conflict
      this.requestUpdate()
    })
    this.showWelcome = true
    await this.fileState.restoreTabs().catch(() => false)
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this.handleGlobalShortcuts)
    window.removeEventListener('dragover', this.handleWindowDragOver)
    window.removeEventListener('drop', this.handleWindowDrop)
    this.unsubscribeFileOpen?.()
    this.unsubscribeFileState?.()
    this.unsubscribeOrientation?.()
    this.stripObserver?.disconnect()
    this.stripObserver = null
    super.disconnectedCallback()
  }

  protected updated(): void {
    const strip = this.tabStrip
    if (!strip) return
    strip.addEventListener('scroll', this.handleStripScroll, { passive: true })
    if (!this.stripObserver && typeof ResizeObserver !== 'undefined') {
      // updated() runs before the strip has been laid out, so the scroll math
      // sees a zero-width element and does nothing. The observer re-runs it once
      // real geometry exists, and again whenever the window is resized.
      this.stripObserver = new ResizeObserver(() => this.revealActiveTab())
      this.stripObserver.observe(strip)
    }
    this.revealActiveTab()
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
    // Palette and settings modal get first refusal for Escape
    if (e.key === 'Escape') {
      if (this.showPalette) {
        this.showPalette = false
        return
      }
      return
    }
    // CodeMirror handles its own bindings (e.g. Mod-F) first.
    if (e.defaultPrevented) return
    // Never hijack keys while rebinding shortcuts in settings
    if (this.showSettings) return
    const pressed = bindingFromEvent(e)
    const overrides = this.settingsStore.get<Record<string, string>>('shortcuts.bindings', {})
    for (const cmd of COMMANDS) {
      const bindings = effectiveBindings(cmd.id, overrides)
      const matched = bindings.find((b) => bindingsEqual(pressed, b))
      if (!matched) continue
      if (!matched.mod && !matched.alt && !matched.shift) {
        // Bare keys must not hijack typing
        const target = e.target as HTMLElement | null
        if (
          target &&
          (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        ) {
          continue
        }
      }
      e.preventDefault()
      void this.runCommand(cmd.id)
      return
    }
  }

  private async runCommand(id: string): Promise<void> {
    this.showPalette = false
    switch (id) {
      case 'new-file':
        await this.fileState.newFile()
        this.showWelcome = false
        break
      case 'open-file':
        await this.openFileDialog()
        break
      case 'save':
        await this.fileState.save()
        break
      case 'save-as':
        await this.fileState.saveAs()
        break
      case 'export-pdf':
        await this.handleExport('pdf')
        break
      case 'export-html':
        await this.handleExport('html')
        break
      case 'export-docx':
        await this.handleExport('docx')
        break
      case 'quick-toggle':
        this.fileState.quickToggle()
        break
      case 'toggle-split':
        this.fileState.toggleSplitView()
        break
      case 'split-files':
        this.fileState.setSplitSurface('files')
        break
      case 'split-backlinks':
        this.fileState.setSplitSurface('backlinks')
        break
      case 'split-ai':
        this.fileState.setSplitSurface('ai')
        break
      case 'open-settings':
        this.showSettings = true
        break
      case 'find':
        window.dispatchEvent(new CustomEvent('writemd-find', { detail: { mode: 'find' } }))
        break
      case 'replace':
        window.dispatchEvent(new CustomEvent('writemd-find', { detail: { mode: 'replace' } }))
        break
      case 'command-palette':
        this.showPalette = true
        break
      case 'zoom-in':
      case 'zoom-out':
      case 'zoom-reset':
        await this.handleZoom(id)
        break
    }
  }

  private async handleZoom(id: 'zoom-in' | 'zoom-out' | 'zoom-reset'): Promise<void> {
    const bridge = api()?.window
    if (!bridge?.zoomIn) {
      alert('Zoom is unavailable. Restart the app to load the latest version.')
      return
    }
    try {
      if (id === 'zoom-in') await bridge.zoomIn()
      else if (id === 'zoom-out') await bridge.zoomOut()
      else await bridge.zoomReset()
    } catch (err) {
      console.error(`Zoom failed:`, err)
      alert(`Zoom failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async handleExport(kind: 'pdf' | 'html' | 'docx'): Promise<void> {
    const s = this.fileState.getState()
    try {
      const result = await api()?.export?.[kind]?.(s.content, s.path)
      if (result && !result.ok && result.reason !== 'canceled') {
        alert(`Export failed: ${result.reason ?? 'unknown error'}`)
      }
    } catch (err) {
      console.error(`Export ${kind} failed:`, err)
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
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

  private handleCloseSecondary = (): void => {
    if (
      this.secondaryDirty &&
      !confirm('You have unsaved changes in the split document. Close anyway?')
    ) {
      return
    }
    this.fileState.closeSecondaryFile()
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
          ${
            this.showPalette
              ? html`<writemd-command-palette
                  @close=${() => (this.showPalette = false)}
                  @run-command=${(e: CustomEvent<{ id: string }>) => void this.runCommand(e.detail.id)}
                ></writemd-command-palette>`
              : ''
          }
          ${this.conflict ? html`<writemd-conflict-dialog .conflict=${this.conflict}></writemd-conflict-dialog>` : ''}
        </div>
      `
    }

    const secondaryName = this.secondaryPath
      ? (this.secondaryPath.split(/[/\\]/).pop() ?? 'Secondary.md')
      : null

    return html`
      <div class="app-container">
        <writemd-top-bar
          .splitActive=${this.splitActive}
          .showPanelToggle=${this.panelOrientation === 'vertical'}
          .panelCollapsed=${this.verticalPanelCollapsed}
          @open-menu=${() => (this.showPalette = true)}
          @open-settings=${() => (this.showSettings = true)}
          @toggle-split=${() => this.fileState.toggleSplitView()}
          @toggle-panel=${() => (this.verticalPanelCollapsed = !this.verticalPanelCollapsed)}
        >
          <div
            slot="tabs"
            class="tabs-row"
            style="${this.panelOrientation === 'vertical' ? 'flex: 1;' : ''}"
          >
            ${
              this.panelOrientation === 'vertical'
                ? html`<writemd-doc-bar compact></writemd-doc-bar>`
                : html`
                    <div class="tab-strip">
                      ${this.tabs.map(
                        (t, i) => html`
                          <writemd-tab
                            label=${t.path?.split(/[/\\]/).pop() ?? 'Untitled.md'}
                            ?active=${i === this.activeTab}
                            .dirty=${t.dirty}
                            @select=${() => this.fileState.switchTab(i)}
                            @close=${() => void this.fileState.closeTab(i)}
                          ></writemd-tab>
                        `
                      )}
                      ${
                        secondaryName
                          ? html`
                              <writemd-tab
                                label=${secondaryName}
                                ?active=${false}
                                .dirty=${this.secondaryDirty}
                                @close=${this.handleCloseSecondary}
                              ></writemd-tab>
                            `
                          : ''
                      }
                    </div>
                    <div
                      class="tab-add"
                      title="Open file in new tab"
                      @click=${() => void this.openFileDialog()}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                      >
                        <line x1="7" y1="2" x2="7" y2="12" />
                        <line x1="2" y1="7" x2="12" y2="7" />
                      </svg>
                    </div>
                  `
            }
          </div>
        </writemd-top-bar>

        <div class="main-area">
          ${
            this.panelOrientation === 'vertical' && !this.verticalPanelCollapsed
              ? html`<writemd-vertical-tab-bar
                  .tabs=${this.tabs}
                  .activeTab=${this.activeTab}
                  .secondaryPath=${this.secondaryPath}
                  .secondaryDirty=${this.secondaryDirty}
                  @select-tab=${(e: CustomEvent<{ index: number }>) =>
                    this.fileState.switchTab(e.detail.index)}
                  @close-tab=${(e: CustomEvent<{ index: number }>) =>
                    void this.fileState.closeTab(e.detail.index)}
                  @add-tab=${() => void this.openFileDialog()}
                  @close-secondary=${this.handleCloseSecondary}
                ></writemd-vertical-tab-bar>`
              : ''
          }
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
          this.showPalette
            ? html`<writemd-command-palette
                @close=${() => (this.showPalette = false)}
                @run-command=${(e: CustomEvent<{ id: string }>) => void this.runCommand(e.detail.id)}
              ></writemd-command-palette>`
            : ''
        }
        ${
          this.conflict
            ? html`<writemd-conflict-dialog .conflict=${this.conflict}></writemd-conflict-dialog>`
            : ''
        }
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-app': WriteMdApp
  }
}
