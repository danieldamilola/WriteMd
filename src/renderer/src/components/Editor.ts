import { html, css, LitElement, unsafeCSS } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import katexCss from 'katex/dist/katex.min.css?inline'
import { findNext, findPrevious, getSearchQuery } from '@codemirror/search'
import { scrollbarStyles } from './scrollbars'
import { SettingsStore } from '../state/settings'
import { type AiMessage } from './AiPanel'
import type { AttachedFile, ChatSessionSummary } from '../../../shared/electron-api'
import { icon } from './icons'
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
import { installFocusReportingFix } from '../utils/focus-reporting'
import { conceal } from '../utils/motion'
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
import { hasOriginalDocUpdate } from '../state/conflict'
import './Panel'
import './Workspace'
import './InfoPill'
import './DocBar'
import './SurfaceLauncher'
import './TextMenu'
import './VaultExplorer'
import { api } from '../api'
import { AiSessionController } from '../controllers/ai-session'
export { AI_DOC_CONTEXT_LIMIT, documentContextFor } from '../controllers/ai-session'
import type { VaultTreeNode } from '../../../shared/electron-api'
import { basenameNoExt, cleanWikiTarget, displayPath, shortPath } from '../utils/links'
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
/** Relative for anything recent, absolute beyond a week. */
function formatWhen(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
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
        background: transparent;
        box-sizing: border-box;
        padding: 0;
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
        animation: notice-in var(--motion-base) var(--motion-ease);
      }

      @keyframes notice-in {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-6px);
        }
      }

      :host-context([data-motion='reduced']) {
        .notice {
          animation: none;
        }
      }

      .pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        min-width: 0;
        position: relative;
        height: 100%;
        overflow: hidden;
        /*
         * The left pane's inline style goes from flex:1 to
         * flex:0 0 calc(50% - 2.5px) when the split opens. The shorthand
         * expands to grow/shrink/basis and all three interpolate, so this
         * carries the pane from full width to its share. This used to be a
         * WAAPI animation on flexBasis alongside this transition: two
         * mechanisms on one property, and the left pane jumped back out to full
         * width on the first frame before easing down, which is what read as a
         * bounce. The incoming pane has its own pane-in for the reveal.
         */
        transition: flex var(--motion-base) var(--motion-ease);
      }

      :host-context([data-motion='reduced']) {
        .pane {
          transition: none;
        }
      }

      /* Sub-header inside editor panel (49px) */
      .sub-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 49px;
        padding: 0 20px;
        flex-shrink: 0;
        user-select: none;
        font-family: var(--font-ui);
        font-size: 14px;
      }

      .sub-header-left {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--text-muted);
        font-size: 13px;
        overflow: hidden;
        white-space: nowrap;
        -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
        mask-image: linear-gradient(to right, black 80%, transparent 100%);
        flex: 1;
      }

      .sub-header-left span {
        color: var(--text);
        font-weight: 500;
        font-size: 13px;
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
        transition: background var(--motion-base);
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

      .pane-in {
        animation: pane-in var(--motion-base) var(--motion-ease);
      }

      @keyframes pane-in {
        from {
          opacity: 0;
          transform: translateX(24px) scale(0.99);
        }
      }

      :host-context([data-motion='reduced']) {
        .pane-in {
          animation: none;
        }
      }

      /* Swapping surfaces inside the split pane is a content change, not an
         instant patch: fade the incoming surface. */
      writemd-ai-panel,
      writemd-backlinks-panel,
      writemd-vault-explorer,
      writemd-surface-launcher,
      writemd-panel .sub-header + * {
        animation: surface-in var(--motion-base) var(--motion-ease-out);
      }

      @keyframes surface-in {
        from {
          opacity: 0;
        }
      }

      :host-context([data-motion='reduced']) {
        writemd-ai-panel,
        writemd-backlinks-panel,
        writemd-vault-explorer,
        writemd-surface-launcher,
        writemd-panel .sub-header + * {
          animation: none;
        }
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

      .icon-action.faint {
        opacity: 0.35;
      }

      /* The history list hangs off the clock button in the AI panel header. */
      .ai-history-anchor {
        position: relative;
        display: flex;
      }

      .ai-history {
        position: absolute;
        top: 30px;
        right: 0;
        z-index: 30;
        width: 250px;
        max-height: 300px;
        overflow-y: auto;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: var(--shadow-3);
        padding: 4px;
        transform-origin: top right;
        animation: ai-history-in var(--motion-fast) var(--motion-ease);
      }

      @keyframes ai-history-in {
        from {
          opacity: 0;
          transform: translateY(-4px) scale(0.97);
        }
      }

      :host-context([data-motion='reduced']) {
        .ai-history {
          animation: none;
        }
      }

      .ai-history-empty {
        padding: 12px 10px;
        text-align: center;
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--text-muted);
      }

      .ai-history-item {
        display: block;
        width: 100%;
        text-align: left;
        border-radius: 5px;
        padding: 7px 9px;
        cursor: pointer;
        color: var(--text-secondary);
        font-family: var(--font-mono);
        font-size: 12px;
        line-height: 1.4;
      }

      .ai-history-item:hover {
        background: var(--bg-hover);
        color: var(--text);
      }

      .ai-history-item.current {
        color: var(--text);
        background: var(--bg-hover);
      }

      .ai-history-title {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ai-history-meta {
        display: block;
        margin-top: 2px;
        font-size: 10px;
        color: var(--text-muted);
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
  /**
   * The exact text the CodeMirror views currently hold.
   *
   * Kept as the same string object the view produced, so the sync check in the
   * state subscription is a pointer comparison instead of a fresh
   * `doc.toString()` of the whole document on every keystroke.
   */
  private viewContent = ''
  private secondaryViewContent = ''
  @state() private filePath: string | null = null
  @state() private viewMode: ViewMode = 'live'
  @state() private splitActive = false
  /**
   * True while the split is playing its exit. The pane stays mounted until the
   * animation ends, and the left pane keeps its width for the same moment, so
   * the space is claimed once rather than twice.
   */
  @state() private splitLeaving = false
  @state() private splitSurface: SplitSurface = 'launcher'
  @state() private secondaryDoc: SecondaryDocState | null = null
  @state() private textMenu: { x: number; y: number; secondary: boolean } | null = null
  @state() private findPane: 'primary' | 'secondary' = 'primary'
  @state() private findOpen = false
  @state() private findMode: 'find' | 'replace' = 'find'
  @state() private findQuery = ''
  @state() private findWholeWord = false
  @state() private findCaseSensitive = false
  @state() private findRegex = false
  @state() private notice = ''
  private noticeTimer: number | null = null

  @state() private panelOrientation: 'horizontal' | 'vertical' = 'horizontal'
  private readonly ai = new AiSessionController(this, {
    path: () => this.filePath,
    content: () => this.content,
    closeHistory: () => {
      this.aiHistoryOpen = false
    },
    replace: (content, path) => this.applyAiReplacement(content, path)
  })
  @state() private aiHistoryOpen = false
  private get isAiConfigured(): boolean {
    return this.ai.isAiConfigured
  }
  private set isAiConfigured(value: boolean) {
    this.ai.isAiConfigured = value
  }
  private get aiMessages(): AiMessage[] {
    return this.ai.aiMessages
  }
  private set aiMessages(value: AiMessage[]) {
    this.ai.aiMessages = value
  }
  private get aiIsLoading(): boolean {
    return this.ai.aiIsLoading
  }
  private set aiIsLoading(value: boolean) {
    this.ai.aiIsLoading = value
  }
  private get aiSessionId(): string | null {
    return this.ai.aiSessionId
  }
  private set aiSessionId(value: string | null) {
    this.ai.aiSessionId = value
  }
  private get aiSessions(): ChatSessionSummary[] {
    return this.ai.aiSessions
  }
  private set aiSessions(value: ChatSessionSummary[]) {
    this.ai.aiSessions = value
  }
  private get aiAttachments(): AttachedFile[] {
    return this.ai.aiAttachments
  }
  private set aiAttachments(value: AttachedFile[]) {
    this.ai.aiAttachments = value
  }
  private get aiAttaching(): boolean {
    return this.ai.aiAttaching
  }
  private set aiAttaching(value: boolean) {
    this.ai.aiAttaching = value
  }
  private get aiModels(): string[] {
    return this.ai.aiModels
  }
  private set aiModels(value: string[]) {
    this.ai.aiModels = value
  }
  private get aiModelsLoading(): boolean {
    return this.ai.aiModelsLoading
  }
  private set aiModelsLoading(value: boolean) {
    this.ai.aiModelsLoading = value
  }
  /**
   * Model the composer names on its chip, so the target of a send is visible.
   *
   * A getter rather than a field, so there is one source of truth for it. That
   * means a change to `ai.model` does not by itself re-render anything, hence the
   * subscription below: without it the chip keeps naming the previous model after
   * the user picks a different one.
   */
  private get aiModel(): string {
    return this.settingsStore?.get('ai.model', '') ?? ''
  }

  /** Click outside closes the history list. */ private readonly onAiHistoryPointerDown = (
    e: Event
  ): void => {
    if (!this.aiHistoryOpen) return
    const anchor = this.shadowRoot?.querySelector('.ai-history-anchor')
    if (anchor && !e.composedPath().includes(anchor)) this.aiHistoryOpen = false
  }

  private toggleAiHistory = (): void => {
    const next = !this.aiHistoryOpen
    this.aiHistoryOpen = next
    if (next) void this.refreshAiSessions()
  }

  /**
   * Ask the provider which models this key can reach.
   *
   * Settings already does this for the AI tab, but the composer's chip needs the
   * list too, and the key never crosses into renderer memory: the request goes
   * out with an empty key and main substitutes the stored one.
   */
  private refreshAiModels = this.ai.refreshAiModels.bind(this.ai)
  private handleAiModelChange = this.ai.handleAiModelChange.bind(this.ai)
  private handleAiAttachRequest = this.ai.handleAiAttachRequest.bind(this.ai)
  private handleAiAttachFiles = this.ai.handleAiAttachFiles.bind(this.ai)
  private handleAiAttachRemove = this.ai.handleAiAttachRemove.bind(this.ai)
  private handleAiCancel = this.ai.handleAiCancel.bind(this.ai)
  private handleAiClear = this.ai.handleAiClear.bind(this.ai)
  private checkAiConfigured = this.ai.checkAiConfigured.bind(this.ai)
  private handleAiWebSearchToggle = this.ai.handleAiWebSearchToggle.bind(this.ai)
  private stashAiSessionForPath = this.ai.stashAiSessionForPath.bind(this.ai)
  private loadAiSession = this.ai.loadAiSession.bind(this.ai)
  private refreshAiSessions = this.ai.refreshAiSessions.bind(this.ai)
  private handleAiNewSession = this.ai.handleAiNewSession.bind(this.ai)
  private handleAiSelectSession = this.ai.handleAiSelectSession.bind(this.ai)
  private handleAiSubmit = this.ai.handleAiSubmit.bind(this.ai)
  private handleThoughtSettle = this.ai.handleThoughtSettle.bind(this.ai)
  private settingsStore: SettingsStore | null = null
  private settingsUnsubs: Array<() => void> = []
  private busUnsubs: Array<() => void> = []

  connectedCallback(): void {
    super.connectedCallback()
    document.addEventListener('pointerdown', this.onAiHistoryPointerDown, true)
    this.busUnsubs.push(on('find:open', this.handleGlobalFind))
    this.busUnsubs.push(on('wiki:open', this.handleOpenWikiLink))
    this.busUnsubs.push(
      on('ai:models-updated', ({ models }) => {
        this.aiModels = models
      })
    )
    this.settingsStore = SettingsStore.getInstance()
    this.panelOrientation = this.settingsStore.get('appearance.panelOrientation', 'vertical') as
      'horizontal' | 'vertical'
    this.checkAiConfigured()
    this.settingsUnsubs.push(
      this.settingsStore.subscribe('ai.apiKeySet', () => this.checkAiConfigured())
    )
    this.settingsUnsubs.push(
      this.settingsStore.subscribe('ai.provider', () => {
        this.checkAiConfigured()
        // The old provider's model list is meaningless against the new one.
        void this.refreshAiModels()
      })
    )
    this.settingsUnsubs.push(
      this.settingsStore.subscribe('ai.apiKeySet', () => void this.refreshAiModels())
    )
    // The chip reads the model through a getter, so nothing re-renders when it
    // changes unless this asks for one.
    this.settingsUnsubs.push(this.settingsStore.subscribe('ai.model', () => this.requestUpdate()))
    this.settingsUnsubs.push(
      this.settingsStore.subscribe('ai.webSearchEnabled', () => this.requestUpdate())
    )
    void this.refreshAiModels()
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
    // Restores the chat for the document restored at launch. The subscription
    // below only fires on a *change*, and filePath is already assigned here, so
    // without this the first session is never loaded.
    void this.loadAiSession()

    this.unsubscribe = this.fileState.subscribe((s) => {
      const normalizedMode = s.viewMode === 'wysiwyg' ? 'live' : s.viewMode
      const modeChanged = this.viewMode !== normalizedMode
      const docChanged = this.content !== s.content
      const oldPath = this.filePath
      const newPath = s.path
      const pathChanged = oldPath !== newPath
      const secondaryDocChanged = this.secondaryDoc?.content !== s.secondaryDoc?.content
      const secondaryPathChanged = this.secondaryDoc?.path !== s.secondaryDoc?.path
      const secondaryModeChanged = this.secondaryDoc?.viewMode !== s.secondaryDoc?.viewMode

      const wasSplitActive = this.splitActive
      this.content = s.content
      this.viewMode = normalizedMode
      this.splitActive = s.splitActive
      this.splitSurface = s.splitSurface
      this.secondaryDoc = s.secondaryDoc

      // Closing the split has to keep the pane on screen long enough to leave,
      // so every path that closes it (the toolbar toggle, the pane's own close
      // button, Escape) goes through this one place instead of each animating
      // its own teardown.
      if (wasSplitActive && !s.splitActive) this.startSplitExit()

      // Chat is per document, so switching tabs swaps the transcript. The
      // initial document is handled at setup, above; this is the change case.
      if (pathChanged) {
        this.stashAiSessionForPath(oldPath)
        this.filePath = newPath
        void this.loadAiSession(newPath)
      } else {
        this.filePath = newPath
      }

      // While a conflict merge is open the secondary view owns the document
      // text. `setSecondaryContent` writes the merged result into top-level
      // `content`, and pushing that into the primary view on every keystroke
      // would reset the primary cursor and undo history, then loop back through
      // the primary `updateListener`. Comparing against the live view doc means
      // the primary catches up by itself once the merge closes.
      const mergeActive = Boolean(s.secondaryDoc?.isDiff)

      if (this.editorView && docChanged && !mergeActive && s.content !== this.viewContent) {
        if (pathChanged) {
          this.swapPrimaryDocument(s.content, s.path)
        } else {
          this.viewContent = s.content
          this.editorView.dispatch({
            changes: { from: 0, to: this.editorView.state.doc.length, insert: s.content }
          })
        }
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
        s.secondaryDoc.content !== this.secondaryViewContent
      ) {
        if (secondaryPathChanged) {
          this.swapSecondaryDocument(s.secondaryDoc.content, s.secondaryDoc.path)
        } else {
          this.secondaryViewContent = s.secondaryDoc.content
          this.secondaryEditorView.dispatch({
            changes: {
              from: 0,
              to: this.secondaryEditorView.state.doc.length,
              insert: s.secondaryDoc.content
            }
          })
        }
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
    this.viewContent = newContent
    this.fileState.setContent(newContent)
    // Force an immediate save to disk so the 'dirty' flag is cleared.
    // This prevents the OS file watcher from firing while dirty=true and popping the conflict modal.
    await this.fileState.save()
    return true
  }

  private handleAiSubmitEvent(e: Event): void {
    const { text, attachments } = (e as CustomEvent<{ text: string; attachments?: AttachedFile[] }>)
      .detail
    void this.handleAiSubmit(text, attachments ?? [])
  }

  /**
   * The live thought line froze. Keep it as a transcript entry, otherwise the
   * elapsed time only exists while the bubble is mounted and is lost the moment
   * the reply lands.
   */
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
    document.removeEventListener('pointerdown', this.onAiHistoryPointerDown, true)
    for (const unsub of this.busUnsubs) unsub()
    this.busUnsubs = []
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer)
    this.unsubscribe?.()
    // Before destroying the views: stopResize re-measures them, and it must not
    // run against an already-destroyed view. A teardown mid-drag would otherwise
    // leave the two document listeners and the resize cursor in place, pinning
    // this element and both views.
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
   * Close the split with motion: the pane leaves first, then the left pane
   * takes the space. The left pane keeps its width while the exit plays, so the
   * two never overlap, and its own `transition: flex` carries the expansion
   * afterwards.
   */
  private startSplitExit(): void {
    if (this.splitLeaving) return
    this.splitLeaving = true
    const pane = this.shadowRoot?.querySelector<HTMLElement>('writemd-panel.pane-in') ?? null
    void conceal(pane).then(() => {
      this.splitLeaving = false
      if (this.splitActive) return
      this.secondaryEditorView?.destroy()
      this.secondaryEditorView = null
    })
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
          // The string the view itself produced. The subscription below compares
          // against it instead of re-serializing the document, which on a 6 MB
          // note meant building a second copy of it on every keystroke just to
          // discover it was already in sync.
          if (isSecondary) {
            this.secondaryViewContent = newDoc
            this.fileState.setSecondaryContent(newDoc)
          } else {
            this.content = newDoc
            this.viewContent = newDoc
            this.fileState.setContent(newDoc)
          }
        } else if (
          isSecondary &&
          this.secondaryDoc?.isDiff &&
          update.transactions.some((tr) => hasOriginalDocUpdate(tr))
        ) {
          // Accept in the diff view: no document change, only the original
          // retargeted, but the merge doc is the resolved content and still
          // needs to reach the file.
          this.fileState.setSecondaryContent(update.state.doc.toString())
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

  /**
   * Point the primary view at a different file.
   *
   * `EditorState.create` rather than a dispatched replace. One view is reused
   * across every tab, so its single undo stack accumulated every file's edits:
   * opening a note and pressing Ctrl+Z applied the *previous* note's inverse
   * change to this one. Announcing the load as non-history was not enough on its
   * own, because the earlier document's events were still on the stack waiting
   * behind it, and `isolateHistory` only stops adjacent events merging, not undo
   * walking across the boundary. A new state is the boundary that holds.
   *
   * Selection and scroll restart with the document, which is what a new file
   * wants anyway.
   */
  private swapPrimaryDocument(content: string, path: string | null): void {
    const view = this.editorView
    if (!view) return
    this.viewContent = content
    view.setState(
      EditorState.create({
        doc: content,
        extensions: this.getBaseExtensions(false, this.viewMode, path)
      })
    )
    view.requestMeasure()
  }

  /** Secondary-pane counterpart of `swapPrimaryDocument`. */
  private swapSecondaryDocument(content: string, path: string | null): void {
    const view = this.secondaryEditorView
    if (!view || !this.secondaryDoc) return
    this.secondaryViewContent = content
    view.setState(
      EditorState.create({
        doc: content,
        extensions: this.getBaseExtensions(true, this.secondaryDoc.viewMode, path)
      })
    )
    view.requestMeasure()
  }

  private initEditor(): void {
    installFocusReportingFix()
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
    this.viewContent = this.content

    this.editorView = new EditorView({
      state,
      parent: container,
      root: this.shadowRoot ?? document
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
    this.secondaryViewContent = this.secondaryDoc.content

    this.secondaryEditorView = new EditorView({
      state,
      parent: container,
      // The split pane's wrapper is slotted into <writemd-panel>, so
      // CodeMirror picks that panel's shadow root as the view root and asks it
      // for `activeElement` before it writes the caret. That shadow root reports
      // null here, so every DOM-selection write was skipped and keystrokes
      // landed wherever the caret used to be. The editor's own shadow root does
      // report the focused view, so it is the root both views are given.
      root: this.shadowRoot ?? document
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

  private handleTextMenu = (e: MouseEvent, secondary = false): void => {
    e.preventDefault()
    this.textMenu = { x: e.clientX, y: e.clientY, secondary }
  }

  /** View the find panel currently targets (secondary pane when focused). */
  private get findTargetView(): EditorView | null {
    if (this.findOpen ? this.findPane === 'secondary' : this.secondaryEditorView?.hasFocus)
      return this.secondaryEditorView
    return this.editorView
  }

  /**
   * Typed reference to the find panel. A @query decorator keeps this in
   * sync with the template, so renaming the element is a compile error rather
   * than a silent no-op from a string selector.
   */
  @query('writemd-find-panel')
  private findPanelEl!: FindPanel

  private handleGlobalFind = (detail: {
    mode: 'find' | 'replace'
    pane?: 'primary' | 'secondary'
  }): void => {
    this.openFind(detail.mode, detail.pane)
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

  private openFind(mode: 'find' | 'replace', pane?: 'primary' | 'secondary'): void {
    this.findPane = pane ?? (this.secondaryEditorView?.hasFocus ? 'secondary' : 'primary')
    const view = this.findPane === 'secondary' ? this.secondaryEditorView : this.editorView
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
          await this.fileState.openSecondaryFile(result.filePaths[0], fileContent.content)
        }
      }
    } else {
      this.fileState.setSplitSurface(surface)
    }
  }

  /** Enter/Space on an icon-action div, so it is reachable by keyboard. */
  private handleIconActionKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).click()
  }

  render(): unknown {
    if (!this.filePath && !this.content) {
      return html`
        <writemd-panel empty>
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
        <writemd-workspace
          class="panes"
          .active=${this.splitActive || this.splitLeaving}
          .surface=${this.splitSurface}
          @workspace-measure=${() => {
            this.editorView?.requestMeasure()
            this.secondaryEditorView?.requestMeasure()
          }}
        >
          <writemd-panel class="pane" slot="primary" .empty=${!this.content.trim()}>
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
            </div>
          </writemd-panel>

          <!-- split view - 2 (Right Pane, only when splitActive is true) -->
          ${
            this.splitActive || this.splitLeaving
              ? html`
                  <writemd-panel
                    slot="auxiliary"
                    class="pane pane-in ${this.splitLeaving ? ' pane-leaving' : ''}"
                    .empty=${
                      this.mountsSecondaryView && secondaryDoc
                        ? !secondaryDoc.content.trim()
                        : this.splitSurface === 'ai'
                          ? this.aiMessages.length === 0
                          : this.splitSurface === 'launcher'
                    }
                  >
                    ${
                      this.mountsSecondaryView && secondaryDoc
                        ? html`
                            ${
                              secondaryDoc.isDiff
                                ? html`<div class="sub-header">
                                    <div class="sub-header-left" title=${secondaryDoc.path ?? ''}>
                                      ${displayPath(secondaryDoc.path)}
                                    </div>
                                    <div class="sub-header-center">
                                      <span style="color:var(--warning);font-weight:600"
                                        >External Changes Diff</span
                                      >
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
                                        ${icon('x')}
                                      </div>
                                    </div>
                                  </div>`
                                : html`<writemd-doc-bar secondary></writemd-doc-bar>`
                            }

                            <div
                              class="body-area"
                              @paste=${(e: ClipboardEvent) => this.handlePaste(e, true)}
                              @dragover=${(e: DragEvent) => e.preventDefault()}
                              @drop=${(e: DragEvent) => this.handleDrop(e, true)}
                              @contextmenu=${(e: MouseEvent) => this.handleTextMenu(e, true)}
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
                                <div class="sub-header-left">
                                  <div
                                    class="icon-action"
                                    role="button"
                                    tabindex="0"
                                    aria-label="Back to surfaces"
                                    title="Back to surfaces"
                                    @keydown=${this.handleIconActionKey}
                                    @click=${() => this.fileState.setSplitSurface('launcher')}
                                  >
                                    ${icon('arrow-left')}
                                  </div>
                                  <span>Vault Files</span>
                                </div>
                                <div class="sub-header-center"></div>
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
                                  <div class="sub-header-left">
                                    <div
                                      class="icon-action"
                                      role="button"
                                      tabindex="0"
                                      aria-label="Back to surfaces"
                                      title="Back to surfaces"
                                      @keydown=${this.handleIconActionKey}
                                      @click=${() => this.fileState.setSplitSurface('launcher')}
                                    >
                                      ${icon('arrow-left')}
                                    </div>
                                    <span>Backlinks</span>
                                  </div>
                                  <div class="sub-header-center"></div>
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
                                    <div class="sub-header-left">
                                      <div
                                        class="icon-action"
                                        role="button"
                                        tabindex="0"
                                        aria-label="Back to surfaces"
                                        title="Back to surfaces"
                                        @keydown=${this.handleIconActionKey}
                                        @click=${() => this.fileState.setSplitSurface('launcher')}
                                      >
                                        ${icon('arrow-left')}
                                      </div>
                                      <span>AI Assistant</span>
                                    </div>
                                    <div class="sub-header-center"></div>
                                    <div class="sub-header-right">
                                      <div class="ai-history-anchor">
                                        <div
                                          class="icon-action"
                                          role="button"
                                          tabindex="0"
                                          aria-label="Chat history"
                                          aria-haspopup="listbox"
                                          aria-expanded=${this.aiHistoryOpen ? 'true' : 'false'}
                                          title="Chat history"
                                          @keydown=${this.handleIconActionKey}
                                          @click=${this.toggleAiHistory}
                                        >
                                          ${icon('clock')}
                                        </div>
                                        ${
                                          this.aiHistoryOpen
                                            ? html`
                                                <div
                                                  class="ai-history"
                                                  role="listbox"
                                                  aria-label="Chat history"
                                                >
                                                  ${
                                                    this.aiSessions.length === 0
                                                      ? html`<div class="ai-history-empty">
                                                          No saved chats for this file yet.
                                                        </div>`
                                                      : this.aiSessions.map(
                                                          (s) => html`
                                                            <div
                                                              class="ai-history-item ${
                                                                s.id === this.aiSessionId
                                                                  ? 'current'
                                                                  : ''
                                                              }"
                                                              role="option"
                                                              tabindex="0"
                                                              aria-selected=${
                                                                s.id === this.aiSessionId
                                                                  ? 'true'
                                                                  : 'false'
                                                              }
                                                              @keydown=${this.handleIconActionKey}
                                                              @click=${() => this.handleAiSelectSession(s.id)}
                                                            >
                                                              <span class="ai-history-title"
                                                                >${s.title}</span
                                                              >
                                                              <span class="ai-history-meta"
                                                                >${s.messageCount}
                                                                message${
                                                                  s.messageCount === 1 ? '' : 's'
                                                                }
                                                                - ${formatWhen(s.updatedAt)}</span
                                                              >
                                                            </div>
                                                          `
                                                        )
                                                  }
                                                </div>
                                              `
                                            : ''
                                        }
                                      </div>
                                      <div
                                        class="icon-action"
                                        role="button"
                                        tabindex="0"
                                        aria-label="New chat"
                                        title="New chat"
                                        @keydown=${this.handleIconActionKey}
                                        @click=${this.handleAiNewSession}
                                      >
                                        ${icon('plus')}
                                      </div>
                                      <div
                                        class="icon-action"
                                        role="button"
                                        tabindex="0"
                                        aria-label="Clear chat history"
                                        title="Clear chat history"
                                        @keydown=${this.handleIconActionKey}
                                        @click=${() => this.handleAiClear()}
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
                                    .model=${this.aiModel}
                                    .models=${this.aiModels}
                                    .modelsLoading=${this.aiModelsLoading}
                                    .attachments=${this.aiAttachments}
                                    .attaching=${this.aiAttaching}
                                    .webSearch=${
                                      this.settingsStore?.get<boolean>(
                                        'ai.webSearchEnabled',
                                        false
                                      ) ?? false
                                    }
                                    @ai-submit=${this.handleAiSubmitEvent}
                                    @ai-cancel=${this.handleAiCancel}
                                    @ai-websearch-toggle=${this.handleAiWebSearchToggle}
                                    @ai-attach-request=${this.handleAiAttachRequest}
                                    @ai-attach-files=${this.handleAiAttachFiles}
                                    @ai-attach-remove=${this.handleAiAttachRemove}
                                    @ai-model-change=${this.handleAiModelChange}
                                    @thought-settle=${this.handleThoughtSettle}
                                  ></writemd-ai-panel>
                                `
                              : html`
                                  <!-- Open a surface Launcher Panel -->
                                  <div class="sub-header">
                                    <div class="sub-header-left">Surface</div>
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
        </writemd-workspace>
        ${
          this.textMenu && (this.textMenu.secondary ? this.secondaryEditorView : this.editorView)
            ? html`<writemd-text-menu
                .x=${this.textMenu.x}
                .y=${this.textMenu.y}
                .flip=${this.textMenu.x > window.innerWidth - 480}
                .view=${this.textMenu.secondary ? this.secondaryEditorView : this.editorView}
                @close=${() => (this.textMenu = null)}
              ></writemd-text-menu>`
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
