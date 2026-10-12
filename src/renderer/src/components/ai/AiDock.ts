import { css, html, LitElement } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { api } from '../../api'
import { FileState } from '../../state/file-state'
import { createDocumentMarkdownIt } from '../../utils/markdown'
import { displayTitle, normalizePathExact, shortPath } from '../../utils/links'
import { scrollbarStyles } from '../scrollbars'
import { chromeIcon } from '../../design/icons'
import { TurnController, type TurnMessage, type TurnState } from './turn-controller'
import type { AiSendInput, ChangeView, SessionView, SkippedView, UndoOutcomeView } from './types'
import type { ComposerSendDetail } from './Composer'
import './Composer'

/**
 * How often the streaming message is re-parsed while text is arriving.
 *
 * A turn emits deltas as fast as the provider sends them, which is regularly
 * more than once a frame. Parsing Markdown on each one rebuilds the whole
 * message several times per token, and that is exactly the stutter a streaming
 * panel is not supposed to have. Waiting a beat collapses a burst of tokens
 * into one render and still reads as live.
 */
const STREAM_REPARSE_MS = 160

/** Characters of a document selection kept as context for the next turn. */
const MAX_SELECTION_CHARS = 20_000

/** Files named with `@` in one prompt, read and sent as reference material. */
const MAX_REFERENCES = 6

/** Characters of reference text. Past this the model is past what it can use. */
const MAX_REFERENCE_CHARS = 120_000

interface UndoNote {
  text: string
  reverted: boolean
}

/**
 * Undo is per file and refusal is a normal outcome, so every one of them gets a
 * sentence. A button that vanishes after a click, or a refusal with no
 * explanation, leaves the user unable to tell whether their note came back.
 */
function undoNote(outcome: UndoOutcomeView | undefined): UndoNote {
  switch (outcome?.status) {
    case 'restored':
      return { text: 'Reverted.', reverted: true }
    case 'gone':
      return { text: 'File removed.', reverted: true }
    case 'already-reverted':
      return { text: 'Already reverted.', reverted: true }
    case 'changed-since':
      return { text: 'Changed since, so it was left as it is.', reverted: false }
    default:
      return { text: 'Could not revert this one.', reverted: false }
  }
}

function liveTitle(messages: readonly TurnMessage[]): string {
  const first = messages.find((message) => message.role === 'user')
  const text = (first?.text ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return 'New chat'
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

/**
 * The assistant panel: header, context, transcript, change list, composer.
 *
 * Three things in here are load-bearing rather than styling.
 *
 * - The transcript is parsed as Markdown, but only on a timer while a turn
 *   streams and immediately when it settles. See `STREAM_REPARSE_MS`.
 *
 * - The change list is the safety surface for a feature that writes to the
 *   user's disk without asking. Each row is one file, whether it was created or
 *   modified, with its own Undo, and a file the applier refused is shown rather
 *   than dropped: "it wanted to change three notes and two were skipped" has to
 *   be something the user can see.
 *
 * - Context is read at the moment it is true. The document comes from
 *   FileState and the selection from the DOM at send time, so a turn never
 *   sends the note that happened to be open when the panel was.
 */
@customElement('writemd-ai-dock')
export class AiDock extends LitElement {
  @state() private messages: TurnMessage[] = []
  @state() private busy = false
  @state() private error: string | null = null
  @state() private changes: ChangeView[] = []
  @state() private skipped: SkippedView[] = []
  @state() private proposal: TurnState['proposal'] = null
  @state() private sessions: SessionView[] = []
  @state() private sessionId = ''
  @state() private selection = ''
  @state() private docPath: string | null = null
  @state() private undoNotes: Record<string, UndoNote> = {}

  @query('.thread') private thread!: HTMLElement | null

  /**
   * Public so a test can drive a real turn. The tests emit events carrying the
   * request id this generated, which is the only way to exercise the
   * stale-stream guard without a socket.
   */
  readonly turns = new TurnController()

  private md = createDocumentMarkdownIt()
  private fileState = FileState.getInstance()
  private unsubs: Array<() => void> = []
  /** Parsed Markdown per message, kept against the text it was parsed from. */
  private html = new Map<string, { source: string; html: string }>()
  private stale = new Set<string>()
  private streamTimer: ReturnType<typeof setTimeout> | null = null
  private scrollTimer: ReturnType<typeof setTimeout> | null = null

  connectedCallback(): void {
    super.connectedCallback()
    this.unsubs.push(this.turns.subscribe((state) => this.applyState(state)))
    this.unsubs.push(
      this.fileState.subscribe(() => {
        const path = this.fileState.getState().path
        if (path !== this.docPath) this.docPath = path
      })
    )
    this.sessionId = this.turns.sessionId
    this.docPath = this.fileState.getState().path
    // The editor is a CodeMirror view, which is why the selection is read from
    // the document rather than being pushed here: there is no event to take it
    // from, and it is only meaningful at the moment of sending.
    document.addEventListener('selectionchange', this.onSelectionChange)
    void this.refreshSessions()
  }

  disconnectedCallback(): void {
    for (const unsub of this.unsubs) unsub()
    this.unsubs = []
    document.removeEventListener('selectionchange', this.onSelectionChange)
    if (this.streamTimer !== null) clearTimeout(this.streamTimer)
    this.streamTimer = null
    if (this.scrollTimer !== null) clearTimeout(this.scrollTimer)
    this.scrollTimer = null
    this.turns.dispose()
    super.disconnectedCallback()
  }

  private onSelectionChange = (): void => {
    const selection = document.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
    const node = selection.anchorNode
    // A selection inside this panel is the user reading a reply, not a target
    // to send, and its text is the panel's own text.
    if (node && (node === this || this.contains(node))) return
    const text = selection.toString().trim()
    if (!text) return
    this.selection = text.slice(0, MAX_SELECTION_CHARS)
  }

  private applyState(state: TurnState): void {
    this.messages = state.messages
    this.busy = state.busy
    this.error = state.error
    this.changes = state.changes
    this.skipped = state.skipped
    this.proposal = state.proposal
    this.sessionId = state.sessionId
    for (const message of state.messages) {
      if (message.role !== 'assistant') continue
      if (this.html.get(message.id)?.source !== message.text) this.stale.add(message.id)
    }
    if (state.busy) this.scheduleStreamReparse()
    else this.flushStreamReparse()
  }

  private scheduleStreamReparse(): void {
    if (this.streamTimer !== null) return
    this.streamTimer = setTimeout(() => {
      this.streamTimer = null
      this.reparseStale()
    }, STREAM_REPARSE_MS)
  }

  /** Settling a turn reparses at once: the transcript should not wait. */
  private flushStreamReparse(): void {
    if (this.streamTimer !== null) {
      clearTimeout(this.streamTimer)
      this.streamTimer = null
    }
    this.reparseStale()
  }

  private reparseStale(): void {
    if (!this.stale.size) return
    for (const id of this.stale) {
      const message = this.messages.find((candidate) => candidate.id === id)
      if (!message) continue
      this.html.set(id, { source: message.text, html: this.md.render(message.text) })
    }
    this.stale.clear()
    this.requestUpdate()
  }

  /** Parsed Markdown for a message, or nothing until the first parse lands. */
  private assistantHtml(message: TurnMessage): string {
    return this.html.get(message.id)?.html ?? ''
  }

  private send = (e: Event): void => {
    const detail = (e as CustomEvent<ComposerSendDetail>).detail
    if (!detail) return
    void this.startTurn(detail)
  }

  private async startTurn(detail: ComposerSendDetail): Promise<void> {
    const state = this.fileState.getState()
    const openDocument = state.path ? { path: state.path, content: state.content } : null
    const input: AiSendInput = {
      sessionId: this.sessionId,
      userText: detail.text,
      document: openDocument,
      selection: this.selection || null,
      references: await this.collectReferences(detail.text),
      attachments: detail.attachments,
      openPaths: state.tabs.map((tab) => tab.path).filter((path): path is string => !!path)
    }
    // The selection was context for that turn. Keeping it would have the next
    // message silently carry text the user has already moved on from.
    this.selection = ''
    await this.turns.start(input)
  }

  /**
   * Read the files the prompt names with `@`, so "compare these two" means
   * something to the model instead of arriving as two bare paths.
   *
   * Bounded, because a prompt naming twenty files would otherwise send twenty
   * documents and hit a context limit with nothing to show for it, which looks
   * like the assistant being broken.
   */
  private async collectReferences(
    userText: string
  ): Promise<Array<{ path: string; content: string }>> {
    const named = new Set<string>()
    for (const match of userText.matchAll(/(?:^|\s)@([^\s@]+)/g)) {
      named.add(match[1])
      if (named.size >= MAX_REFERENCES) break
    }
    if (!named.size) return []
    let base = ''
    try {
      base = (await api()?.vault?.getPath?.()) ?? ''
    } catch (err) {
      console.error('Could not read the vault path:', err)
    }
    const root = base.replace(/[\\/]+$/, '')
    const out: Array<{ path: string; content: string }> = []
    let chars = 0
    for (const relative of named) {
      try {
        const result = await api()?.file?.read?.(normalizePathExact(`${root}/${relative}`))
        if (!result?.content) continue
        out.push({ path: relative, content: result.content.slice(0, MAX_REFERENCE_CHARS) })
        chars += result.content.length
        if (chars >= MAX_REFERENCE_CHARS) break
      } catch (err) {
        console.error(`Could not read the referenced file ${relative}:`, err)
      }
    }
    return out
  }

  private onStop = (): void => {
    this.turns.cancel()
  }

  private onNewChat = (): void => {
    this.turns.reset()
    this.html.clear()
    this.stale.clear()
    this.undoNotes = {}
    this.sessionId = this.turns.sessionId
    void this.refreshSessions()
  }

  private onPickSession = (e: Event): void => {
    const id = (e.target as HTMLSelectElement).value
    if (!id) {
      this.onNewChat()
      return
    }
    const known = this.sessions.find((session) => session.id === id)
    this.turns.load(known ?? { id, title: 'Chat', createdAt: 0, updatedAt: 0 })
    this.html.clear()
    this.stale.clear()
    this.undoNotes = {}
    this.sessionId = id
    void this.restoreChanges(id)
  }

  /** Undo history for a reopened conversation. Its messages are not loaded. */
  private async restoreChanges(sessionId: string): Promise<void> {
    try {
      const changes = await api()?.ai?.listChanges?.(sessionId)
      if (changes) this.turns.adoptChanges(changes)
    } catch (err) {
      console.error('Could not load the change history:', err)
    }
  }

  private async refreshSessions(): Promise<void> {
    try {
      const sessions = await api()?.ai?.listSessions?.()
      if (sessions) this.sessions = sessions
    } catch (err) {
      // No history is a normal state for a fresh vault, not something worth
      // showing in place of the transcript.
      console.error('Could not list AI conversations:', err)
    }
  }

  private async undo(change: ChangeView): Promise<void> {
    let outcome: UndoOutcomeView | undefined
    try {
      outcome = await api()?.ai?.undoChange?.(change.id)
    } catch (err) {
      console.error(`Could not revert ${change.path}:`, err)
    }
    this.undoNotes = { ...this.undoNotes, [change.id]: undoNote(outcome) }
  }

  private onClose = (): void => {
    this.dispatchEvent(new CustomEvent('ai-close', { bubbles: true, composed: true }))
  }

  /** The conversation being written, plus the saved ones to switch to. */
  private get sessionOptions(): SessionView[] {
    if (this.sessions.some((session) => session.id === this.sessionId)) return this.sessions
    const now = Date.now()
    return [
      { id: this.sessionId, title: liveTitle(this.messages), createdAt: now, updatedAt: now },
      ...this.sessions
    ]
  }

  render(): unknown {
    return html`
      <div class="head">
        <span class="brand">${chromeIcon('sparkle', 16)}<span>AI</span></span>
        <select class="sessions" aria-label="Conversation" @change=${this.onPickSession}>
          ${this.sessionOptions.map(
            (session) =>
              html`<option value=${session.id} ?selected=${session.id === this.sessionId}>
                ${session.title}
              </option>`
          )}
        </select>
        <button class="icon" aria-label="New chat" title="New chat" @click=${this.onNewChat}>
          ${chromeIcon('plus', 16)}
        </button>
        <button
          class="icon"
          aria-label="Close assistant"
          title="Close assistant"
          @click=${this.onClose}
        >
          ${chromeIcon('x', 16)}
        </button>
      </div>
      <div class="context">
        ${
          this.docPath
            ? html`<span class="doc" title=${this.docPath}>${displayTitle(this.docPath)}</span>`
            : html`<span class="doc none">No document open</span>`
        }
        ${
          this.selection
            ? html`<span class="chip" title=${`${this.selection.length} characters selected`}>
                selection · ${this.selection.length}
              </span>`
            : null
        }
      </div>
      <div class="thread">
        ${
          this.messages.length === 0
            ? html`<div class="empty">
                Ask about the open note, or select something and ask for a change.
              </div>`
            : this.messages.map((message) => this.renderMessage(message))
        }
        ${this.renderChanges()}
      </div>
      ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : null}
      <writemd-ai-composer
        .busy=${this.busy}
        .hasSelection=${!!this.selection}
        @composer-send=${this.send}
        @composer-stop=${this.onStop}
      ></writemd-ai-composer>
    `
  }

  private renderMessage(message: TurnMessage): unknown {
    if (message.role === 'user') {
      return html`<div class="msg user"><div class="bubble">${message.text}</div></div>`
    }
    const live = this.busy && message.id === this.messages[this.messages.length - 1]?.id
    if (live && !message.text.trim()) {
      return html`<div class="msg assistant"><div class="bubble idle">Thinking…</div></div>`
    }
    return html`
      <div class="msg assistant">
        <div class="bubble md">${unsafeHTML(this.assistantHtml(message))}</div>
      </div>
    `
  }

  private renderChanges(): unknown {
    if (this.proposal && !this.changes.length && !this.skipped.length) {
      const files = this.proposal.files.length
      return html`<div class="proposal">
        Writing ${this.proposal.blocks} change${this.proposal.blocks === 1 ? '' : 's'} to ${files}
        file${files === 1 ? '' : 's'}…
      </div>`
    }
    if (!this.changes.length && !this.skipped.length) return null
    return html`
      <div class="changes">
        <div class="changes-head">
          ${
            this.changes.length
              ? `${this.changes.length} file${this.changes.length === 1 ? '' : 's'} changed`
              : 'Nothing was written'
          }
        </div>
        ${this.changes.map((change) => {
          const note = this.undoNotes[change.id]
          return html`
            <div class="change">
              <span class="kind ${change.kind}">${change.kind}</span>
              <span class="path" title=${change.path}>${shortPath(change.path)}</span>
              <button
                class="undo"
                ?disabled=${!!note?.reverted}
                aria-label=${`Undo the change to ${change.path}`}
                @click=${() => void this.undo(change)}
              >
                Undo
              </button>
            </div>
            ${note ? html`<div class="note">${note.text}</div>` : null}
          `
        })}
        ${this.skipped.map(
          (entry) => html`
            <div class="change skipped">
              <span class="kind">skipped</span>
              <span class="path" title=${entry.path}>${shortPath(entry.path)}</span>
              <span class="reason" title=${entry.detail}>${entry.reason}</span>
            </div>
          `
        )}
      </div>
    `
  }

  protected updated(): void {
    const el = this.thread
    if (!el) return
    // After the new content is in the DOM, or the scroll height is still the
    // previous one and the transcript does not move at all.
    if (this.scrollTimer !== null) clearTimeout(this.scrollTimer)
    this.scrollTimer = setTimeout(() => {
      this.scrollTimer = null
      this.scrollToBottom()
    }, 0)
  }

  /**
   * Follow the stream, but only from the bottom.
   *
   * Yanking the view down while someone is reading an earlier message is what
   * makes a streaming transcript unusable, so a scrolled-up reader stays put.
   */
  private scrollToBottom(): void {
    const el = this.thread
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 24) return
    el.scrollTop = el.scrollHeight
  }

  static styles = [
    scrollbarStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--bg);
        color: var(--text);
        font-family: var(--font-ui);
        box-sizing: border-box;
      }

      .head {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
        padding: 6px 8px;
        border-bottom: 1px solid var(--border-subtle);
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 600;
        color: var(--text);
      }

      .sessions {
        flex: 1;
        min-width: 0;
        font: inherit;
        font-size: 12px;
        color: var(--text-muted);
        background: transparent;
        border: 1px solid transparent;
        border-radius: 5px;
        padding: 3px 4px;
      }

      .sessions:hover {
        border-color: var(--border-subtle);
        color: var(--text);
      }

      .icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: none;
        border-radius: 5px;
        background: none;
        color: var(--text-muted);
        cursor: pointer;
        flex-shrink: 0;
      }

      .icon:hover {
        background: var(--bg-hover);
        color: var(--text);
      }

      .context {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        padding: 5px 10px;
        min-height: 26px;
        font-size: 11px;
        color: var(--text-muted);
        border-bottom: 1px solid var(--border-subtle);
      }

      .doc {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .doc.none {
        font-style: italic;
      }

      .chip {
        flex-shrink: 0;
        padding: 1px 7px;
        font-size: 10px;
        border-radius: 999px;
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
      }

      .thread {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 10px;
      }

      .empty {
        margin-top: 24px;
        text-align: center;
        font-size: 12px;
        line-height: 1.6;
        color: var(--text-muted);
      }

      .msg {
        display: flex;
      }

      .msg.user {
        justify-content: flex-end;
      }

      .bubble {
        max-width: 92%;
        padding: 7px 10px;
        border-radius: 8px;
        font-size: 13px;
        line-height: 1.6;
        overflow-wrap: anywhere;
      }

      .user .bubble {
        background: var(--bg-active);
        color: var(--text);
        white-space: pre-wrap;
      }

      .assistant .bubble {
        width: 100%;
        max-width: 100%;
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        color: var(--text-secondary);
      }

      .assistant .idle {
        color: var(--text-muted);
        font-style: italic;
      }

      /*
       * Assistant copy is Markdown, so it gets the block spacing and the code
       * and list treatments a document gets. Without these a reply that is a
       * list renders as one run-on line, which is the difference between
       * readable and not.
       */
      .md p {
        margin: 0 0 8px;
      }

      .md p:last-child {
        margin-bottom: 0;
      }

      .md ul,
      .md ol {
        margin: 0 0 8px;
        padding-left: 20px;
      }

      .md h1,
      .md h2,
      .md h3,
      .md h4 {
        margin: 10px 0 6px;
        font-size: 13px;
        color: var(--text);
      }

      .md code {
        font-family: var(--font-mono);
        font-size: 12px;
        background: var(--bg-code);
        padding: 1px 4px;
        border-radius: 3px;
      }

      .md pre {
        margin: 0 0 8px;
        padding: 8px;
        border-radius: 6px;
        background: var(--bg-code);
        overflow-x: auto;
      }

      .md pre code {
        padding: 0;
        background: none;
      }

      .md blockquote {
        margin: 0 0 8px;
        padding-left: 10px;
        border-left: 2px solid var(--border);
        color: var(--text-muted);
      }

      .md a {
        color: var(--accent);
      }

      .proposal {
        font-size: 12px;
        font-style: italic;
        color: var(--text-muted);
      }

      .changes {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--bg-card);
      }

      .changes-head {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: var(--text-muted);
      }

      .change {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        font-size: 12px;
      }

      .change.skipped {
        color: var(--text-muted);
      }

      .kind {
        flex-shrink: 0;
        padding: 1px 6px;
        font-size: 10px;
        border-radius: 999px;
        background: var(--bg-hover);
        color: var(--text-secondary);
      }

      .kind.created {
        color: var(--success);
      }

      .kind.modified {
        color: var(--accent);
      }

      .path {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--font-mono);
        font-size: 11px;
      }

      .reason {
        flex-shrink: 0;
        font-size: 10px;
        color: var(--text-muted);
      }

      .undo {
        flex-shrink: 0;
        font: inherit;
        font-size: 11px;
        padding: 2px 9px;
        border: 1px solid var(--border-subtle);
        border-radius: 5px;
        background: var(--bg-hover);
        color: var(--text-secondary);
        cursor: pointer;
      }

      .undo:hover:not(:disabled) {
        background: var(--bg-active);
        color: var(--text);
      }

      .undo:disabled {
        opacity: 0.45;
        cursor: default;
      }

      .note {
        padding-left: 2px;
        font-size: 11px;
        color: var(--text-muted);
      }

      .error {
        flex-shrink: 0;
        padding: 7px 10px;
        font-size: 12px;
        background: var(--danger-bg);
        border-top: 1px solid var(--border-subtle);
        color: var(--danger);
      }
    `
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-ai-dock': AiDock
  }
}
