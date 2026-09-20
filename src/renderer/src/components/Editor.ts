import { html, css, LitElement, unsafeCSS } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import katexCss from 'katex/dist/katex.min.css?inline'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine
} from '@codemirror/view'
import { EditorState, Extension, Compartment } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { unifiedMergeView } from '@codemirror/merge'
import { GFM } from '@lezer/markdown'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import { writeMDTheme } from './EditorTheme'
import { livePreviewPlugin, readOnlyExtension, documentPathFacet, tableLinePlugin } from './LivePreview'
import { mathPlugin } from './extensions/math-plugin'
import { frontmatterPlugin } from './extensions/frontmatter-plugin'
import { wikiLinkPlugin } from './extensions/wiki-link-plugin'
import { slashCommandPlugin } from './extensions/slash-command'
import { tableKeymapPlugin } from './extensions/table-keys'
import { tableToolbarField } from './extensions/table-toolbar'
import { FileState, ViewMode, SplitSurface, SecondaryDocState } from '../state/file-state'
import './Panel'
import './InfoPill'
import './SurfaceLauncher'
import './VaultExplorer'
import type { ElectronAPI } from '../../../shared/electron-api'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

@customElement('writemd-editor')
export class Editor extends LitElement {
  static styles = [
    unsafeCSS(katexCss),
    css`
    :host {
      display: flex;
      flex: 1;
      min-height: 0;
      min-width: 0;
      position: relative;
      background: #0a0a0a;
      box-sizing: border-box;
      padding: 0 5px 5px 5px;
    }

    ::-webkit-scrollbar {
      width: 4px;
      height: 4px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: #262626;
      border-radius: 2px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #3a3a3a;
    }

    .workspace {
      display: flex;
      flex: 1;
      min-height: 0;
      min-width: 0;
      gap: 8px;
      position: relative;
      height: 100%;
    }

    .pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 320px;
      position: relative;
      height: 100%;
      overflow: hidden;
    }

    /* Sub-header inside editor panel (49px) */
    .sub-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 49px;
      padding: 0 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      flex-shrink: 0;
      user-select: none;
      font-family: 'Geist Mono', monospace;
      font-size: 14px;
    }

    .sub-header-left {
      display: flex;
      align-items: center;
      color: #595959;
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .sub-header-center {
      color: #d4d4d4;
      font-size: 14px;
      font-weight: 500;
      text-align: center;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
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

    /* Editor body area */
    .body-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
      position: relative;
      overflow: hidden;
    }

    .cm-wrapper {
      flex: 1;
      height: 100%;
      min-height: 0;
      min-width: 0;
      overflow: hidden;
      position: relative;
      width: 100%;
    }

    .cm-editor {
      height: 100%;
      width: 100%;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #595959;
      font-family: 'Geist Mono', monospace;
      gap: 12px;
    }

    .empty-state svg {
      width: 44px;
      height: 44px;
      opacity: 0.4;
    }
  `
  ]

  private fileState = FileState.getInstance()
  private unsubscribe: (() => void) | null = null
  private editorView: EditorView | null = null
  private secondaryEditorView: EditorView | null = null

  private primaryModeCompartment = new Compartment()
  private secondaryModeCompartment = new Compartment()
  private primaryPathCompartment = new Compartment()
  private secondaryPathCompartment = new Compartment()

  @state() private content = ''
  @state() private filePath: string | null = null
  @state() private viewMode: ViewMode = 'live'
  @state() private splitActive = false
  @state() private splitSurface: SplitSurface = 'launcher'
  @state() private secondaryDoc: SecondaryDocState | null = null

  connectedCallback(): void {
    super.connectedCallback()
    const current = this.fileState.getState()
    this.content = current.content
    this.filePath = current.path
    this.viewMode = current.viewMode === 'wysiwyg' ? 'live' : current.viewMode
    this.splitActive = current.splitActive
    this.splitSurface = current.splitSurface
    this.secondaryDoc = current.secondaryDoc

    this.unsubscribe = this.fileState.subscribe((s) => {
      const normalizedMode = s.viewMode === 'wysiwyg' ? 'live' : s.viewMode
      const modeChanged = this.viewMode !== normalizedMode
      const docChanged = this.content !== s.content
      const pathChanged = this.filePath !== s.path
      const secondaryDocChanged = this.secondaryDoc?.content !== s.secondaryDoc?.content
      const secondaryPathChanged = this.secondaryDoc?.path !== s.secondaryDoc?.path
      const secondaryModeChanged = this.secondaryDoc?.viewMode !== s.secondaryDoc?.viewMode

      this.content = s.content
      this.filePath = s.path
      this.viewMode = normalizedMode
      this.splitActive = s.splitActive
      this.splitSurface = s.splitSurface
      this.secondaryDoc = s.secondaryDoc

      if (this.editorView && docChanged && s.content !== this.editorView.state.doc.toString()) {
        this.editorView.dispatch({
          changes: { from: 0, to: this.editorView.state.doc.length, insert: s.content }
        })
      }

      if (this.editorView && pathChanged) {
        this.editorView.dispatch({
          effects: this.primaryPathCompartment.reconfigure(documentPathFacet.of(s.path))
        })
      }

      if (
        this.secondaryEditorView &&
        s.secondaryDoc &&
        secondaryDocChanged &&
        s.secondaryDoc.content !== this.secondaryEditorView.state.doc.toString()
      ) {
        this.secondaryEditorView.dispatch({
          changes: {
            from: 0,
            to: this.secondaryEditorView.state.doc.length,
            insert: s.secondaryDoc.content
          }
        })
      }

      if (this.secondaryEditorView && s.secondaryDoc && secondaryPathChanged) {
        this.secondaryEditorView.dispatch({
          effects: this.secondaryPathCompartment.reconfigure(
            documentPathFacet.of(s.secondaryDoc.path)
          )
        })
      }

      if (modeChanged && this.editorView) {
        this.editorView.dispatch({
          effects: this.primaryModeCompartment.reconfigure(this.getModeExtensions(normalizedMode))
        })
        requestAnimationFrame(() => {
          this.editorView?.requestMeasure()
        })
      }

      if (secondaryModeChanged && this.secondaryEditorView && s.secondaryDoc) {
        this.secondaryEditorView.dispatch({
          effects: this.secondaryModeCompartment.reconfigure(
            this.getModeExtensions(s.secondaryDoc.viewMode)
          )
        })
        requestAnimationFrame(() => {
          this.secondaryEditorView?.requestMeasure()
        })
      }

      this.requestUpdate()
    })
  }

  disconnectedCallback(): void {
    this.unsubscribe?.()
    this.editorView?.destroy()
    this.secondaryEditorView?.destroy()
    this.editorView = null
    this.secondaryEditorView = null
    super.disconnectedCallback()
  }

  firstUpdated(): void {
    this.initEditor()
  }

  updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties)
    if (!this.editorView && (this.filePath || this.content)) {
      this.initEditor()
    }

    if (this.splitActive && this.secondaryDoc && !this.secondaryEditorView) {
      this.initSecondaryEditor()
    } else if ((!this.splitActive || !this.secondaryDoc) && this.secondaryEditorView) {
      this.secondaryEditorView.destroy()
      this.secondaryEditorView = null
    }
  }

  private getModeExtensions(mode: ViewMode): Extension[] {
    const normalized = mode === 'wysiwyg' || mode === 'split' ? 'live' : mode
    if (normalized === 'reading') {
      return [readOnlyExtension(true), livePreviewPlugin()]
    }
    if (normalized === 'source') {
      return [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        readOnlyExtension(false)
      ]
    }
    // Default: 'live' (Obsidian Live Preview)
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      readOnlyExtension(false),
      livePreviewPlugin()
    ]
  }

  private getBaseExtensions(
    isSecondary: boolean,
    mode: ViewMode,
    currentPath: string | null
  ): Extension[] {
    const comp = isSecondary ? this.secondaryModeCompartment : this.primaryModeCompartment
    const pathComp = isSecondary ? this.secondaryPathCompartment : this.primaryPathCompartment

    const exts = [
      writeMDTheme,
      EditorView.lineWrapping,
      history(),
      search({top: true}),
      mathPlugin,
      frontmatterPlugin,
      wikiLinkPlugin,
      slashCommandPlugin,
      tableKeymapPlugin,
      tableToolbarField,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      markdown({ extensions: [GFM], codeLanguages: languages }),
      tableLinePlugin,
      comp.of(this.getModeExtensions(mode)),
      pathComp.of(documentPathFacet.of(currentPath)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newDoc = update.state.doc.toString()
          if (isSecondary) {
            this.fileState.setSecondaryContent(newDoc)
          } else {
            this.content = newDoc
            this.fileState.setContent(newDoc)
          }
        }
      })
    ]

    if (isSecondary && this.secondaryDoc?.isDiff) {
      exts.push(unifiedMergeView({ original: this.secondaryDoc.originalContent }))
    }

    return exts
  }

  private initEditor(): void {
    const container = this.shadowRoot?.querySelector('#primary-cm-wrapper')
    if (!container) return

    this.editorView?.destroy()

    const state = EditorState.create({
      doc: this.content,
      extensions: this.getBaseExtensions(false, this.viewMode, this.filePath)
    })

    this.editorView = new EditorView({
      state,
      parent: container
    })

    requestAnimationFrame(() => {
      this.editorView?.requestMeasure()
    })
  }

  private initSecondaryEditor(): void {
    const container = this.shadowRoot?.querySelector('#secondary-cm-wrapper')
    if (!container || !this.secondaryDoc) return

    this.secondaryEditorView?.destroy()

    const state = EditorState.create({
      doc: this.secondaryDoc.content,
      extensions: this.getBaseExtensions(
        true,
        this.secondaryDoc.viewMode,
        this.secondaryDoc.path
      )
    })

    this.secondaryEditorView = new EditorView({
      state,
      parent: container
    })

    requestAnimationFrame(() => {
      this.secondaryEditorView?.requestMeasure()
    })
  }

  private handlePaste = async (e: ClipboardEvent, isSecondary = false): Promise<void> => {
    const items = e.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          await this.saveAndInsertImage(file, isSecondary)
          return
        }
      }
    }
  }

  private handleDrop = async (e: DragEvent, isSecondary = false): Promise<void> => {
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.type.startsWith('image/')) {
        e.preventDefault()
        e.stopPropagation()
        await this.saveAndInsertImage(file, isSecondary)
        return
      }
    }
  }

  private async saveAndInsertImage(file: File, isSecondary: boolean): Promise<void> {
    const docPath = isSecondary ? this.secondaryDoc?.path : this.filePath
    if (!docPath) {
      alert('Please save the note first before attaching images.')
      return
    }

    const reader = new FileReader()
    reader.onload = async () => {
      const result = reader.result as string
      // Format is "data:image/png;base64,....."
      const base64Data = result.split(',')[1]
      const ext = file.name.split('.').pop() || 'png'
      try {
        const saved = await api()?.file?.saveImage?.(docPath, base64Data, ext)
        if (saved) {
          const targetView = isSecondary ? this.secondaryEditorView : this.editorView
          if (targetView) {
            const markdownImage = `\n![${file.name}](${saved.relativePath})\n`
            const pos = targetView.state.selection.main.from
            targetView.dispatch({
              changes: { from: pos, to: pos, insert: markdownImage },
              selection: { anchor: pos + markdownImage.length }
            })
          }
        }
      } catch (err) {
        console.error('Failed to save image:', err)
        alert('Failed to save attached image')
      }
    }
    reader.readAsDataURL(file)
  }

  private handleQuickToggle(): void {
    this.fileState.quickToggle()
  }

  private handleExplicitModeChange(e: CustomEvent<{ mode: ViewMode }>): void {
    this.fileState.setExplicitMode(e.detail.mode)
  }

  private handleSurfaceSelection = async (
    e: CustomEvent<{ surface: SplitSurface }>
  ): Promise<void> => {
    const surface = e.detail.surface
    if (surface === 'file') {
      const result = await api()?.file?.openDialog?.({
        properties: ['openFile'],
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }]
      })
      if (result && !result.canceled && result.filePaths[0]) {
        const fileContent = await api()?.file?.read?.(result.filePaths[0])
        if (fileContent) {
          this.fileState.openSecondaryFile(result.filePaths[0], fileContent.content)
        }
      }
    } else {
      this.fileState.setSplitSurface(surface)
    }
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

  private renderQuickToggleIcon(mode: ViewMode): unknown {
    const isReading = mode === 'reading'
    if (isReading) {
      // In reading mode, quick toggle shows edit/pencil to return to live
      return html`
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
      `
    }
    // In live/source mode, quick toggle shows book to switch to reading
    return html`
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    `
  }

  private async handleRename(e: Event, isSecondary: boolean): Promise<void> {
    const input = e.target as HTMLInputElement
    const newName = input.value.trim()
    if (!newName) {
      // Revert to original title if empty
      input.value = this.getDisplayTitle(isSecondary ? this.secondaryDoc?.path || null : this.filePath)
      return
    }
    
    await this.fileState.renameFile(newName, isSecondary)
  }

  private handleRenameKeyDown(e: KeyboardEvent, isSecondary: boolean): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      ;(e.target as HTMLInputElement).blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      const input = e.target as HTMLInputElement
      input.value = this.getDisplayTitle(isSecondary ? this.secondaryDoc?.path || null : this.filePath)
      input.blur()
    }
  }

  render(): unknown {
    if (!this.filePath && !this.content) {
      return html`
        <writemd-panel>
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <p>No document open</p>
          </div>
        </writemd-panel>
      `
    }

    const pathDisplay = this.getDisplayPath(this.filePath)
    const titleDisplay = this.getDisplayTitle(this.filePath)

    return html`
      <div class="workspace">
        <!-- split view - 1 (Responsive Left Pane) -->
        <writemd-panel class="pane">
          <!-- Sub-Header inside editor panel -->
          <div class="sub-header">
            <div class="sub-header-left" title=${this.filePath ?? ''}>${pathDisplay}</div>
            <div class="sub-header-center">
              <input
                type="text"
                class="title-input"
                .value=${titleDisplay}
                @blur=${(e: Event) => this.handleRename(e, false)}
                @keydown=${(e: KeyboardEvent) => this.handleRenameKeyDown(e, false)}
              />
            </div>
            <div class="sub-header-right">
              <div
                class="icon-action"
                title="Toggle Reading / Live Mode"
                @click=${() => this.handleQuickToggle()}
              >
                ${this.renderQuickToggleIcon(this.viewMode)}
              </div>
              <div class="icon-action" title="More Options">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="19" cy="12" r="2" />
                </svg>
              </div>
            </div>
          </div>

          <!-- Body Content Area (CodeMirror permanently mounted, reconfigured via Compartment) -->
          <div
            class="body-area"
            @paste=${(e: ClipboardEvent) => this.handlePaste(e, false)}
            @dragover=${(e: DragEvent) => e.preventDefault()}
            @drop=${(e: DragEvent) => this.handleDrop(e, false)}
          >
            <div id="primary-cm-wrapper" class="cm-wrapper"></div>

            <!-- Bottom-right Info Pill -->
            <writemd-info-pill
              .content=${this.content}
              .mode=${this.viewMode}
              @mode-change=${this.handleExplicitModeChange}
            ></writemd-info-pill>
          </div>
        </writemd-panel>

        <!-- split view - 2 (Right Pane, only when splitActive is true) -->
        ${
          this.splitActive
            ? html`
                <writemd-panel class="pane">
                  ${
                    this.secondaryDoc && this.splitSurface === 'file'
                      ? html`
                          <!-- Secondary Document Editor -->
                          <div class="sub-header">
                            <div class="sub-header-left">
                              ${this.getDisplayPath(this.secondaryDoc.path)}
                            </div>
                            <div class="sub-header-center">
                              ${this.secondaryDoc.isDiff
                                ? html`<span style="color: #e07a5f; font-weight: 600;">External Changes Diff</span>`
                                : html`<input
                                    type="text"
                                    class="title-input"
                                    .value=${this.getDisplayTitle(this.secondaryDoc.path)}
                                    @blur=${(e: Event) => this.handleRename(e, true)}
                                    @keydown=${(e: KeyboardEvent) => this.handleRenameKeyDown(e, true)}
                                  />`}
                            </div>
                            <div class="sub-header-right">
                              <div
                                class="icon-action"
                                title="Close split pane"
                                @click=${() => this.fileState.closeSecondaryFile()}
                              >
                                <svg
                                  viewBox="0 0 12 12"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="1.5"
                                >
                                  <line x1="2" y1="2" x2="10" y2="10" />
                                  <line x1="10" y1="2" x2="2" y2="10" />
                                </svg>
                              </div>
                            </div>
                          </div>

                          <div
                            class="body-area"
                            @paste=${(e: ClipboardEvent) => this.handlePaste(e, true)}
                            @dragover=${(e: DragEvent) => e.preventDefault()}
                            @drop=${(e: DragEvent) => this.handleDrop(e, true)}
                          >
                            <div id="secondary-cm-wrapper" class="cm-wrapper"></div>
                            <writemd-info-pill
                              .content=${this.secondaryDoc.content}
                              .mode=${this.secondaryDoc.viewMode}
                              @mode-change=${(e: CustomEvent<{ mode: ViewMode }>) => {
                                if (this.secondaryDoc) {
                                  this.secondaryDoc = {
                                    ...this.secondaryDoc,
                                    viewMode: e.detail.mode
                                  }
                                  if (this.secondaryEditorView) {
                                    this.secondaryEditorView.dispatch({
                                      effects: this.secondaryModeCompartment.reconfigure(
                                        this.getModeExtensions(e.detail.mode)
                                      )
                                    })
                                  }
                                }
                              }}
                            ></writemd-info-pill>
                          </div>
                        `
                      : this.splitSurface === 'files'
                        ? html`
                            <!-- Vault Files Tree Panel -->
                            <div class="sub-header">
                              <div class="sub-header-left">Vault</div>
                              <div class="sub-header-center">Files</div>
                              <div class="sub-header-right">
                                <div
                                  class="icon-action"
                                  title="Close split pane"
                                  @click=${() => this.fileState.toggleSplitView(false)}
                                >
                                  <svg
                                    viewBox="0 0 12 12"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.5"
                                  >
                                    <line x1="2" y1="2" x2="10" y2="10" />
                                    <line x1="10" y1="2" x2="2" y2="10" />
                                  </svg>
                                </div>
                              </div>
                            </div>

                            <writemd-vault-explorer></writemd-vault-explorer>
                          `
                        : html`
                            <!-- Open a surface Launcher Panel -->
                            <div class="sub-header">
                              <div class="sub-header-left">Surface</div>
                              <div class="sub-header-center">Open a surface</div>
                              <div class="sub-header-right">
                                <div
                                  class="icon-action"
                                  title="Close split pane"
                                  @click=${() => this.fileState.toggleSplitView(false)}
                                >
                                  <svg
                                    viewBox="0 0 12 12"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.5"
                                  >
                                    <line x1="2" y1="2" x2="10" y2="10" />
                                    <line x1="10" y1="2" x2="2" y2="10" />
                                  </svg>
                                </div>
                              </div>
                            </div>

                            <writemd-surface-launcher
                              @select-surface=${this.handleSurfaceSelection}
                            ></writemd-surface-launcher>
                          `
                  }
                </writemd-panel>
              `
            : ''
        }
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-editor': Editor
  }
}
