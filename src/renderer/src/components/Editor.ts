import { html, css, LitElement, unsafeCSS } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import katexCss from 'katex/dist/katex.min.css?inline'
import { findNext, findPrevious, getSearchQuery } from '@codemirror/search'
import { scrollbarStyles } from './scrollbars'
import { SettingsStore } from '../state/settings'
import { type AiMessage } from './AiPanel'
import type { ChatMessage } from '../../../shared/electron-api'
import './FindPanel'
import './AiPanel'
import './BacklinksPanel'
import type { FindPanel } from './FindPanel'
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
import {
  livePreviewPlugin,
  readOnlyExtension,
  documentPathFacet,
  tableLinePlugin
} from './LivePreview'
import { mathPlugin } from './extensions/math-plugin'
import { frontmatterPlugin } from './extensions/frontmatter-plugin'
import { wikiLinkPlugin } from './extensions/wiki-link-plugin'
import { slashCommandPlugin } from './extensions/slash-command'
import { tableKeymapPlugin } from './extensions/table-keys'
import { tableToolbarField } from './extensions/table-toolbar'
import { FileState, ViewMode, SplitSurface, SecondaryDocState } from '../state/file-state'
import './Panel'
import './InfoPill'
import './DocBar'
import './SurfaceLauncher'
import './TextMenu'
import './VaultExplorer'
import type { ElectronAPI } from '../../../shared/electron-api'
import { DEFAULT_AI_SYSTEM_PROMPT } from '../../../shared/settings-schema'
import type { VaultTreeNode } from '../../../shared/electron-api'
import { basenameNoExt, cleanWikiTarget } from '../utils/links'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

@customElement('writemd-editor')
export class Editor extends LitElement {
  static styles = [
    unsafeCSS(katexCss),
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

      .panes {
        display: flex;
        flex: 1;
        min-height: 0;
        min-width: 0;
      }

      writemd-find-panel {
        position: absolute;
        top: 12px;
        right: 16px;
        z-index: 400;
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
        -webkit-mask-image: linear-gradient(
          to right,
          transparent 0%,
          black 15%,
          black 85%,
          transparent 100%
        );
        mask-image: linear-gradient(
          to right,
          transparent 0%,
          black 15%,
          black 85%,
          transparent 100%
        );
      }

      .resizer {
        width: 5px;
        cursor: col-resize;
        background: transparent;
        transition: background 150ms;
        flex-shrink: 0;
        z-index: 10;
      }
      .resizer:hover,
      .resizer:active,
      .resizer.dragging {
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
  @state() private textMenu: { x: number; y: number } | null = null
  @state() private findOpen = false
  @state() private findMode: 'find' | 'replace' = 'find'
  @state() private findQuery = ''
  @state() private findWholeWord = false
  @state() private findCaseSensitive = false
  @state() private findRegex = false

  @state() private leftPaneWidth = 50 // percentage
  @state() private isDraggingResizer = false
  @state() private panelOrientation: 'horizontal' | 'vertical' = 'horizontal'
  @state() private isAiConfigured = false
  @state() private aiMessages: AiMessage[] = []
  @state() private aiIsLoading = false

  private settingsStore: SettingsStore | null = null
  private settingsUnsubs: Array<() => void> = []

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('writemd-find', this.handleGlobalFind)
    window.addEventListener('writemd-open-wikilink', this.handleOpenWikiLink)
    this.settingsStore = SettingsStore.getInstance()
    this.panelOrientation = this.settingsStore.get('appearance.panelOrientation', 'horizontal') as 'horizontal' | 'vertical'
    this.checkAiConfigured()
    this.settingsUnsubs.push(
      this.settingsStore.subscribe('ai.apiKey', () => this.checkAiConfigured())
    )
    this.settingsUnsubs.push(
      this.settingsStore.subscribe('ai.provider', () => this.checkAiConfigured())
    )
    this.settingsUnsubs.push(
      this.settingsStore.subscribe('appearance.panelOrientation', (v) => {
        this.panelOrientation = (v as 'horizontal' | 'vertical') ?? 'horizontal'
      })
    )
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
            this.getModeExtensions(
              s.secondaryDoc.viewMode === 'wysiwyg' ? 'live' : s.secondaryDoc.viewMode
            )
          )
        })
        requestAnimationFrame(() => {
          this.secondaryEditorView?.requestMeasure()
        })
      }

      this.requestUpdate()
    })
  }

  private checkAiConfigured(): void {
    if (!this.settingsStore) return
    const provider = this.settingsStore.get<string>('ai.provider', 'OpenAI')
    const key = this.settingsStore.get('ai.apiKey', '')
    this.isAiConfigured = provider === 'Ollama' || key.length > 0
  }

  private async handleAiSubmit(input: string): Promise<void> {
    if (!input.trim() || this.aiIsLoading || !this.settingsStore) return

    const currentPath = this.filePath || 'Untitled'
    this.aiMessages = [...this.aiMessages, { role: 'user', content: input, filePath: currentPath }]
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

      // Custom instructions from Settings → AI Assistant, with live file context appended
      const customPrompt =
        this.settingsStore.get('ai.systemPrompt', DEFAULT_AI_SYSTEM_PROMPT) ||
        DEFAULT_AI_SYSTEM_PROMPT
      const systemPrompt = `${customPrompt}

The user is currently editing the file: ${currentPath}
Here is the current content of the active file:

\`\`\`markdown
${this.content}
\`\`\`

If the user asks questions about their file, use the above content to answer.`

      // We bypass the ipc.ts system prompt handling completely to avoid needing an app restart.
      // We inject the system context as a 'user' message at the very beginning of the payload.
      const payloadMessages: ChatMessage[] = [
        { role: 'user', content: systemPrompt },
        {
          role: 'assistant',
          content:
            'Acknowledged. I am operating within WriteMd and can see the file content. I will adhere to the unslop style, track file changes, and use the writemd-replace block if requested to modify the file.'
        },
        ...this.aiMessages.map((m): ChatMessage => {
          if (m.role === 'user') {
            return {
              role: m.role,
              content: `[Context: The user is currently in file: ${m.filePath}]\n\n${m.content}`
            }
          }
          return { role: m.role, content: m.content }
        })
      ]

      // Send chat request
      const response = await electron.net.chat(provider, model, key, payloadMessages, '')

      const replaceRegex = /```writemd-replace\s*\n([\s\S]*?)```/
      const match = response.match(replaceRegex)

      if (match) {
        this.applyAiReplacement(match[1])
        // Remove the block from the chat response so it doesn't clutter the UI
        const cleanResponse =
          response.replace(replaceRegex, '').trim() || 'I have updated the document.'
        this.aiMessages = [...this.aiMessages, { role: 'assistant', content: cleanResponse }]
      } else {
        this.aiMessages = [...this.aiMessages, { role: 'assistant', content: response }]
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to chat'
      this.aiMessages = [...this.aiMessages, { role: 'assistant', content: `Error: ${message}` }]
    } finally {
      this.aiIsLoading = false
    }
  }

  /** Apply an AI-provided document replacement and force-save it to disk. */
  private async applyAiReplacement(newContent: string): Promise<void> {
    if (this.editorView) {
      this.editorView.dispatch({
        changes: { from: 0, to: this.editorView.state.doc.length, insert: newContent }
      })
    }
    this.content = newContent
    this.fileState.setContent(newContent)
    // Force an immediate save to disk so the 'dirty' flag is cleared.
    // This prevents the OS file watcher from firing while dirty=true and popping the conflict modal.
    await this.fileState.save()
  }

  private handleAiSubmitEvent(e: Event): void {
    const text = (e as CustomEvent<{ text: string }>).detail.text
    void this.handleAiSubmit(text)
  }

  disconnectedCallback(): void {
    window.removeEventListener('writemd-find', this.handleGlobalFind)
    window.removeEventListener('writemd-open-wikilink', this.handleOpenWikiLink)
    this.unsubscribe?.()
    this.editorView?.destroy()
    this.secondaryEditorView?.destroy()
    this.editorView = null
    this.secondaryEditorView = null
    this.settingsUnsubs.forEach((u) => u())
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
          {
            key: 'F3',
            run: (view) => {
              // findNext opens the built-in search panel on an invalid
              // query — we render our own panel, so swallow it instead.
              const q = getSearchQuery(view.state)
              if (q?.valid && q.search) return findNext(view)
              return true
            }
          },
          {
            key: 'Shift-F3',
            run: (view) => {
              const q = getSearchQuery(view.state)
              if (q?.valid && q.search) return findPrevious(view)
              return true
            }
          },
          {
            key: 'Escape',
            run: () => {
              if (this.findOpen) {
                this.findOpen = false
                this.editorView?.focus()
                return true
              }
              return false
            }
          }
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
        if (this.findOpen && (update.docChanged || update.selectionSet)) {
          this.shadowRoot?.querySelector<FindPanel>('writemd-find-panel')?.refreshCounts()
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
      extensions: this.getBaseExtensions(true, this.secondaryDoc.viewMode, this.secondaryDoc.path)
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

  private handleExplicitModeChange(e: CustomEvent<{ mode: ViewMode }>): void {
    this.fileState.setExplicitMode(e.detail.mode)
  }

  private handleTextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    this.textMenu = { x: e.clientX, y: e.clientY }
  }

  /** View the find panel currently targets (secondary pane when focused). */
  private get findTargetView(): EditorView | null {
    if (this.secondaryEditorView?.hasFocus) return this.secondaryEditorView
    return this.editorView
  }

  private findPanel(): FindPanel | null {
    return this.shadowRoot?.querySelector<FindPanel>('writemd-find-panel') ?? null
  }

  private handleGlobalFind = (e: Event): void => {
    const mode = (e as CustomEvent<{ mode?: 'find' | 'replace' }>).detail?.mode ?? 'find'
    this.openFind(mode)
  }

  /** Follow a clicked `[[wiki-link]]`: open the matching file anywhere. */
  private handleOpenWikiLink = (e: Event): void => {
    const raw = (e as CustomEvent<{ name?: string }>).detail?.name ?? ''
    const target = cleanWikiTarget(raw)
    if (!target) return
    void this.openWikiTarget(target)
  }

  private async openWikiTarget(target: string): Promise<void> {
    const stem = basenameNoExt(target.toLowerCase())
    const withSubpath = target.replace(/\\/g, '/').includes('/')
    // Open tabs first (any folder), then vault files, then recent files.
    const tabs = this.fileState.getState().tabs
    const tabHit = tabs.find((t) => t.path && basenameNoExt(t.path.toLowerCase()) === stem)
    if (tabHit?.path) {
      await this.fileState.openFile(tabHit.path)
      return
    }
    const collect = (node: VaultTreeNode, out: string[]): void => {
      if (node.isDirectory) {
        for (const child of node.children ?? []) collect(child, out)
      } else if (node.path) {
        out.push(node.path)
      }
    }
    const vaultPaths: string[] = []
    const tree = await api()
      ?.vault?.getTree?.()
      .catch(() => undefined)
    if (tree) collect(tree, vaultPaths)
    const recent = this.settingsStore?.get<string[]>('files.recentFiles', []) ?? []
    const candidates = [...vaultPaths, ...recent]
    const hit = candidates.find((p) => {
      const norm = p.replace(/\\/g, '/').toLowerCase()
      if (withSubpath) {
        const cleaned = target.toLowerCase().replace(/\\/g, '/')
        return norm.endsWith(`/${cleaned}`) || norm.endsWith(`/${cleaned}.md`)
      }
      return basenameNoExt(norm) === stem
    })
    if (hit) {
      await this.fileState.openFile(hit)
      return
    }
    // Obsidian behavior: create the note on click.
    const vaultPath = await api()
      ?.vault?.getPath?.()
      .catch(() => undefined)
    if (!vaultPath) return
    const safe = target
      .replace(/\\/g, '/')
      .split('/')
      .map((seg) => seg.replace(/[<>:"|?*]/g, '').trim())
      .filter(Boolean)
      .join('/')
    if (!safe) return
    const newPath = `${vaultPath.replace(/\\/g, '/')}/${safe}${safe.toLowerCase().endsWith('.md') ? '' : '.md'}`
    try {
      await api()?.file?.write?.(newPath, '')
      await this.fileState.openFile(newPath)
    } catch (err) {
      console.error('Failed to create linked note:', err)
    }
  }

  private openFind(mode: 'find' | 'replace'): void {
    const view = this.findTargetView
    if (!view) return
    const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
    const seed = sel.includes('\n') ? '' : sel
    // Keep flags in sync with the live editor query so reopening (or a
    // recreated view) starts from the user's in-session toggles.
    const current = getSearchQuery(view.state)
    if (current) {
      this.findWholeWord = current.wholeWord
      this.findCaseSensitive = current.caseSensitive
      this.findRegex = current.regexp
    }
    if (this.findOpen) {
      this.findMode = mode
      if (seed) {
        this.findQuery = seed
        this.findPanel()?.setQuery(seed)
      }
      this.findPanel()?.focusPanel()
      return
    }
    this.findQuery = seed
    this.findMode = mode
    this.findOpen = true
  }

  private handleFindClose = (
    e: CustomEvent<{ wholeWord: boolean; caseSensitive: boolean; regexp: boolean } | undefined>
  ): void => {
    const flags = e.detail
    if (flags) {
      this.findWholeWord = flags.wholeWord
      this.findCaseSensitive = flags.caseSensitive
      this.findRegex = flags.regexp
    }
    this.findOpen = false
  }

  private handleFindToggle = (e: CustomEvent<{ mode: 'find' | 'replace' }>): void => {
    this.findMode = e.detail.mode
  }

  private handleFindNextEvent = (): void => {
    this.findPanel()?.doFindNext()
  }

  private handleFindPreviousEvent = (): void => {
    this.findPanel()?.doFindPrevious()
  }

  private handleReplaceNextEvent = (): void => {
    this.findPanel()?.doReplace()
  }

  private handleReplaceAllEvent = (): void => {
    this.findPanel()?.doReplaceAll()
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

  private async handleRename(e: Event, isSecondary: boolean): Promise<void> {
    const input = e.target as HTMLInputElement
    const newName = input.value.trim()
    if (!newName) {
      // Revert to original title if empty
      input.value = this.getDisplayTitle(
        isSecondary ? this.secondaryDoc?.path || null : this.filePath
      )
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
      input.value = this.getDisplayTitle(
        isSecondary ? this.secondaryDoc?.path || null : this.filePath
      )
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
      const newWidth = ((e.clientX - rect.left) / rect.width) * 100
      this.leftPaneWidth = Math.max(20, Math.min(80, newWidth))
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

    const isVerticalTabs = this.panelOrientation === 'vertical'

    return html`
      <div class="workspace">
        ${
          this.findOpen && this.editorView
            ? html`<writemd-find-panel
                .view=${this.findTargetView}
                .mode=${this.findMode}
                .initialQuery=${this.findQuery}
                .initialWholeWord=${this.findWholeWord}
                .initialCaseSensitive=${this.findCaseSensitive}
                .initialRegex=${this.findRegex}
                @close=${this.handleFindClose}
                @toggle-mode=${this.handleFindToggle}
                @find-next=${this.handleFindNextEvent}
                @find-previous=${this.handleFindPreviousEvent}
                @replace-next=${this.handleReplaceNextEvent}
                @replace-all=${this.handleReplaceAllEvent}
              ></writemd-find-panel>`
            : ''
        }
        <!-- split view - 1 (Responsive Left Pane) -->
        <div class="panes">
        <writemd-panel
          class="pane"
          style=${this.splitActive ? `flex: 0 0 calc(${this.leftPaneWidth}% - 2.5px);` : ''}
        >
          ${isVerticalTabs ? '' : html`<writemd-doc-bar></writemd-doc-bar>`}

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
            ${
              this.textMenu && this.editorView
                ? html`<writemd-text-menu
                    .x=${Math.min(this.textMenu.x, window.innerWidth - 240)}
                    .y=${Math.min(this.textMenu.y, window.innerHeight - 380)}
                    .flip=${this.textMenu.x > window.innerWidth - 480}
                    .view=${this.editorView}
                    @close=${() => (this.textMenu = null)}
                  ></writemd-text-menu>`
                : ''
            }
          </div>
        </writemd-panel>

        <!-- split view - 2 (Right Pane, only when splitActive is true) -->
        ${
          this.splitActive
            ? html`
                <div
                  class="resizer ${this.isDraggingResizer ? 'dragging' : ''}"
                  @mousedown=${this.startResize}
                ></div>
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
                              ${
                                this.secondaryDoc.isDiff
                                  ? html`<span style="color: #e07a5f; font-weight: 600;"
                                      >External Changes Diff</span
                                    >`
                                  : html`<input
                                      type="text"
                                      class="title-input"
                                      .value=${this.getDisplayTitle(this.secondaryDoc.path)}
                                      @blur=${(e: Event) => this.handleRename(e, true)}
                                      @keydown=${(e: KeyboardEvent) => this.handleRenameKeyDown(e, true)}
                                    />`
                              }
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
                              <writemd-backlinks-panel
                                .currentPath=${this.filePath}
                              ></writemd-backlinks-panel>
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
                                      <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="1.5"
                                      >
                                        <path d="M3 6h18" />
                                        <path
                                          d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                                        />
                                      </svg>
                                    </div>
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
                                <writemd-ai-panel
                                  .configured=${this.isAiConfigured}
                                  .messages=${this.aiMessages}
                                  .loading=${this.aiIsLoading}
                                  @ai-submit=${this.handleAiSubmitEvent}
                                ></writemd-ai-panel>
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
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-editor': Editor
  }
}
