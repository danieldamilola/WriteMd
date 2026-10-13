import { html, css, LitElement, unsafeCSS } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import katexCss from 'katex/dist/katex.min.css?inline'
import { findNext, findPrevious, getSearchQuery } from '@codemirror/search'
import { scrollbarStyles } from './scrollbars'
import { resizeHandleStyles } from '../design/controls'
import { WorkspaceState, aiDockGeometry } from '../state/workspace'
import { SettingsStore } from '../state/settings'
import { documentChanges } from '../utils/document-changes'
import { icon } from './icons'
import './FindPanel'
import './BacklinksPanel'
import './ai/AiDock'
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
import { DURATION, reducedMotionNow } from '../utils/motion'
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
import { inlineTitle, renameTitleFacet, showInlineTitleFacet } from './extensions/inline-title'
import './DocBar'
import './PreviewPanel'
import './TextMenu'
import type { AiSelectionAction, TextMenuSelection } from './TextMenu'
import type { QuickAiContext } from './ai/quick-context'
import './VaultExplorer'
import { api } from '../api'
import type { VaultTreeNode } from '../../../shared/electron-api'
import { basenameNoExt, cleanWikiTarget, displayPath, shortPath } from '../utils/links'
import { navigateLink, resolveOrCreateLink, type NavigateDeps } from '../utils/navigate'
import { showSecondaryDocument } from '../utils/secondary-document'
import { sameFilePath } from '../utils/paths'

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

@customElement('writemd-editor')
export class Editor extends LitElement {
  static styles = [
    unsafeCSS(katexCss),
    scrollbarStyles,
    resizeHandleStyles,
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
        container-type: inline-size;
        container-name: editor;
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

      /*
       * The dock is a flex child rather than an overlay so the editor narrows
       * beside it instead of hiding underneath. The workspace already has
       * flex 1, so a fixed-basis sibling lands at the right edge with no change
       * to the existing layout - which is why it is here and not positioned.
       */
      /*
       * The panel slides its own box in from the right while the space it takes
       * opens beside it, which is the sidebar's behaviour rather than a fade.
       * A panel that simply appears looks like a different app opening over
       * this one; one that slides reads as part of the same window rearranging
       * itself, and the document takes its space as the panel goes rather than
       * after it.
       *
       * Keyed on the transition attribute so it runs once per open and once per
       * close, not on every resize the geometry store publishes.
       */
      .ai-column {
        position: relative;
        display: flex;
        flex: 0 0 var(--ai-dock-width);
        min-width: 0;
        min-height: 0;
        height: 100%;
      }
      .ai-column.entering {
        animation: ai-column-in var(--motion-base) var(--motion-out);
      }
      .ai-column.leaving {
        animation: ai-column-out var(--motion-fast) var(--motion-in);
      }
      @keyframes ai-column-in {
        from {
          opacity: 0;
          transform: translateX(24px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
      @keyframes ai-column-out {
        from {
          opacity: 1;
          transform: translateX(0);
        }
        to {
          opacity: 0;
          transform: translateX(16px);
        }
      }
      :host-context([data-motion='reduced']) .ai-column {
        animation: none;
      }
      .ai-dock {
        flex: 1;
        min-width: 0;
        height: 100%;
        background: var(--editor-surface);
      }
      .ai-divider {
        position: absolute;
        inset: 0 auto 0 -4px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 8px;
        cursor: col-resize;
        touch-action: none;
        z-index: 4;
      }
      .ai-divider:focus-visible {
        outline: none;
      }
      .ai-divider:hover .resize-handle {
        color: var(--text);
      }
      .ai-divider:focus-visible .resize-handle {
        outline: 2px solid var(--border-focus);
        border-radius: var(--radius-sm);
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
      }

      /*
       * Surface tabs. These replaced a picker: every surface the pane can hold
       * sits one click away from every other, so switching no longer means
       * going back to a launcher first and then choosing again.
       *
       * No rule under the strip and no underline under the active tab. Weight
       * and colour carry the selection instead, which is how the panel
       * sub-headers below already do it, and a row with two drawn lines in it
       * read as heavier than the controls either side of it.
       */
      .surface-tabs {
        display: flex;
        align-items: center;
        gap: 2px;
        height: 32px;
        padding: 0 8px;
        flex-shrink: 0;
        user-select: none;
        font-family: var(--font-ui);
      }

      .surface-tab {
        display: flex;
        align-items: center;
        padding: 0 10px;
        height: 24px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--text-muted);
        font-family: inherit;
        font-size: 13px;
        font-weight: 400;
        cursor: pointer;
        white-space: nowrap;
        transition: color var(--motion-fast) var(--motion-ease);
      }

      .surface-tab:hover {
        background: var(--bg-hover);
        color: var(--text);
      }

      .surface-tab[aria-selected='true'] {
        color: var(--text);
        font-weight: 500;
      }

      .surface-tab:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: -2px;
      }

      /* Held the tab row left so the close button sits at the far right. */
      .surface-tabs-spacer {
        flex: 1;
        min-width: 8px;
      }

      .surface-tabs .icon-action {
        align-self: center;
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

      /* Swapping surfaces inside the split pane is a content change, not an
         instant patch: fade the incoming surface. */
      writemd-backlinks-panel,
      writemd-vault-explorer {
        animation: surface-in var(--motion-base) var(--motion-ease-out);
      }

      @keyframes surface-in {
        from {
          opacity: 0;
        }
      }

      :host-context([data-motion='reduced']) {
        writemd-backlinks-panel,
        writemd-vault-explorer {
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
        width: var(--icon-size, 18px);
        height: var(--icon-size, 18px);
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

  /**
   * The pane the quick AI bar belongs to.
   *
   * The bar floats over the bottom of the note being written in, so it follows
   * the pane rather than the window: opening the chat panel, a split pane or the
   * tab rail narrows the writing, and a bar that stayed window-wide would sit
   * across the panel it is meant to sit over.
   */
  get quickAiPane(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('writemd-panel[slot="primary"]')
  }

  /** Capture text from the currently focused pane before the quick AI popup takes focus. */
  getQuickAiContext(preferredPath?: string | null): QuickAiContext {
    const secondary =
      this.secondaryEditorView &&
      (preferredPath
        ? !sameFilePath(this.fileState.getState().path, preferredPath) &&
          sameFilePath(this.fileState.getState().secondaryDoc?.path, preferredPath)
        : this.secondaryEditorView.hasFocus)
        ? this.secondaryEditorView
        : null
    const view = secondary ?? this.editorView
    const state = this.fileState.getState()
    const path = secondary ? (state.secondaryDoc?.path ?? null) : state.path
    if (!view) return { path: null, content: '', selection: null }
    const content = view.state.doc.toString()
    const selected = view.state.selection.main
    if (selected.empty || selected.to - selected.from > 20_000) {
      return { path, content, selection: null }
    }
    return {
      path,
      content,
      selection: {
        from: selected.from,
        to: selected.to,
        text: view.state.sliceDoc(selected.from, selected.to)
      }
    }
  }

  private primaryModeCompartment = new Compartment()
  private secondaryModeCompartment = new Compartment()
  private primaryPathCompartment = new Compartment()
  private secondaryPathCompartment = new Compartment()
  private primaryChromeCompartment = new Compartment()
  private secondaryChromeCompartment = new Compartment()

  /**
   * Settings keys that require reconfiguring an editor view when they change.
   *
   * `fontSize` and `lineHeight` are here because both are CSS custom properties
   * on `:root`. Changing one resizes the text without the view ever hearing
   * about it, so CodeMirror keeps its cached line heights and the gutter keeps
   * the offset it measured from its first gutter element. The numbers stay on
   * the old line pitch and walk away from their lines: measured at 12px/1.2 the
   * worst gap was 54px, and at 20px/2.0 it was 91px. A cold start at the same
   * settings is fine, which is why this only showed up after a live change.
   */
  private static readonly CHROME_SETTINGS = [
    'editor.showLineNumbers',
    'editor.highlightActiveLine',
    'editor.wordWrap',
    'editor.tabSize',
    'editor.fontSize',
    'editor.lineHeight',
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
        // Re-read the line boxes now the metrics changed, so the gutter keeps
        // tracking the text it labels.
        view.requestMeasure()
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
   * Keep the closing surface mounted while the workspace releases its width.
   */
  @state() private splitLeaving = false
  @state() private splitSurface: SplitSurface = 'files'
  /** The assistant dock, a right-hand column beside the workspace. */
  @state() private aiEnabled = false
  @state() private aiDockOpen = false
  @state() private aiDockWidth = WorkspaceState.getInstance().aiDockWidth
  @state() private aiAvailable = 0
  private aiResizeObserver: ResizeObserver | null = null
  private aiResizePointer: number | null = null
  private aiResizeStart = 0
  private aiResizeInitial = 0
  private aiResizePreference = 0
  @state() private secondaryDoc: SecondaryDocState | null = null
  @state() private textMenu: {
    x: number
    y: number
    secondary: boolean
    selection: TextMenuSelection | null
  } | null = null
  @state() private findPane: 'primary' | 'secondary' = 'primary'
  @state() private findOpen = false
  @state() private findMode: 'find' | 'replace' = 'find'
  @state() private findQuery = ''
  @state() private findWholeWord = false
  @state() private findCaseSensitive = false
  @state() private findRegex = false
  @state() private notice = ''
  private noticeTimer: number | null = null
  /**
   * The panel's exit, held for its length.
   *
   * Closing unmounts the panel the instant the preference flips, so there is
   * nothing left to animate and the whole column blinks out of existence. This
   * keeps it mounted for the length of the exit and then lets it go, the same
   * shape the sidebar uses when it collapses.
   */
  @state() private aiClosing = false
  private aiCloseTimer: number | null = null

  @state() private panelOrientation: 'horizontal' | 'vertical' = 'horizontal'
  /** Whether the footer shows the document path on its left. */
  @state() private showFilePath = true
  private settingsStore: SettingsStore | null = null
  private settingsUnsubs: Array<() => void> = []
  private busUnsubs: Array<() => void> = []

  connectedCallback(): void {
    super.connectedCallback()
    if (typeof ResizeObserver !== 'undefined') {
      this.aiResizeObserver = new ResizeObserver(([entry]) => {
        if (entry) this.aiAvailable = entry.contentRect.width
      })
      this.aiResizeObserver.observe(this)
    }
    this.busUnsubs.push(on('find:open', this.handleGlobalFind))
    this.busUnsubs.push(on('editor:focus-inline-title', this.handleFocusInlineTitle))
    this.busUnsubs.push(on('wiki:open', this.handleOpenWikiLink))
    this.settingsStore = SettingsStore.getInstance()
    this.aiDockWidth = WorkspaceState.getInstance().aiDockWidth
    this.settingsUnsubs.push(
      this.settingsStore.subscribe('appearance.aiDockWidth', () => {
        if (this.aiResizePointer === null)
          this.aiDockWidth = WorkspaceState.getInstance().aiDockWidth
      })
    )
    this.panelOrientation = this.settingsStore.get('appearance.panelOrientation', 'vertical') as
      'horizontal' | 'vertical'
    this.aiEnabled = this.settingsStore.get('ai.enabled', false) ?? false
    // Subscribed rather than read once: turning AI on in Settings should make
    // the dock reachable immediately, not after a restart.
    this.settingsUnsubs.push(
      this.settingsStore.subscribe('ai', (v) => {
        this.aiEnabled = Boolean((v as { enabled?: boolean } | undefined)?.enabled)
        if (!this.aiEnabled) this.fileState.toggleAiDock(false)
      })
    )
    this.settingsUnsubs.push(
      this.settingsStore.subscribe('appearance.panelOrientation', (v) => {
        this.panelOrientation = (v as 'horizontal' | 'vertical') ?? 'horizontal'
      })
    )
    this.settingsUnsubs.push(
      this.settingsStore.subscribe('editor.showFilePath', (v) => {
        this.showFilePath = (v as boolean) ?? true
      })
    )
    for (const key of Editor.CHROME_SETTINGS) {
      this.settingsUnsubs.push(this.settingsStore.subscribe(key, () => this.syncChrome()))
    }
    // Subscriptions only fire on a change, so seed the current value here or a
    // saved "hidden" would not apply until the user toggled it twice.
    this.showFilePath = this.settingsStore.get<boolean>('editor.showFilePath', true)
    const current = this.fileState.getState()
    this.content = current.content
    this.filePath = current.path
    this.viewMode = current.viewMode === 'wysiwyg' ? 'live' : current.viewMode
    this.splitActive = current.splitActive
    this.splitSurface = current.splitSurface
    this.aiDockOpen = current.aiDockOpen
    this.secondaryDoc = current.secondaryDoc
    this.unsubscribe = this.fileState.subscribe((s) => {
      this.syncAiDockClose(s.aiDockOpen)
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
      this.aiDockOpen = s.aiDockOpen
      if (wasSplitActive && !s.splitActive) this.splitLeaving = true
      else if (s.splitActive) this.splitLeaving = false
      if (!this.splitLeaving) {
        this.splitSurface = s.splitSurface
        this.secondaryDoc = s.secondaryDoc
      }

      this.filePath = newPath

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
            changes: documentChanges(this.editorView.state.doc.toString(), s.content)
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
            changes: documentChanges(
              this.secondaryEditorView.state.doc.toString(),
              s.secondaryDoc.content
            )
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

  /**
   * Whether the split pane shows a document editor. The lifecycle code and the
   * template must agree on this exactly, so both read this one getter rather
   * than each spelling out the condition.
   */
  private get mountsSecondaryView(): boolean {
    return shouldMountSecondaryView({
      splitActive: this.splitActive || this.splitLeaving,
      secondaryDoc: this.secondaryDoc,
      splitSurface: this.splitSurface
    })
  }

  disconnectedCallback(): void {
    this.aiResizeObserver?.disconnect()
    this.aiResizeObserver = null
    this.aiResizePointer = null
    for (const unsub of this.busUnsubs) unsub()
    this.busUnsubs = []
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer)
    if (this.aiCloseTimer !== null) window.clearTimeout(this.aiCloseTimer)
    this.aiCloseTimer = null
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

  private finishSplitExit = (): void => {
    if (this.splitActive) return
    this.splitLeaving = false
    const current = this.fileState.getState()
    this.splitSurface = current.splitSurface
    this.secondaryDoc = current.secondaryDoc
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
      renameTitleFacet.of((name) => void this.fileState.renameFile(name, isSecondary)),
      showInlineTitleFacet.of(mode !== 'source'),
      inlineTitle(),
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
    const view = secondary ? this.secondaryEditorView : this.editorView
    const range = view?.state.selection.main
    const selection =
      view && range && !range.empty
        ? {
            text: view.state.sliceDoc(range.from, range.to),
            from: range.from,
            to: range.to,
            path: (secondary ? this.secondaryDoc?.path : this.filePath) ?? undefined
          }
        : null
    this.textMenu = { x: e.clientX, y: e.clientY, secondary, selection }
  }

  /**
   * Explain and Summarize ask the floating bar, not the panel.
   *
   * Both were panel-only actions, so a one-word question cost the width of a
   * docked panel and buried the document. The bar captures the selection itself,
   * so all this has to say is which question to ask.
   */
  private handleAiSelectionAction = (e: CustomEvent<AiSelectionAction>): void => {
    if (!this.aiEnabled || !e.detail.text.trim()) return
    const secondary = this.textMenu?.selection?.path === this.secondaryDoc?.path
    const view = secondary ? this.secondaryEditorView : this.editorView
    if (!view) return
    this.openAiBar({
      prompt:
        e.detail.intent === 'explain'
          ? 'Explain only the highlighted text.'
          : 'Summarize only the highlighted text.',
      view,
      path: e.detail.path ?? null
    })
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
   * Focus the inline title for Rename.
   *
   * The title is a widget inside CodeMirror's shadow DOM, so the menu in the
   * document header cannot reach it directly and asks here instead.
   */
  private handleFocusInlineTitle = (detail: { pane?: 'primary' | 'secondary' }): void => {
    const wrapper =
      detail.pane === 'secondary'
        ? this.shadowRoot?.querySelector('#secondary-cm-wrapper')
        : this.shadowRoot?.querySelector('#primary-cm-wrapper')
    const input = wrapper?.querySelector<HTMLInputElement>('.cm-inline-title')
    if (!input) return
    input.focus()
    input.select()
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

  /**
   * Open the assistant with the editor's exact selection as context.
   *
   * The floating bar, not the panel: this is a question about a few words, and
   * the bar answers it without taking half the window. The panel is one step
   * further, through Open full chat.
   */
  openSelectionMenu(): void {
    const view = this.secondaryEditorView?.hasFocus ? this.secondaryEditorView : this.editorView
    if (!view || !this.aiEnabled) return
    this.openAiBar({
      prompt: 'Ask about your selection.',
      view,
      path: this.secondaryEditorView?.hasFocus ? (this.secondaryDoc?.path ?? null) : this.filePath
    })
  }

  /**
   * Open the floating bar for a selection action.
   *
   * The captured context travels with the request rather than being re-read from
   * the focused pane. The bar is going to take focus, and a right-click in the
   * split pane does not move CodeMirror's focus, so reading the selection after
   * the fact returned the primary pane's text: Explain on a phrase in the
   * secondary note asked about a word in the primary one.
   */
  openAiBar(action: { prompt: string; view: EditorView; path: string | null }): void {
    this.dispatchEvent(
      new CustomEvent<{ prompt: string; context: QuickAiContext }>('open-ai-bar', {
        detail: { prompt: action.prompt, context: this.contextFor(action.view, action.path) },
        bubbles: true,
        composed: true
      })
    )
  }

  /** Frozen text and selection for one pane, as the bar captures it. */
  private contextFor(view: EditorView, path: string | null): QuickAiContext {
    const content = view.state.doc.toString()
    const selected = view.state.selection.main
    if (selected.empty || selected.to - selected.from > 20_000)
      return { path, content, selection: null }
    return {
      path,
      content,
      selection: {
        from: selected.from,
        to: selected.to,
        text: view.state.sliceDoc(selected.from, selected.to)
      }
    }
  }

  /**
   * Pick a surface from the tab strip.
   *
   * Document is a tab like the others, but with nothing open it has no content
   * to show. Rather than hide it and reflow the strip every time a second
   * document closes, it opens the picker, which is what the launcher row it
   * replaces used to do.
   */
  private selectSurface = async (surface: SplitSurface): Promise<void> => {
    if (surface === 'file') {
      await showSecondaryDocument(this.fileState)
      return
    }
    this.fileState.setSplitSurface(surface)
  }

  private renderSurfaceTabs(): unknown {
    const labels: Record<SplitSurface, string> = {
      files: 'Files',
      backlinks: 'Backlinks',
      file: 'Document',
      preview: 'Preview'
    }
    const order: SplitSurface[] = ['files', 'backlinks', 'file', 'preview']
    // The reading toggle and the document menu act on the second document, so
    // they belong on the Document tab only. They ride in this row rather than
    // in a header of their own, which is what left the pane with two stacked
    // bars and two close buttons for one surface.
    const docControls = this.mountsSecondaryView && this.secondaryDoc && !this.secondaryDoc.isDiff
    return html`
      <div class="surface-tabs" role="tablist" aria-label="Pane surfaces">
        ${order.map(
          (id) => html`
            <button
              class="surface-tab"
              role="tab"
              aria-selected=${this.splitSurface === id ? 'true' : 'false'}
              @click=${() => void this.selectSurface(id)}
            >
              ${labels[id]}
            </button>
          `
        )}
        <div class="surface-tabs-spacer"></div>
        ${docControls ? html`<writemd-doc-bar secondary bare></writemd-doc-bar>` : ''}
        <div
          class="icon-action"
          role="button"
          tabindex="0"
          aria-label="Close split pane"
          title="Close split pane"
          @keydown=${this.handleIconActionKey}
          @click=${() => this.fileState.toggleSplitView(false)}
        >
          ${icon('x')}
        </div>
      </div>
    `
  }

  /** Enter/Space on an icon-action div, so it is reachable by keyboard. */
  private handleIconActionKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).click()
  }

  private get aiGeometry(): ReturnType<typeof aiDockGeometry> {
    return aiDockGeometry(
      this.aiAvailable || this.getBoundingClientRect().width || 1000,
      this.aiDockWidth
    )
  }

  private beginAiResize = (event: PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    this.aiResizePointer = event.pointerId
    this.aiResizeStart = event.clientX
    this.aiResizeInitial = this.aiGeometry.width
    this.aiResizePreference = this.aiDockWidth
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  private moveAiResize = (event: PointerEvent): void => {
    if (event.pointerId !== this.aiResizePointer) return
    const geometry = this.aiGeometry
    this.aiDockWidth = Math.max(
      geometry.min,
      Math.min(geometry.max, this.aiResizeInitial + this.aiResizeStart - event.clientX)
    )
  }

  private finishAiResize = (event: PointerEvent): void => {
    if (event.pointerId !== this.aiResizePointer) return
    if (event.type === 'pointerup') this.moveAiResize(event)
    this.aiResizePointer = null
    if (event.type !== 'pointerup') this.aiDockWidth = this.aiResizePreference
    else WorkspaceState.getInstance().resizeAiDock(this.aiDockWidth)
  }

  private keyAiResize = (event: KeyboardEvent): void => {
    const geometry = this.aiGeometry
    let width: number
    if (event.key === 'ArrowLeft') width = geometry.width + 16
    else if (event.key === 'ArrowRight') width = geometry.width - 16
    else if (event.key === 'Home') width = geometry.min
    else if (event.key === 'End') width = geometry.max
    else return
    event.preventDefault()
    this.aiDockWidth = Math.max(geometry.min, Math.min(geometry.max, width))
    WorkspaceState.getInstance().resizeAiDock(this.aiDockWidth)
  }

  /**
   * Hold the panel mounted for its exit, then let it go.
   *
   * Reduced motion resolves on the next frame rather than after the animation's
   * length, so a user who has asked for no motion is not made to wait out a
   * transition they cannot see.
   */
  private syncAiDockClose(open: boolean): void {
    if (this.aiCloseTimer !== null) {
      clearTimeout(this.aiCloseTimer)
      this.aiCloseTimer = null
    }
    if (open) {
      this.aiClosing = false
      return
    }
    if (!this.aiDockOpen) return
    this.aiClosing = true
    const done = (): void => {
      this.aiCloseTimer = null
      if (!this.aiDockOpen) this.aiClosing = false
    }
    this.aiCloseTimer = reducedMotionNow()
      ? window.setTimeout(done, 0)
      : window.setTimeout(done, DURATION.fast)
  }

  private renderAiDock(): unknown {
    if ((!this.aiDockOpen && !this.aiClosing) || !this.aiEnabled) return null
    const geometry = this.aiGeometry
    /*
     * One class for the direction, set once per open and once per close. Putting
     * it on the element means the browser owns the timing and the reduced-motion
     * guard is one rule rather than a branch in every caller.
     */
    const transition = this.aiClosing ? 'leaving' : 'entering'
    return html`<div class="ai-column ${transition}" style=${`--ai-dock-width:${geometry.width}px`}>
      <div
        class="ai-divider"
        role="separator"
        tabindex="0"
        aria-label="Resize AI assistant"
        aria-orientation="vertical"
        aria-valuemin=${Math.round(geometry.min)}
        aria-valuemax=${Math.round(geometry.max)}
        aria-valuenow=${Math.round(geometry.width)}
        @pointerdown=${this.beginAiResize}
        @pointermove=${this.moveAiResize}
        @pointerup=${this.finishAiResize}
        @pointercancel=${this.finishAiResize}
        @lostpointercapture=${this.finishAiResize}
        @keydown=${this.keyAiResize}
      >
        <span class="resize-handle" aria-hidden="true"><i></i><i></i><i></i></span>
      </div>
      <writemd-ai-dock
        class="ai-dock"
        @ai-close=${() => this.fileState.toggleAiDock(false)}
      ></writemd-ai-dock>
    </div>`
  }

  render(): unknown {
    if (!this.filePath && !this.content) {
      return html`
        <div class="workspace">
          <writemd-panel empty>
            <div class="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <p>No document open</p>
            </div> </writemd-panel
          >${this.renderAiDock()}
        </div>
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
          .active=${this.splitActive}
          .surface=${this.splitSurface}
          @workspace-split-closed=${this.finishSplitExit}
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

              <!-- Footer: path, counts and mode control, in flow beneath the editor -->
              <writemd-info-pill
                .content=${this.content}
                .mode=${this.viewMode}
                .path=${this.showFilePath ? displayPath(this.filePath) : ''}
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
                    ?inert=${this.splitLeaving}
                    .empty=${
                      this.mountsSecondaryView && secondaryDoc
                        ? !secondaryDoc.content.trim()
                        : false
                    }
                  >
                    ${this.renderSurfaceTabs()}
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
                                : ''
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
                                .path=${this.showFilePath ? displayPath(secondaryDoc.path) : ''}
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
                          ? html`<writemd-vault-explorer></writemd-vault-explorer>`
                          : this.splitSurface === 'preview'
                            ? html`<writemd-preview-panel
                                .markdown=${this.content}
                                .docPath=${this.filePath}
                              ></writemd-preview-panel>`
                            : html`<writemd-backlinks-panel
                                .currentPath=${this.filePath}
                              ></writemd-backlinks-panel>`
                    }
                  </writemd-panel>
                `
              : ''
          }
        </writemd-workspace>
        ${this.renderAiDock()}
        ${
          this.textMenu && (this.textMenu.secondary ? this.secondaryEditorView : this.editorView)
            ? html`<writemd-text-menu
                .x=${this.textMenu.x}
                .y=${this.textMenu.y}
                .flip=${this.textMenu.x > window.innerWidth - 480}
                .view=${this.textMenu.secondary ? this.secondaryEditorView : this.editorView}
                .aiEnabled=${this.aiEnabled}
                .selection=${this.textMenu.selection}
                @ai-selection-action=${this.handleAiSelectionAction}
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
