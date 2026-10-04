import { html, css, LitElement, unsafeCSS } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import katexCss from 'katex/dist/katex.min.css?inline'
import { findNext, findPrevious, getSearchQuery } from '@codemirror/search'
import { scrollbarStyles } from './scrollbars'
import { SettingsStore } from '../state/settings'
import { type AiMessage } from './AiPanel'
import type { AttachedFile, ChatMessage, ChatSessionSummary } from '../../../shared/electron-api'
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

/**
 * How much of the open file rides along with an AI question.
 *
 * The full document used to be embedded in every request. That is a 6 MB string
 * copy per question on a large note, and a payload no provider accepts, so the
 * context is capped and the model is told the file was cut rather than left to
 * assume it saw all of it. About 200 000 characters, roughly 50k tokens.
 */
export const AI_DOC_CONTEXT_LIMIT = 200_000

export function documentContextFor(content: string): { text: string; note: string } {
  if (content.length <= AI_DOC_CONTEXT_LIMIT) return { text: content, note: '' }
  let cut = AI_DOC_CONTEXT_LIMIT
  // Never end on half a surrogate pair: a lone surrogate in a request is
  // invalid UTF-16 and some providers reject the whole payload over it.
  const next = content.charCodeAt(cut)
  if (next >= 0xdc00 && next <= 0xdfff) cut -= 1
  const kept = content.slice(0, cut)
  const totalMb = Math.round(content.length / (1024 * 1024))
  return {
    text: kept,
    note: `Only the first ${Math.round(cut / 1024)} KB of this ${totalMb} MB file are shown below.\n\n`
  }
}

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
        animation: notice-in 200ms cubic-bezier(0.22, 1, 0.36, 1);
      }

      @keyframes notice-in {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-6px);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .notice {
          animation: none;
        }
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
        transition: flex 200ms cubic-bezier(0.22, 1, 0.36, 1);
      }

      @media (prefers-reduced-motion: reduce) {
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

      .pane-in {
        animation: pane-in 180ms cubic-bezier(0.22, 1, 0.36, 1);
      }

      @keyframes pane-in {
        from {
          opacity: 0;
          transform: translateX(24px) scale(0.99);
        }
      }

      @media (prefers-reduced-motion: reduce) {
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
        animation: surface-in 160ms ease-out;
      }

      @keyframes surface-in {
        from {
          opacity: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        writemd-ai-panel,
        writemd-backlinks-panel,
        writemd-vault-explorer,
        writemd-surface-launcher,
        writemd-panel .sub-header + * {
          animation: none;
        }
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
        animation: ai-history-in 140ms cubic-bezier(0.22, 1, 0.36, 1);
      }

      @keyframes ai-history-in {
        from {
          opacity: 0;
          transform: translateY(-4px) scale(0.97);
        }
      }

      @media (prefers-reduced-motion: reduce) {
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
  /** Persisted chat for the open document. Null until one exists on disk. */
  @state() private aiSessionId: string | null = null
  @state() private aiSessions: ChatSessionSummary[] = []
  @state() private aiHistoryOpen = false
  /** Index of the reply currently streaming in, or -1 when none is. */
  private aiStreamIndex = -1

  /** Files attached to the next prompt, read by the main process. */
  @state() private aiAttachments: AttachedFile[] = []
  /** True while a chosen attachment is being read across the bridge. */
  @state() private aiAttaching = false
  /** Models the provider reports for the configured key. */
  @state() private aiModels: string[] = []
  @state() private aiModelsLoading = false

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
  private async refreshAiModels(): Promise<void> {
    const electron = api()
    if (!electron?.net) return
    this.aiModelsLoading = true
    const configuredModel = this.aiModel
    try {
      const provider = this.settingsStore?.get('ai.provider', 'OpenAI') ?? 'OpenAI'
      const models = await electron.net.fetchModels(provider, '')
      // A selected model stays usable even if a provider omits it from its
      // discoverable list. The chat request is the authority on whether it is
      // actually available to this key.
      this.aiModels = configuredModel
        ? [configuredModel, ...models.filter((model) => model !== configuredModel)]
        : models
    } catch (e) {
      // A failed discovery request must not make an already selected model look
      // unavailable. Sending remains possible and surfaces the provider's real
      // error if the key, model, or network is the underlying problem.
      console.error('Failed to fetch AI models:', e)
      this.aiModels = configuredModel ? [configuredModel] : []
    } finally {
      this.aiModelsLoading = false
    }
  }

  /** Switch model from the composer chip. Persisted, so it survives a restart. */
  private handleAiModelChange = (e: Event): void => {
    const model = (e as CustomEvent<{ model: string }>).detail.model
    if (!model || model === this.aiModel) return
    void this.settingsStore?.set('ai.model', model)
  }

  /**
   * Attach files to the next prompt.
   *
   * The dialog runs here rather than in the panel because it is what registers
   * each chosen path with the main process, and the reads have to follow that
   * registration. One failing file is reported and the rest still attach: a
   * user picking six screenshots does not want all six lost to one bad path.
   */
  private handleAiAttachRequest = async (): Promise<void> => {
    const electron = api()
    if (!electron?.dialog || !electron.file?.readAttachment) return
    let picked: Electron.OpenDialogReturnValue
    try {
      picked = await electron.dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Notes and text',
            extensions: ['md', 'markdown', 'txt', 'csv', 'json', 'yaml', 'yml']
          },
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
    } catch (e) {
      console.error('Failed to open attach dialog:', e)
      return
    }
    if (picked.canceled || picked.filePaths.length === 0) return

    this.aiAttaching = true
    const added: AttachedFile[] = []
    for (const path of picked.filePaths) {
      try {
        added.push(await electron.file.readAttachment(path))
      } catch (e) {
        // Surfaced as an assistant line rather than a dialog: the user is
        // looking at the transcript, and the reason belongs next to the prompt
        // it was meant for.
        const reason = e instanceof Error ? e.message : String(e)
        this.aiMessages = [
          ...this.aiMessages,
          { role: 'assistant', content: `Could not attach that file: ${reason}` }
        ]
      }
    }
    this.aiAttachments = [...this.aiAttachments, ...added]
    this.aiAttaching = false
  }

  /**
   * Files dropped on the composer: register the paths (the dialog would have),
   * then read them through the same guard-checked bridge the picker uses.
   */
  private handleAiAttachFiles = async (e: Event): Promise<void> => {
    const electron = api()
    if (!electron?.file?.readAttachment || !electron.file.registerDroppedPaths) return
    const { paths } = (e as CustomEvent<{ paths: string[] }>).detail
    if (!paths?.length) return
    try {
      await electron.file.registerDroppedPaths(paths)
    } catch (err) {
      console.error('Failed to register dropped paths:', err)
    }
    this.aiAttaching = true
    const added: AttachedFile[] = []
    for (const path of paths) {
      try {
        added.push(await electron.file.readAttachment(path))
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        this.aiMessages = [
          ...this.aiMessages,
          { role: 'assistant', content: `Could not attach that file: ${reason}` }
        ]
      }
    }
    this.aiAttachments = [...this.aiAttachments, ...added]
    this.aiAttaching = false
  }

  private handleAiAttachRemove = (e: Event): void => {
    const path = (e as CustomEvent<{ path: string }>).detail.path
    this.aiAttachments = this.aiAttachments.filter((f) => f.path !== path)
  }

  /** Stop the reply in flight. The partial answer is kept by the main process. */
  private handleAiCancel = (): void => {
    void api()?.net?.cancelChat?.()
  }

  private handleAiClear = (): void => {
    this.aiMessages = []
    // Clearing empties the transcript; starting a new chat is what mints a new
    // session, so the current id is kept.
    void this.persistAiSession()
  }

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
    this.panelOrientation = this.settingsStore.get('appearance.panelOrientation', 'horizontal') as
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

      // Chat is per document, so switching tabs swaps the transcript. The
      // initial document is handled at setup, above; this is the change case.
      if (pathChanged) {
        void this.loadAiSession()
      }

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
        s.content !== this.viewContent
      ) {
        this.viewContent = s.content
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
        s.secondaryDoc.content !== this.secondaryViewContent
      ) {
        this.secondaryViewContent = s.secondaryDoc.content
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
    this.isAiConfigured = provider === 'Ollama' || provider === 'OpenCode' || keySet
  }

  /** Toggle keyless web-search grounding from the composer globe button. */
  private handleAiWebSearchToggle = (): void => {
    if (!this.settingsStore) return
    const current = this.settingsStore.get<boolean>('ai.webSearchEnabled', false)
    void this.settingsStore.set('ai.webSearchEnabled', !current)
  }

  /**
   * Persist the live session. Called after every exchange rather than on a
   * timer, so a quit mid-conversation does not lose the last reply.
   */
  private async persistAiSession(): Promise<void> {
    const chat = api()?.chat
    if (!chat || !this.aiSessionId || this.aiMessages.length === 0) return
    try {
      await chat.saveSession({
        id: this.aiSessionId,
        // Main derives the title from the first user message; empty is fine.
        title: '',
        docPath: this.filePath,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        // `streaming` is a live-render flag, not part of the conversation. The
        // settle handler persists while a reply is still arriving, and a session
        // file with it would replay the reveal animation on load.
        messages: this.aiMessages.map((m) => ({
          role: m.role,
          content: m.content,
          filePath: m.filePath,
          elapsed: m.elapsed,
          // Names only. The bytes were never in `aiMessages` to begin with,
          // which is what keeps a session with screenshots from being enormous.
          attachments: m.attachments
        }))
      })
    } catch (e) {
      console.error('Failed to save chat session:', e)
    }
  }

  /** Newest session for this document, so reopening a file restores its chat. */
  private async loadAiSession(): Promise<void> {
    const chat = api()?.chat
    if (!chat) return
    try {
      const existing = await chat.listSessions(this.filePath)
      this.aiSessions = existing
      if (existing.length === 0) {
        this.aiSessionId = null
        this.aiMessages = []
        return
      }
      const full = await chat.loadSession(existing[0].id)
      this.aiSessionId = existing[0].id
      this.aiMessages = full ? (full.messages as AiMessage[]) : []
    } catch (e) {
      console.error('Failed to load chat session:', e)
    }
  }

  private async refreshAiSessions(): Promise<void> {
    const chat = api()?.chat
    if (!chat) return
    try {
      this.aiSessions = await chat.listSessions(this.filePath)
    } catch (e) {
      console.error('Failed to list chat sessions:', e)
    }
  }

  private handleAiNewSession = (): void => {
    const chat = api()?.chat
    if (!chat) return
    this.aiHistoryOpen = false
    void (async () => {
      try {
        const session = await chat.createSession(this.filePath)
        this.aiSessionId = session.id
        this.aiMessages = []
        await this.refreshAiSessions()
      } catch (e) {
        console.error('Failed to create chat session:', e)
      }
    })()
  }

  private handleAiSelectSession = (id: string): void => {
    this.aiHistoryOpen = false
    const chat = api()?.chat
    if (!id || !chat) return
    void (async () => {
      try {
        const session = await chat.loadSession(id)
        if (!session) return
        this.aiSessionId = session.id
        this.aiMessages = session.messages as AiMessage[]
      } catch (err) {
        console.error('Failed to switch chat session:', err)
      }
    })()
  }

  private async handleAiSubmit(input: string, attachments: AttachedFile[] = []): Promise<void> {
    // An attachment with no words is a real prompt, so the emptiness check is
    // on both together rather than on the text alone.
    if ((!input.trim() && attachments.length === 0) || this.aiIsLoading || !this.settingsStore) {
      return
    }

    const currentPath = this.filePath || 'Untitled'
    // The transcript keeps the names, not the payloads: a session file holding
    // three screenshots' worth of base64 would be megabytes of disk per chat.
    this.aiMessages = [
      ...this.aiMessages,
      {
        role: 'user',
        content: input,
        filePath: currentPath,
        attachments: attachments.map((f) => ({ name: f.name, kind: f.kind, size: f.size }))
      }
    ]
    // Cleared here, not in the panel: this is the moment the files stop being
    // needed and the owner holds them.
    this.aiAttachments = []
    this.aiIsLoading = true

    const electron = api()
    if (!electron) {
      this.aiIsLoading = false
      return
    }

    // The first message in a document creates the session, so an untouched
    // document leaves no empty transcript behind.
    if (electron.chat && !this.aiSessionId) {
      try {
        const session = await electron.chat.createSession(this.filePath)
        this.aiSessionId = session.id
      } catch (e) {
        console.error('Failed to create chat session:', e)
      }
    }

    try {
      const provider = this.settingsStore.get('ai.provider', 'OpenAI')
      const model = this.settingsStore.get('ai.model', '')

      // Ground the answer when web search is on: run a keyless search for the
      // user's question and append the cited results to the file context.
      // Silent by design: this used to post a `thinking` transcript entry,
      // which rendered as a second "Thought for 0.0s" line under every prompt.
      let searchContext = ''
      const webSearchOn = this.settingsStore.get('ai.webSearchEnabled', false)
      if (webSearchOn && input.trim()) {
        try {
          searchContext = (await electron.web.searchContext(input.trim())) || ''
        } catch (e) {
          console.error('Web search failed:', e)
        }
      }

      // Custom instructions from Settings → AI Assistant, with live file context appended
      const customPrompt =
        this.settingsStore.get('ai.systemPrompt', DEFAULT_AI_SYSTEM_PROMPT) ||
        DEFAULT_AI_SYSTEM_PROMPT
      // The whole file used to go out with every question. A 6 MB note meant a
      // 6 MB payload on the renderer's main thread and a request every provider
      // rejects for size, so the context is capped and says so. Roughly 200k
      // characters, which is about 50k tokens.
      const docContext = documentContextFor(this.content)
      const systemPrompt = `${customPrompt}

The user is currently editing the file: ${currentPath}
${docContext.note}Here is the current content of the active file:

\`\`\`markdown
${docContext.text}
\`\`\`

If the user asks questions about their file, use the above content to answer.
${searchContext}`

      // We bypass the ipc.ts system prompt handling completely to avoid needing an app restart.
      // We inject the system context as a 'user' message at the very beginning of the payload.
      const payloadMessages: ChatMessage[] = [
        { role: 'user', content: systemPrompt },
        {
          role: 'assistant',
          content: 'Understood.'
        },
        // `thinking` lines are a local record of elapsed time, not conversation,
        // so they must not reach the provider as messages. The predicate is
        // needed because filter() alone does not narrow the union.
        ...this.aiMessages
          .filter((m): m is AiMessage & { role: 'user' | 'assistant' } => m.role !== 'thinking')
          .map((m): ChatMessage => {
            if (m.role === 'user') {
              return {
                role: m.role,
                content: `[Context: The user is currently in file: ${m.filePath}]\n\n${m.content}`
              }
            }
            return { role: m.role, content: m.content }
          })
      ]

      /*
       * Attached files ride on the message that carried them, not on a new one.
       * Older attachments are not re-sent: their bytes are gone by the time a
       * later question is asked, and a stale screenshot would silently answer a
       * question it had nothing to do with.
       */
      const textFiles = attachments.filter((f) => f.kind === 'text' && f.text)
      if (textFiles.length > 0) {
        payloadMessages[payloadMessages.length - 1] = {
          ...payloadMessages[payloadMessages.length - 1],
          content: [
            payloadMessages[payloadMessages.length - 1].content,
            ...textFiles.map((f) => `\n\n[Attached file: ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``)
          ].join('')
        }
      }
      const images = attachments.filter((f) => f.kind === 'image' && f.data)
      if (images.length > 0) {
        payloadMessages[payloadMessages.length - 1] = {
          ...payloadMessages[payloadMessages.length - 1],
          images: images.map((f) => ({
            data: f.data as string,
            mediaType: f.mediaType ?? 'image/png',
            name: f.name
          }))
        }
      }

      // Send chat request
      // An empty key tells the main process to use the stored one.
      // The reply streams in token by token: `onDelta` appends each chunk to a
      // placeholder message, which is what the reveal animation follows.
      this.aiStreamIndex = -1
      const response = await electron.net.chatStream(
        provider,
        model,
        '',
        payloadMessages,
        (delta: string) => this.appendAiDelta(delta),
        ''
      )

      const replaceRegex = /```writemd-replace\s*\n([\s\S]*?)```/
      const match = response.match(replaceRegex)

      if (match) {
        const applied = await this.applyAiReplacement(match[1], currentPath)
        // Remove the block from the chat response so it doesn't clutter the UI
        const cleaned = response.replace(replaceRegex, '').trim()
        const note = applied
          ? cleaned || 'I have updated the document.'
          : 'I left your document alone: you switched tabs before the reply arrived. Ask again with that file active.'
        if (!this.settleAiStream(note)) {
          this.aiMessages = [...this.aiMessages, { role: 'assistant', content: note }]
        }
      } else if (!this.settleAiStream(response)) {
        // No delta ever arrived, so there is no placeholder to fill.
        this.aiMessages = [...this.aiMessages, { role: 'assistant', content: response }]
      }
      await this.persistAiSession()
      await this.refreshAiSessions()
    } catch (e) {
      const partial = this.aiStreamIndex >= 0 ? this.aiMessages[this.aiStreamIndex]?.content : ''
      // Whatever arrived before the failure is real output, so it is kept and
      // the error is reported underneath it rather than replacing it.
      if (partial) this.settleAiStream(partial)
      this.aiMessages = [
        ...this.aiMessages,
        { role: 'assistant', content: `Error: ${describeAiError(e)}` }
      ]
      // The error is part of the transcript the user is looking at, so persist
      // it too rather than silently dropping it from the stored session.
      await this.persistAiSession()
    } finally {
      this.aiIsLoading = false
    }
  }

  /**
   * Add one streamed delta to the reply, creating the placeholder on the first
   * one so an empty bubble never appears.
   */
  private appendAiDelta(delta: string): void {
    const i = this.aiStreamIndex
    if (i === -1 || !this.aiMessages[i]) {
      this.aiMessages = [...this.aiMessages, { role: 'assistant', content: delta, streaming: true }]
      this.aiStreamIndex = this.aiMessages.length - 1
      return
    }
    const next = [...this.aiMessages]
    next[i] = { ...next[i], content: next[i].content + delta }
    this.aiMessages = next
  }

  /**
   * Replace the streaming placeholder with its finished text and stop the reveal.
   * Returns false when no reply ever started, so the caller can append instead.
   */
  private settleAiStream(content: string): boolean {
    const i = this.aiStreamIndex
    this.aiStreamIndex = -1
    if (i === -1 || !this.aiMessages[i]) return false
    const next = [...this.aiMessages]
    next[i] = { ...next[i], content, streaming: false }
    this.aiMessages = next
    return true
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
  private handleThoughtSettle = (e: Event): void => {
    const { tenths } = (e as CustomEvent<{ tenths: number }>).detail ?? { tenths: 0 }
    this.aiMessages = [
      ...this.aiMessages,
      { role: 'thinking', content: 'Thinking', elapsed: tenths }
    ]
    void this.persistAiSession()
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
    document.removeEventListener('pointerdown', this.onAiHistoryPointerDown, true)
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

    // Opening the split snaps the left pane to its new width. `flex` shorthand
    // does not transition, so drive it with WAAPI against the final basis.
    if (
      changedProperties.has('splitActive') &&
      changedProperties.get('splitActive') === false &&
      this.splitActive &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      const panels = this.shadowRoot?.querySelectorAll<HTMLElement>('writemd-panel.pane')
      const left = panels?.[0]
      if (left) {
        const finalWidth = left.getBoundingClientRect().width
        const containerWidth = left.parentElement?.getBoundingClientRect().width ?? finalWidth * 2
        left.animate([{ flexBasis: `${containerWidth}px` }, { flexBasis: `${finalWidth}px` }], {
          duration: 320,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
        })
      }
      const right = panels?.[1]
      if (right) {
        right.animate(
          [
            { opacity: 0, transform: 'translateX(24px)' },
            { opacity: 1, transform: 'translateX(0)' }
          ],
          { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        )
      }
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
                  <writemd-panel class="pane pane-in">
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
