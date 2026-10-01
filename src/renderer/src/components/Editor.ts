import { html, css, LitElement, unsafeCSS } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
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
  linkClickStyleFacet,
  tableLinePlugin
} from './LivePreview'
import { makeLinkClickHandler } from './extensions/link-click'
import { mermaidEnabledFacet } from './extensions/mermaid-toggle'
import { on } from '../events/bus'
import { mathPlugin } from './extensions/math-plugin'
import { frontmatterPlugin } from './extensions/frontmatter-plugin'
import { wikiLinkPlugin } from './extensions/wiki-link-plugin'
import { slashCommandPlugin } from './extensions/slash-command'
import { tableKeymapPlugin } from './extensions/table-keys'
import { tableToolbarField } from './extensions/table-toolbar'
import {
  FileState,
  ViewMode,
  SplitSurface,
  SecondaryDocState,
  shouldMountSecondaryView
} from '../state/file-state'
import './Panel'
import './InfoPill'
import './DocBar'
import './SurfaceLauncher'
import './TextMenu'
import './VaultExplorer'
import { api } from '../api'
import { DEFAULT_AI_SYSTEM_PROMPT } from '../../../shared/settings-schema'
import type { VaultTreeNode } from '../../../shared/electron-api'
import {
  basenameNoExt,
  cleanWikiTarget,
  displayPath,
  displayTitle,
  shortPath
} from '../utils/links'
import { navigateLink, resolveOrCreateLink, type NavigateDeps } from '../utils/navigate'

/**
 * Does a line's text declare the given anchor? GitHub slugifies headings by
 * lowercasing, dropping punctuation and joining runs of spaces, so `# My Note!`
 * and `#my-note` have to land on the same line.
 */
function headingMatches(lineText: string, anchor: string): boolean {
  const slug = lineText
    .replace(/^#{1,6}\s+/, '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
  if (slug === anchor) return true
  return (
    lineText
      .replace(/^#{1,6}\s+/, '')
      .trim()
      .toLowerCase() === anchor
  )
}

/**
 * Unwrap Electron's ipcRenderer wrapper.
 *
 * `net.chat` runs in main, so a throw there arrives as
 * "Error invoking remote method 'net:chat': Error: <the real message>". Showing
 * that verbatim in the chat log told the user nothing about which call failed.
 */
function describeAiError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const wrapped = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?([\s\S]*)$/
  const match = wrapped.exec(raw)
  return (match ? match[1] : raw).trim() || 'The request failed.'
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
        /* Transparent, not --bg. This element's 5px padding is the gutter that
           separates the window frame from the pane, and painting it introduced a
           third tone between the two: frame, gutter, pane. Leaving it
           transparent lets the frame show through, so the shell reads as exactly
           two surfaces. */
        background: transparent;
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

      .notice {
        position: absolute;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 500;
        max-width: min(520px, 80%);
        padding: 8px 14px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-elevated);
        color: var(--text-secondary);
        font-size: 12px;
        box-shadow: 0 6px 20px rgb(0 0 0 / 18%);
        pointer-events: none;
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
        border-bottom: 1px solid var(--border-subtle);
        flex-shrink: 0;
        user-select: none;
        font-family: 'Geist Mono', monospace;
        font-size: 14px;
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
        background: var(--bg-active);
      }
      .resizer:focus-visible {
        background: var(--accent);
        outline: none;
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
        background: var(--bg-hover);
        border-color: var(--border);
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
        color: var(--text-muted);
        cursor: pointer;
        transition:
          color 120ms ease,
          background 120ms ease;
      }

      .icon-action:hover {
        color: var(--text);
        background: var(--bg-hover);
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
        color: var(--text-muted);
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
  private primaryChromeCompartment = new Compartment()
  private secondaryChromeCompartment = new Compartment()

  /** Settings keys that require reconfiguring an editor view when they change. */
  private static readonly CHROME_SETTINGS = [
    'editor.showLineNumbers',
    'editor.highlightActiveLine',
    'editor.wordWrap',
    'editor.tabSize',
    'advanced.enableMermaid'
  ] as const

  /** Push the current chrome settings into both live editor views, if any. */
  private syncChrome(): void {
    const chrome = this.getChromeExtensions()
    for (const [view, comp] of [
      [this.editorView, this.primaryChromeCompartment],
      [this.secondaryEditorView, this.secondaryChromeCompartment]
    ] as const) {
      if (!view) continue
      try {
        view.dispatch({ effects: comp.reconfigure(chrome) })
      } catch {
        // view torn down between the settings notification and this dispatch
      }
    }
  }

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
  @state() private notice = ''
  private noticeTimer: number | null = null

  @state() private leftPaneWidth = 50 // percentage
  @state() private isDraggingResizer = false
  @state() private panelOrientation: 'horizontal' | 'vertical' = 'horizontal'
  @state() private isAiConfigured = false
  @state() private aiMessages: AiMessage[] = []
  @state() private aiIsLoading = false

  private settingsStore: SettingsStore | null = null
  private settingsUnsubs: Array<() => void> = []
  private busUnsubs: Array<() => void> = []

  connectedCallback(): void {
    super.connectedCallback()
    this.busUnsubs.push(on('find:open', this.handleGlobalFind))
    this.busUnsubs.push(on('wiki:open', this.handleOpenWikiLink))
    this.settingsStore = SettingsStore.getInstance()
    this.panelOrientation = this.settingsStore.get('appearance.panelOrientation', 'horizontal') as
      'horizontal' | 'vertical'
    this.checkAiConfigured()
    this.settingsUnsubs.push(
      this.settingsStore.subscribe('ai.apiKeySet', () => this.checkAiConfigured())
    )
    this.settingsUnsubs.push(
      this.settingsStore.subscribe('ai.provider', () => this.checkAiConfigured())
    )
    this.settingsUnsubs.push(
      this.settingsStore.subscribe('appearance.panelOrientation', (v) => {
        this.panelOrientation = (v as 'horizontal' | 'vertical') ?? 'horizontal'
      })
    )
    for (const key of Editor.CHROME_SETTINGS) {
      this.settingsUnsubs.push(this.settingsStore.subscribe(key, () => this.syncChrome()))
    }
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

      // While a conflict merge is open the secondary view owns the document
      // text. `setSecondaryContent` writes the merged result into top-level
      // `content`, and pushing that into the primary view on every keystroke
      // would reset the primary cursor and undo history, then loop back through
      // the primary `updateListener`. Comparing against the live view doc means
      // the primary catches up by itself once the merge closes.
      const mergeActive = Boolean(s.secondaryDoc?.isDiff)

      if (
        this.editorView &&
        docChanged &&
        !mergeActive &&
        s.content !== this.editorView.state.doc.toString()
      ) {
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
    // The plaintext key never reaches the renderer; the main process reports
    // whether one is stored.
    const keySet = this.settingsStore.get<boolean>('ai.apiKeySet', false)
    this.isAiConfigured = provider === 'Ollama' || keySet
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
          content: 'Understood.'
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
      // An empty key tells the main process to use the stored one.
      const response = await electron.net.chat(provider, model, '', payloadMessages, '')

      const replaceRegex = /```writemd-replace\s*\n([\s\S]*?)```/
      const match = response.match(replaceRegex)

      if (match) {
        const applied = await this.applyAiReplacement(match[1], currentPath)
        // Remove the block from the chat response so it doesn't clutter the UI
        const cleaned = response.replace(replaceRegex, '').trim()
        const note = applied
          ? cleaned || 'I have updated the document.'
          : 'I left your document alone: you switched tabs before the reply arrived. Ask again with that file active.'
        this.aiMessages = [...this.aiMessages, { role: 'assistant', content: note }]
      } else {
        this.aiMessages = [...this.aiMessages, { role: 'assistant', content: response }]
      }
    } catch (e) {
      this.aiMessages = [
        ...this.aiMessages,
        { role: 'assistant', content: `Error: ${describeAiError(e)}` }
      ]
    } finally {
      this.aiIsLoading = false
    }
  }

  /**
   * Apply an AI-provided document replacement and force-save it to disk.
   * Returns false when the target document is no longer the active one.
   */
  private async applyAiReplacement(
    newContent: string,
    targetPath: string | null
  ): Promise<boolean> {
    // setContent and save() both act on whatever is active now. If the user
    // switched documents while the model was thinking, the reply belongs to the
    // file it was asked about, not to the one on screen. Bail out rather than
    // overwrite a document the user never asked the model to touch.
    if (this.fileState.getState().path !== targetPath) {
      return false
    }
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
    return true
  }

  private handleAiSubmitEvent(e: Event): void {
    const text = (e as CustomEvent<{ text: string }>).detail.text
    void this.handleAiSubmit(text)
  }

  /**
   * Whether the split pane shows a document editor. The lifecycle code and the
   * template must agree on this exactly, so both read this one getter rather
   * than each spelling out the condition.
   */
  private get mountsSecondaryView(): boolean {
    return shouldMountSecondaryView({
      splitActive: this.splitActive,
      secondaryDoc: this.secondaryDoc,
      splitSurface: this.splitSurface
    })
  }

  disconnectedCallback(): void {
    for (const unsub of this.busUnsubs) unsub()
    this.busUnsubs = []
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer)
    this.unsubscribe?.()
    // Before destroying the views: stopResize re-measures them, and it must not
    // run against an already-destroyed view. A teardown mid-drag would otherwise
    // leave the two document listeners and the resize cursor in place, pinning
    // this element and both views.
    this.stopResize()
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
    // The container only exists in the non-empty render branch. If the view is
    // still live but the container was just removed (or replaced), the view is
    // bound to a detached node and the next open renders a blank pane. Same
    // hazard initEditor() documents, so handle it here too.
    const container = this.shadowRoot?.querySelector('#primary-cm-wrapper')
    if (this.editorView && !container) {
      this.editorView.destroy()
      this.editorView = null
    }
    if (!this.editorView && container) {
      this.initEditor()
    }

    if (this.mountsSecondaryView) {
      if (!this.secondaryEditorView) this.initSecondaryEditor()
    } else if (this.secondaryEditorView) {
      this.secondaryEditorView.destroy()
      this.secondaryEditorView = null
    }
  }

  /**
   * Mode-scoped extensions. The table editing affordances live here rather than
   * in the base list, so reading mode does not build a table toolbar tooltip or
   * bind Tab-to-next-cell against a view the user cannot type in. Anything
   * added to `getBaseExtensions` instead of here runs in every mode, so new
   * extensions belong in this function unless they are mode-independent.
   */
  private getModeExtensions(mode: ViewMode): Extension[] {
    const normalized = mode === 'wysiwyg' ? 'live' : mode
    if (normalized === 'reading') {
      return [readOnlyExtension(true), livePreviewPlugin({ onLinkClick: this.handleLinkClick })]
    }
    if (normalized === 'source') {
      return [
        readOnlyExtension(false),
        // Source mode renders no link decorations, so matching a click has to
        // come from the syntax tree. Without this, `[a](b.md)` is inert here
        // while it works in every other mode.
        linkClickStyleFacet.of('syntax'),
        makeLinkClickHandler(this.handleLinkClick)
      ]
    }
    // Default: 'live' (Obsidian Live Preview)
    return [
      readOnlyExtension(false),
      tableKeymapPlugin,
      tableToolbarField,
      tableLinePlugin,
      livePreviewPlugin({ onLinkClick: this.handleLinkClick })
    ]
  }

  /**
   * Settings-driven chrome, kept in its own compartment so toggling line
   * numbers or word wrap reconfigures without rebuilding the view. These used to
   * be hardcoded, which made the matching settings toggles write a key that
   * nothing read.
   */
  private getChromeExtensions(): Extension[] {
    const store = this.settingsStore
    const showLineNumbers = store?.get<boolean>('editor.showLineNumbers', false) ?? false
    const highlightActive = store?.get<boolean>('editor.highlightActiveLine', true) ?? true
    const wordWrap = store?.get<boolean>('editor.wordWrap', true) ?? true
    const tabSize = store?.get<number>('editor.tabSize', 2) ?? 2
    const mermaid = store?.get<boolean>('advanced.enableMermaid', true) ?? true

    return [
      showLineNumbers ? lineNumbers() : [],
      highlightActive ? highlightActiveLineGutter() : [],
      highlightActive ? highlightActiveLine() : [],
      mermaidEnabledFacet.of(mermaid),
      // `EditorView.lineWrapping` is a plain extension with no off switch, so
      // wrapping is driven through `white-space` on `.cm-content`, which is
      // what the library reads back to decide its own behavior.
      EditorView.theme({
        '.cm-content': wordWrap ? { whiteSpace: 'pre-wrap' } : { whiteSpace: 'pre' }
      }),
      EditorState.tabSize.of(tabSize)
    ]
  }

  private getBaseExtensions(
    isSecondary: boolean,
    mode: ViewMode,
    currentPath: string | null
  ): Extension[] {
    const comp = isSecondary ? this.secondaryModeCompartment : this.primaryModeCompartment
    const pathComp = isSecondary ? this.secondaryPathCompartment : this.primaryPathCompartment
    const chromeComp = isSecondary ? this.secondaryChromeCompartment : this.primaryChromeCompartment

    const exts = [
      writeMDTheme,
      vscodeHighlight,
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
              // query - we render our own panel, so swallow it instead.
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
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown({ extensions: [GFM], codeLanguages: languages }),
      comp.of(this.getModeExtensions(mode)),
      chromeComp.of(this.getChromeExtensions()),
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
          this.findPanelEl?.refreshCounts()
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
    // Destroy before the early return, not after it. The container is absent
    // whenever the empty state is rendered, and bailing out first left a live
    // view whose DOM had just been removed by the template.
    this.editorView?.destroy()
    this.editorView = null
    if (!container) return

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
    this.secondaryEditorView?.destroy()
    this.secondaryEditorView = null
    if (!container || !this.secondaryDoc) return

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

  /**
   * Typed reference to the find panel. A @query decorator keeps this in
   * sync with the template, so renaming the element is a compile error rather
   * than a silent no-op from a string selector.
   */
  @query('writemd-find-panel')
  private findPanelEl!: FindPanel

  private handleGlobalFind = (detail: { mode: 'find' | 'replace' }): void => {
    this.openFind(detail.mode)
  }

  /**
   * Every dependency `navigateLink` needs to turn a destination into an action.
   * `documentPathFacet` on the clicked view decides which document the link is
   * relative to, so the split pane resolves against its own path.
   */
  private navigateDeps(sourcePath: string | null): NavigateDeps {
    return {
      sourcePath,
      getApi: api,
      openFile: (path) => this.fileState.openFile(path),
      scrollToAnchor: (anchor) => this.scrollToAnchor(anchor),
      onMissing: (path) => {
        this.showNotice(`No file at ${shortPath(path)}`)
      }
    }
  }

  /** Follow a clicked markdown link: web URLs leave the app, everything else opens. */
  private handleLinkClick = (raw: string, view: EditorView): void => {
    const sourcePath = view.state.facet(documentPathFacet)
    void navigateLink(raw, this.navigateDeps(sourcePath))
  }

  /** Follow a clicked `[[wiki-link]]`: open the matching file, creating it if needed. */
  private handleOpenWikiLink = (detail: { name: string }): void => {
    const target = cleanWikiTarget(detail.name)
    if (!target) return
    void this.openWikiTarget(target)
  }

  private async openWikiTarget(target: string): Promise<void> {
    const stem = basenameNoExt(target.toLowerCase())
    const withSubpath = target.replace(/\\/g, '/').includes('/')

    // The wiki pane fires from a widget inside one of the two views, so the
    // anchor and relative-path cases resolve against whichever document the
    // click happened in.
    const sourcePath = this.wikiSourcePath()
    const deps = this.navigateDeps(sourcePath)

    // Open tabs first (any folder), then vault files, then recent files.
    const tabs = this.fileState.getState().tabs
    const tabHit = tabs.find((t) => t.path && basenameNoExt(t.path.toLowerCase()) === stem)
    if (tabHit?.path) {
      await this.fileState.openFile(tabHit.path)
      return
    }

    const vaultPaths = await this.vaultPaths()
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
    if (!vaultPath) {
      this.showNotice('Set a vault folder before creating linked notes.')
      return
    }
    const safe = target
      .replace(/\\/g, '/')
      .split('/')
      // `..` is stripped along with the illegal filename characters: a wiki
      // target must not be able to walk out of the vault on the create path.
      .map((seg) =>
        seg
          .replace(/[<>:"|?*]/g, '')
          .replace(/^\.+$/, '')
          .trim()
      )
      .filter(Boolean)
      .join('/')
    if (!safe) return

    const created = await resolveOrCreateLink(`${vaultPath.replace(/\\/g, '/')}/${safe}`, {
      ...deps,
      createMissing: async (path) => {
        await api()?.file?.write?.(path, '')
      }
    })
    if (created) await this.fileState.openFile(created)
  }

  /** Every file path in the vault, flattened out of the tree. */
  private async vaultPaths(): Promise<string[]> {
    const out: string[] = []
    const collect = (node: VaultTreeNode): void => {
      if (node.isDirectory) {
        for (const child of node.children ?? []) collect(child)
      } else if (node.path) {
        out.push(node.path)
      }
    }
    const tree = await api()
      ?.vault?.getTree?.()
      .catch(() => undefined)
    if (tree) collect(tree)
    return out
  }

  /** Document path of whichever pane the last interaction came from. */
  private wikiSourcePath(): string | null {
    const { secondaryDoc, splitActive } = this.fileState.getState()
    if (splitActive && secondaryDoc?.path) return secondaryDoc.path
    return this.fileState.getState().path
  }

  /** Reveal a `#heading` anchor in the focused editor view. */
  private scrollToAnchor(anchor: string): void {
    const needle = anchor.trim().toLowerCase()
    if (!needle) return
    const view = this.findTargetView ?? this.editorView
    if (!view) return
    for (let pos = 0; pos <= view.state.doc.length; pos++) {
      const line = view.state.doc.lineAt(pos)
      const text = line.text.slice(0, line.to).toLowerCase()
      if (headingMatches(text, needle)) {
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: 'start' })
        })
        view.focus()
        return
      }
      pos = line.to
    }
  }

  /** Transient status line above the editor. Rendered by `notice` in the template. */
  private showNotice(message: string): void {
    this.notice = message
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer)
    this.noticeTimer = window.setTimeout(() => {
      this.noticeTimer = null
      this.notice = ''
    }, 4000)
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
        this.findPanelEl?.setQuery(seed)
      }
      this.findPanelEl?.focusPanel()
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
    this.findPanelEl?.doFindNext()
  }

  private handleFindPreviousEvent = (): void => {
    this.findPanelEl?.doFindPrevious()
  }

  private handleReplaceNextEvent = (): void => {
    this.findPanelEl?.doReplace()
  }

  private handleReplaceAllEvent = (): void => {
    this.findPanelEl?.doReplaceAll()
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

  private async handleRename(e: Event, isSecondary: boolean): Promise<void> {
    const input = e.target as HTMLInputElement
    const newName = input.value.trim()
    if (!newName) {
      // Revert to original title if empty
      input.value = displayTitle(isSecondary ? this.secondaryDoc?.path || null : this.filePath)
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
      input.value = displayTitle(isSecondary ? this.secondaryDoc?.path || null : this.filePath)
      input.blur()
    }
  }

  /** Enter/Space on an icon-action div, so it is reachable by keyboard. */
  private handleIconActionKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).click()
  }

  private startResize = (e: MouseEvent): void => {
    e.preventDefault()
    this.isDraggingResizer = true
    document.addEventListener('mousemove', this.doResize)
    document.addEventListener('mouseup', this.stopResize)
    document.body.style.cursor = 'col-resize'
  }

  /**
   * Arrow-key resize. The resizer had no role, no tabindex and no keyboard
   * path at all, so split width was mouse-only.
   */
  private handleResizerKey = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 10 : 2
    if (e.key === 'ArrowLeft') this.leftPaneWidth = Math.max(20, this.leftPaneWidth - step)
    else if (e.key === 'ArrowRight') this.leftPaneWidth = Math.min(80, this.leftPaneWidth + step)
    else return
    e.preventDefault()
    this.editorView?.requestMeasure()
    this.secondaryEditorView?.requestMeasure()
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

  /** Idempotent: safe to call when no drag is in progress. */
  private stopResize = (): void => {
    if (!this.isDraggingResizer) return
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
    // Bound once so the template can use it without re-asserting the condition.
    const secondaryDoc = this.secondaryDoc

    return html`
      <div class="workspace">
        ${this.notice ? html`<div class="notice" role="status">${this.notice}</div>` : ''}
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
                    role="separator"
                    tabindex="0"
                    aria-orientation="vertical"
                    aria-label="Resize split panes"
                    aria-valuenow=${Math.round(this.leftPaneWidth)}
                    aria-valuemin="20"
                    aria-valuemax="80"
                    @mousedown=${this.startResize}
                    @keydown=${this.handleResizerKey}
                  ></div>
                  <writemd-panel class="pane">
                    ${
                      this.mountsSecondaryView && secondaryDoc
                        ? html`
                            <!-- Secondary Document Editor -->
                            <div class="sub-header">
                              <div class="sub-header-left">${displayPath(secondaryDoc.path)}</div>
                              <div class="sub-header-center">
                                ${
                                  secondaryDoc.isDiff
                                    ? html`<span style="color: var(--warning); font-weight: 600;"
                                        >External Changes Diff</span
                                      >`
                                    : html`<input
                                        type="text"
                                        class="title-input"
                                        aria-label="Split pane document title"
                                        .value=${displayTitle(secondaryDoc.path)}
                                        @blur=${(e: Event) => this.handleRename(e, true)}
                                        @keydown=${(e: KeyboardEvent) => this.handleRenameKeyDown(e, true)}
                                      />`
                                }
                              </div>
                              <div class="sub-header-right">
                                <div
                                  class="icon-action"
                                  role="button"
                                  tabindex="0"
                                  aria-label="Close split pane"
                                  title="Close split pane"
                                  @keydown=${this.handleIconActionKey}
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
                                .content=${secondaryDoc.content}
                                .mode=${secondaryDoc.viewMode}
                                @mode-change=${(e: CustomEvent<{ mode: ViewMode }>) => {
                                  // Go through FileState, not local state: a local
                                  // mutation is overwritten by the next notify()
                                  // from the store, which dispatches a second
                                  // reconfigure and leaves the two out of sync.
                                  void this.fileState.setSecondaryViewMode(e.detail.mode)
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
                                    role="button"
                                    tabindex="0"
                                    aria-label="Close split pane"
                                    title="Close split pane"
                                    @keydown=${this.handleIconActionKey}
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
                                      role="button"
                                      tabindex="0"
                                      aria-label="Close split pane"
                                      title="Close split pane"
                                      @keydown=${this.handleIconActionKey}
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
                                        role="button"
                                        tabindex="0"
                                        aria-label="Clear chat history"
                                        title="Clear chat history"
                                        @keydown=${this.handleIconActionKey}
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
                                        role="button"
                                        tabindex="0"
                                        aria-label="Close split pane"
                                        title="Close split pane"
                                        @keydown=${this.handleIconActionKey}
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
                                        role="button"
                                        tabindex="0"
                                        aria-label="Close split pane"
                                        title="Close split pane"
                                        @keydown=${this.handleIconActionKey}
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
