import { html, css, LitElement, unsafeCSS } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ breaks: true, linkify: true })
import katexCss from 'katex/dist/katex.min.css?inline'
import { findNext, findPrevious } from '@codemirror/search'
import { menuStyles, menuIcon, menuCheck } from './menu-styles'
import { scrollbarStyles } from './scrollbars'
import './FindPanel'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine
} from '@codemirror/view'
import { EditorState, Extension, Compartment, Prec } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { unifiedMergeView } from '@codemirror/merge'
import { GFM } from '@lezer/markdown'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { search } from '@codemirror/search'
import { writeMDTheme } from './EditorTheme'
import { vscodeHighlight } from './CodeHighlight'
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
import './TextMenu'
import './VaultExplorer'
import type { ElectronAPI } from '../../../shared/electron-api'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

@customElement('writemd-editor')
export class Editor extends LitElement {
  static styles = [
    unsafeCSS(katexCss),
    menuStyles,
    scrollbarStyles,
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

    .workspace {
      display: flex;
      flex: 1;
      min-height: 0;
      min-width: 0;
      gap: 0;
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
      -webkit-mask-image: linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%);
      mask-image: linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%);
    }

    .resizer {
      width: 5px;
      cursor: col-resize;
      background: transparent;
      transition: background 150ms;
      flex-shrink: 0;
      z-index: 10;
    }
    .resizer:hover, .resizer:active, .resizer.dragging {
      background: rgba(255, 255, 255, 0.1);
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
      top: 28px;
      right: 0;
      min-width: 230px;
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
  @state() private showMoreMenu = false
  @state() private textMenu: { x: number; y: number } | null = null
  @state() private findOpen = false
  @state() private findMode: 'find' | 'replace' = 'find'
  @state() private findQuery = ''
  
  @state() private leftPaneWidth = 50 // percentage
  @state() private isDraggingResizer = false
  @state() private isAiConfigured = false
  @state() private aiMessages: {role: 'user' | 'assistant', content: string}[] = []
  @state() private aiIsLoading = false
  
  private settingsStore: any = null
  private settingsUnsubs: Array<() => void> = []

  connectedCallback(): void {
    super.connectedCallback()
    import('../state/settings').then(m => {
      this.settingsStore = m.SettingsStore.getInstance()
      this.checkAiConfigured()
      this.settingsUnsubs.push(this.settingsStore.subscribe('ai.apiKey', () => this.checkAiConfigured()))
      this.settingsUnsubs.push(this.settingsStore.subscribe('ai.provider', () => this.checkAiConfigured()))
    })
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
            this.getModeExtensions(s.secondaryDoc.viewMode === 'wysiwyg' ? 'live' : s.secondaryDoc.viewMode)
          )
        })
        requestAnimationFrame(() => {
          this.secondaryEditorView?.requestMeasure()
        })
      }

      this.requestUpdate()
    })
  }

  private checkAiConfigured() {
    if (!this.settingsStore) return
    const provider = this.settingsStore.get('ai.provider', 'OpenAI')
    const key = this.settingsStore.get('ai.apiKey', '')
    this.isAiConfigured = provider === 'Ollama' || key.length > 0
  }

  private async handleAiSubmit(input: string) {
    if (!input.trim() || this.aiIsLoading || !this.settingsStore) return
    
    this.aiMessages = [...this.aiMessages, { role: 'user', content: input }]
    this.aiIsLoading = true
    
    const electron = api()
    if (!electron) {
      this.aiIsLoading = false
      return
    }

    try {
      const provider = this.settingsStore.get('ai.provider', 'OpenAI')
      const model = this.settingsStore.get('ai.model', '')
      const key = this.settingsStore.get('ai.apiKey', '')

      // Construct system prompt with current document content
      const systemPrompt = `CRITICAL INSTRUCTION: You are a helpful AI assistant operating directly inside the WriteMd application interface. You must strictly adhere to the "unslop" communication style. Never use filler phrases like "Here is...", "This will...", "I'll help...", "Let me...", "Great!", "Excellent!", or "Perfect!". No preamble, no postamble, no summaries unless asked. Deliver direct, concise, and human-sounding output. Format your responses in markdown.

The user is currently editing a file. Here is the current content of the active file:

\`\`\`markdown
${this.content}
\`\`\`

If the user asks questions about their file, use the above content to answer.

CRITICAL INSTRUCTION FOR FILE EDITS: If the user asks you to modify, rewrite, or clear the file, you MUST output the completely updated file content wrapped exactly in a \`\`\`writemd-replace\`\`\` code block. For example:
\`\`\`writemd-replace
(the new content goes here)
\`\`\`
The application will intercept this block and automatically apply the changes to the user's document.`

      // We bypass the ipc.ts system prompt handling completely to avoid needing an app restart.
      // We inject the system context as a 'user' message at the very beginning of the payload.
      const payloadMessages = [
        { role: 'user', content: systemPrompt },
        { role: 'assistant', content: 'Acknowledged. I am operating within WriteMd and can see the file content. I will adhere to the unslop style and use the writemd-replace block if requested to modify the file.' },
        ...this.aiMessages
      ]

      // Send chat request
      const response = await electron.net.chat(provider, model, key, payloadMessages, '')
      
      const replaceRegex = /```writemd-replace\s*\n([\s\S]*?)```/
      const match = response.match(replaceRegex)
      
      if (match) {
        const newContent = match[1]
        // Apply changes to the editor
        if (this.editorView) {
          this.editorView.dispatch({
            changes: { from: 0, to: this.editorView.state.doc.length, insert: newContent }
          })
        }
        // Save to state
        this.content = newContent
        this.fileState.setContent(newContent)
        
        // Force an immediate save to disk so the 'dirty' flag is cleared.
        // This prevents the OS file watcher from firing while dirty=true and popping the conflict modal.
        await this.fileState.save()
        
        // Remove the block from the chat response so it doesn't clutter the UI
        const cleanResponse = response.replace(replaceRegex, '').trim() || 'I have updated the document.'
        this.aiMessages = [...this.aiMessages, { role: 'assistant', content: cleanResponse }]
      } else {
        this.aiMessages = [...this.aiMessages, { role: 'assistant', content: response }]
      }
      
      // Auto-scroll logic could go here
    } catch (e: any) {
      this.aiMessages = [...this.aiMessages, { role: 'assistant', content: `Error: ${e.message || 'Failed to chat'}` }]
    } finally {
      this.aiIsLoading = false
    }
  }

  disconnectedCallback(): void {
    this.unsubscribe?.()
    this.editorView?.destroy()
    this.secondaryEditorView?.destroy()
    this.editorView = null
    this.secondaryEditorView = null
    this.settingsUnsubs.forEach(u => u())
    this.settingsUnsubs = []
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
      vscodeHighlight,
      EditorView.lineWrapping,
      history(),
      search(),
      Prec.high(
        keymap.of([
          {
            key: 'Mod-f',
            run: () => {
              this.openFind('find')
              return true
            }
          },
          {
            key: 'Mod-h',
            run: () => {
              this.openFind('replace')
              return true
            }
          },
          { key: 'F3', run: findNext },
          { key: 'Shift-F3', run: findPrevious }
        ])
      ),
      mathPlugin,
      frontmatterPlugin,
      wikiLinkPlugin,
      slashCommandPlugin,
      tableKeymapPlugin,
      tableToolbarField,
      keymap.of([...defaultKeymap, ...historyKeymap]),
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

  private async handleExport(kind: 'pdf' | 'html'): Promise<void> {
    this.showMoreMenu = false
    const bridge = api()?.export
    if (!bridge) {
      alert('Export is unavailable. Restart the app to load the latest version.')
      return
    }
    const content = this.editorView ? this.editorView.state.doc.toString() : this.content
    try {
      const result = await bridge[kind](content, this.filePath)
      if (!result.ok && result.reason !== 'canceled') {
        alert(`Export failed: ${result.reason ?? 'unknown error'}`)
      }
    } catch (err) {
      console.error(`Export ${kind} failed:`, err)
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private handleExplicitModeChange(e: CustomEvent<{ mode: ViewMode }>): void {
    this.fileState.setExplicitMode(e.detail.mode)
  }

  private handleTextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    this.showMoreMenu = false
    this.textMenu = { x: e.clientX, y: e.clientY }
  }

  private openFind(mode: 'find' | 'replace'): void {
    if (!this.editorView) return
    const sel = this.editorView.state.sliceDoc(
      this.editorView.state.selection.main.from,
      this.editorView.state.selection.main.to
    )
    this.findQuery = sel.includes('\n') ? '' : sel
    this.findMode = mode
    this.findOpen = true
  }

  private noteMenuItems(): Array<{
    id: string
    label: string
    icon: string
    dividerBefore?: boolean
    danger?: boolean
    checked?: boolean
  }> {
    const mode = this.viewMode === 'wysiwyg' ? 'live' : this.viewMode
    return [
      { id: 'backlinks', label: 'Backlinks in document', icon: 'backlinks' },
      { id: 'reading', label: 'Reading view', icon: 'eye', dividerBefore: true, checked: mode === 'reading' },
      { id: 'source', label: 'Source mode', icon: 'code', checked: mode === 'source' },
      { id: 'split', label: 'Split right', icon: 'split', dividerBefore: true },
      { id: 'rename', label: 'Rename', icon: 'pencil', dividerBefore: true },
      { id: 'move', label: 'Move file to', icon: 'folder' },
      { id: 'pdf', label: 'Export to PDF', icon: 'file', dividerBefore: true },
      { id: 'find', label: 'Find', icon: 'search', dividerBefore: true },
      { id: 'replace', label: 'Replace', icon: 'search' },
      { id: 'copy-path', label: 'Copy path', icon: 'copy', dividerBefore: true },
      { id: 'reveal-explorer', label: 'Show in system explorer', icon: 'external' },
      { id: 'reveal-nav', label: 'Reveal file in navigation', icon: 'reveal' },
      { id: 'delete', label: 'Delete file', icon: 'trash', dividerBefore: true, danger: true }
    ]
  }

  private async handleNoteAction(id: string): Promise<void> {
    this.showMoreMenu = false
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
        await this.handleExport('pdf')
        break
      case 'find':
        this.openFind('find')
        break
      case 'replace':
        this.openFind('replace')
        break
      case 'copy-path':
        if (this.filePath) {
          try {
            await navigator.clipboard.writeText(this.filePath)
          } catch (err) {
            console.error('Copy path failed:', err)
          }
        }
        break
      case 'reveal-explorer':
        if (this.filePath) {
          await api()?.shell?.showInFolder?.(this.filePath).catch(() => undefined)
        }
        break
      case 'reveal-nav':
        this.fileState.setSplitSurface('files')
        break
      case 'delete': {
        if (!this.filePath) break
        const base = this.filePath.split(/[/\\]/).pop() ?? this.filePath
        if (!confirm(`Move ${base} to trash?`)) break
        const ok = await api()?.file?.delete?.(this.filePath)
        if (!ok) {
          alert('Could not delete file')
          break
        }
        const idx = this.fileState.getState().tabs.findIndex((t) => t.path === this.filePath)
        if (idx >= 0) await this.fileState.closeTab(idx)
        break
      }
    }
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

  private startResize = (e: MouseEvent): void => {
    e.preventDefault()
    this.isDraggingResizer = true
    document.addEventListener('mousemove', this.doResize)
    document.addEventListener('mouseup', this.stopResize)
    document.body.style.cursor = 'col-resize'
  }

  private doResize = (e: MouseEvent): void => {
    if (!this.isDraggingResizer) return
    const container = this.shadowRoot?.querySelector('.workspace')
    if (container) {
      const rect = container.getBoundingClientRect()
      // Clamp between 20% and 80%
      let newWidth = ((e.clientX - rect.left) / rect.width) * 100
      newWidth = Math.max(20, Math.min(80, newWidth))
      this.leftPaneWidth = newWidth
    }
  }

  private stopResize = (): void => {
    this.isDraggingResizer = false
    document.removeEventListener('mousemove', this.doResize)
    document.removeEventListener('mouseup', this.stopResize)
    document.body.style.cursor = ''
    // Inform codemirror to resize
    this.editorView?.requestMeasure()
    this.secondaryEditorView?.requestMeasure()
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
        <writemd-panel class="pane" style=${this.splitActive ? `flex: 0 0 calc(${this.leftPaneWidth}% - 2.5px);` : ''}>
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
              <div class="menu-wrap">
                <div
                  class="icon-action faint"
                  title="More Options"
                  @click=${() => (this.showMoreMenu = !this.showMoreMenu)}
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
                        @click=${() => (this.showMoreMenu = false)}
                      ></div>
                      <div class="m-panel note-menu">
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

          <!-- Body Content Area (CodeMirror permanently mounted, reconfigured via Compartment) -->
          <div
            class="body-area"
            @paste=${(e: ClipboardEvent) => this.handlePaste(e, false)}
            @dragover=${(e: DragEvent) => e.preventDefault()}
            @drop=${(e: DragEvent) => this.handleDrop(e, false)}
            @contextmenu=${this.handleTextMenu}
          >
            <div id="primary-cm-wrapper" class="cm-wrapper"></div>

            <!-- Bottom-right Info Pill -->
            <writemd-info-pill
              .content=${this.content}
              .mode=${this.viewMode}
              @mode-change=${this.handleExplicitModeChange}
            ></writemd-info-pill>
            ${this.textMenu && this.editorView
              ? html`<writemd-text-menu
                  .x=${Math.min(this.textMenu.x, window.innerWidth - 240)}
                  .y=${Math.min(this.textMenu.y, window.innerHeight - 380)}
                  .flip=${this.textMenu.x > window.innerWidth - 480}
                  .view=${this.editorView}
                  @close=${() => (this.textMenu = null)}
                ></writemd-text-menu>`
              : ''}
          </div>
        </writemd-panel>

        <!-- split view - 2 (Right Pane, only when splitActive is true) -->
        ${
          this.splitActive
            ? html`
                <div class="resizer ${this.isDraggingResizer ? 'dragging' : ''}" @mousedown=${this.startResize}></div>
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
                                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
                                    <line x1="2" y1="2" x2="10" y2="10" />
                                    <line x1="10" y1="2" x2="2" y2="10" />
                                  </svg>
                                </div>
                              </div>
                            </div>
                            <writemd-vault-explorer></writemd-vault-explorer>
                          `
                        : this.splitSurface === 'backlinks'
                        ? html`
                            <!-- Backlinks Panel -->
                            <div class="sub-header">
                              <div class="sub-header-left">Document</div>
                              <div class="sub-header-center">Backlinks</div>
                              <div class="sub-header-right">
                                <div
                                  class="icon-action"
                                  title="Close split pane"
                                  @click=${() => this.fileState.toggleSplitView(false)}
                                >
                                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
                                    <line x1="2" y1="2" x2="10" y2="10" />
                                    <line x1="10" y1="2" x2="2" y2="10" />
                                  </svg>
                                </div>
                              </div>
                            </div>
                            <div class="empty-state">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                              </svg>
                              <p>No backlinks found for this document.</p>
                            </div>
                          `
                        : this.splitSurface === 'ai'
                        ? html`
                            <!-- AI Panel -->
                            <div class="sub-header">
                              <div class="sub-header-left">Assistant</div>
                              <div class="sub-header-center">AI</div>
                              <div class="sub-header-right">
                                <div
                                  class="icon-action"
                                  title="Clear chat history"
                                  @click=${() => (this.aiMessages = [])}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                    <path d="M3 6h18" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  </svg>
                                </div>
                                <div
                                  class="icon-action"
                                  title="Close split pane"
                                  @click=${() => this.fileState.toggleSplitView(false)}
                                >
                                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
                                    <line x1="2" y1="2" x2="10" y2="10" />
                                    <line x1="10" y1="2" x2="2" y2="10" />
                                  </svg>
                                </div>
                              </div>
                            </div>
                            ${this.isAiConfigured
                              ? html`
                                  <div style="padding: 16px; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; overflow: hidden; gap: 16px;">
                                    <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; font-family: var(--font-body); font-size: 14px; color: var(--text);">
                                      <div style="display: flex; gap: 8px;">
                                        <div style="background: var(--bg-elevated); padding: 12px 16px; border-radius: 8px; border-bottom-left-radius: 2px;">
                                          Hi! I'm your AI Assistant. I'm ready to help you write, brainstorm, or rephrase your document.
                                        </div>
                                      </div>
                                      
                                      ${this.aiMessages.map(m => html`
                                        <div style="display: flex; gap: 8px; justify-content: ${m.role === 'user' ? 'flex-end' : 'flex-start'}">
                                          <div style="background: var(${m.role === 'user' ? '--accent' : '--bg-elevated'}); color: var(${m.role === 'user' ? '--accent-text' : '--text'}); padding: 12px 16px; border-radius: 8px; border-bottom-${m.role === 'user' ? 'right' : 'left'}-radius: 2px; max-width: 85%; ${m.role === 'user' ? 'white-space: pre-wrap;' : ''} overflow-wrap: break-word;">
                                            ${m.role === 'assistant' ? unsafeHTML(md.render(m.content)) : m.content}
                                          </div>
                                        </div>
                                      `)}
                                      
                                      ${this.aiIsLoading ? html`
                                        <div style="display: flex; gap: 8px;">
                                          <div style="background: var(--bg-elevated); padding: 12px 16px; border-radius: 8px; border-bottom-left-radius: 2px; color: var(--text-secondary); font-style: italic;">
                                            Thinking...
                                          </div>
                                        </div>
                                      ` : ''}
                                    </div>
                                    <div style="flex-shrink: 0;">
                                      <input 
                                        type="text" 
                                        placeholder="Ask AI..." 
                                        .disabled=${this.aiIsLoading}
                                        style="width: 100%; padding: 12px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: var(--font-body); box-sizing: border-box; opacity: ${this.aiIsLoading ? 0.5 : 1};"
                                        @keydown=${(e: KeyboardEvent) => {
                                          if (e.key === 'Enter') {
                                            const val = (e.target as HTMLInputElement).value;
                                            (e.target as HTMLInputElement).value = '';
                                            this.handleAiSubmit(val)
                                          }
                                        }}
                                      />
                                    </div>
                                  </div>
                                `
                              : html`
                                  <div class="empty-state">
                                    <svg viewBox="0 0 24 24" fill="currentColor">
                                      <path d="M12 2L9.5 8.5L3 11L9.5 13.5L12 20L14.5 13.5L21 11L14.5 8.5L12 2Z" />
                                    </svg>
                                    <p>AI Assistant is not configured yet.</p>
                                  </div>
                                `}
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
        ${this.findOpen && this.editorView
          ? html`<writemd-find-panel
              .view=${this.editorView}
              .mode=${this.findMode}
              .initialQuery=${this.findQuery}
              @close=${() => (this.findOpen = false)}
            ></writemd-find-panel>`
          : ''}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-editor': Editor
  }
}
