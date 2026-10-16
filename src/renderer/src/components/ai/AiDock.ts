import { css, html, LitElement } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { api } from '../../api'
import { FileState } from '../../state/file-state'
import { createDocumentMarkdownIt } from '../../utils/markdown'
import { displayTitle, shortPath } from '../../utils/links'
import { sameFilePath } from '../../utils/paths'
import { navigateLink } from '../../utils/navigate'
import { scrollbarStyles } from '../scrollbars'
import { aiActivityStyles, aiThinkingLabel, chromeIcon } from '../../design/icons'
import { controlStyles } from '../../design/controls'
import type { TurnMessage, TurnState } from './turn-controller'
import { conversationController, connectConversation, disconnectConversation } from './conversation'
import { makeSessionId } from '../../../../shared/ai/sessions'
import { takeAiHandoff, type AiHandoff } from './handoff'
import { collectReferences } from './references'
import type { AiSendInput, ChangeView, SessionView, SkippedView, UndoOutcomeView } from './types'
import type { AiComposer, ComposerSendDetail } from './Composer'
import './Composer'
import './HistoryPicker'

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

/*
 * The `@` reference limits moved to `references.ts` with the resolver they
 * belong to, so the floating bar and this panel cannot drift apart on how many
 * notes one prompt may pull in.
 */

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
  @state() private copiedMessage = ''
  @state() private preparing = false
  @state() private selectionPath: string | null = null
  @state() private pendingUndo = new Set<string>()

  @query('.thread') private thread!: HTMLElement | null

  /**
   * Public so a test can drive a real turn. The tests emit events carrying the
   * request id this generated, which is the only way to exercise the
   * stale-stream guard without a socket.
   */
  readonly turns = conversationController()

  private md = createDocumentMarkdownIt()
  private fileState = FileState.getInstance()
  private unsubs: Array<() => void> = []
  /** Parsed Markdown per message, kept against the text it was parsed from. */
  private html = new Map<string, { source: string; html: string }>()
  private stale = new Set<string>()
  private streamTimer: ReturnType<typeof setTimeout> | null = null
  private scrollTimer: ReturnType<typeof setTimeout> | null = null
  private followStream = true
  private contextVersion = 0
  private messageContexts = new Map<string, string | null>()

  connectedCallback(): void {
    super.connectedCallback()
    connectConversation(this.turns)
    this.unsubs.push(this.turns.subscribe((state) => this.applyState(state)))
    this.applyState(this.turns.getState())
    this.unsubs.push(
      this.fileState.subscribe(() => {
        const state = this.fileState.getState()
        const path = state.path
        if (path !== this.docPath) {
          this.docPath = path
          this.selection = ''
          this.selectionPath = null
        } else if (
          this.selectionPath &&
          !sameFilePath(this.selectionPath, path) &&
          !sameFilePath(this.selectionPath, state.secondaryDoc?.path)
        ) {
          this.selection = ''
          this.selectionPath = null
        }
      })
    )
    this.sessionId = this.turns.sessionId
    this.docPath = this.fileState.getState().path
    // A conversation handed over from the floating bar, taken once so that
    // closing and reopening the panel does not resurrect it.
    const handoff = takeAiHandoff()
    if (handoff && (!handoff.sessionId || handoff.sessionId === this.turns.sessionId))
      void this.updateComplete.then(() => this.adoptHandoff(handoff))
    // The editor is a CodeMirror view, which is why the selection is read from
    // the document rather than being pushed here: there is no event to take it
    // from, and it is only meaningful at the moment of sending.
    document.addEventListener('selectionchange', this.onSelectionChange)
    void this.refreshSessions()
  }

  disconnectedCallback(): void {
    this.contextVersion++
    for (const unsub of this.unsubs) unsub()
    this.unsubs = []
    document.removeEventListener('selectionchange', this.onSelectionChange)
    if (this.streamTimer !== null) clearTimeout(this.streamTimer)
    this.streamTimer = null
    if (this.scrollTimer !== null) clearTimeout(this.scrollTimer)
    this.scrollTimer = null
    disconnectConversation(this.turns)
    super.disconnectedCallback()
  }

  private onSelectionChange = (): void => {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0) return
    let node: Node | null = selection.anchorNode
    let inEditor = false
    let inSecondary = false
    while (node) {
      if (node === this) return
      if (node instanceof Element && node.tagName === 'WRITEMD-EDITOR') inEditor = true
      if (node instanceof Element && node.id === 'secondary-cm-wrapper') inSecondary = true
      node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)
    }
    if (!inEditor) return
    if (selection.isCollapsed) {
      this.selection = ''
      return
    }
    const text = selection.toString().trim()
    if (!text) return
    this.selection = text
    this.selectionPath = inSecondary
      ? (this.fileState.getState().secondaryDoc?.path ?? null)
      : this.docPath
  }

  private applyState(state: TurnState): void {
    const settled = this.busy && !state.busy
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
    if (settled) void this.refreshSessions()
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

  /**
   * Adopt a conversation staged by the floating bar.
   *
   * "Open full chat" moved the user from a one-shot question into a conversation
   * about the same thing, so the panel opens holding what was already said.
   * Opening it empty made the handoff look like the bar had thrown the exchange
   * away, and the natural next thing - asking a follow-up - lost the context.
   */
  adoptHandoff(handoff: AiHandoff): void {
    this.contextVersion++
    this.preparing = false
    // The selection the bar was scoped to, restored from the handoff rather than
    // read from the DOM: the bar has focus by now and the document selection
    // has already been taken away from the user.
    this.selection = handoff.selection ?? ''
    this.selectionPath = handoff.selection ? handoff.path : null
    this.renderRoot.querySelector<AiComposer>('writemd-ai-composer')?.resetDraft()
    this.followStream = true
    this.html.clear()
    this.messageContexts.clear()
    this.stale.clear()
    this.undoNotes = {}
    this.pendingUndo = new Set()
    if (handoff.sessionId !== this.turns.sessionId)
      this.turns.load({
        id: handoff.sessionId ?? makeSessionId(),
        title:
          handoff.messages.find((message) => message.role === 'user')?.content.slice(0, 60) ??
          'Chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: handoff.messages
      })
    this.sessionId = this.turns.sessionId
    if (handoff.path) this.docPath = handoff.path
    this.applyState(this.turns.getState())
    void this.refreshSessions()
  }

  /** Context-menu actions are isolated from the rest of the note and prior chats. */
  async runSelectionAction(input: {
    text: string
    path: string | null
    intent: 'explain' | 'summarize'
  }): Promise<void> {
    if (!input.text.trim()) return
    this.onNewChat()
    this.setSelectionContext(input.text, input.path ?? undefined)
    await this.startTurn(
      {
        text:
          input.intent === 'explain'
            ? 'Explain only the highlighted text.'
            : 'Summarize only the highlighted text.',
        attachments: []
      },
      true
    )
  }

  private async startTurn(detail: ComposerSendDetail, selectionOnly = false): Promise<void> {
    if (this.busy || this.preparing || !detail.text.trim()) return
    const version = ++this.contextVersion
    this.preparing = true
    const state = this.fileState.getState()
    const secondary = state.secondaryDoc
    const openDocument =
      this.selectionPath && secondary?.path && sameFilePath(this.selectionPath, secondary.path)
        ? { path: secondary.path, content: secondary.content }
        : state.path
          ? { path: state.path, content: state.content }
          : null
    const input: AiSendInput = {
      sessionId: this.sessionId,
      selectionOnly,
      userText: detail.text,
      document: selectionOnly ? null : openDocument,
      selection: this.selection || null,
      references: selectionOnly ? [] : await collectReferences(detail.text),
      attachments: selectionOnly ? [] : detail.attachments,
      openPaths: selectionOnly
        ? []
        : [
            ...new Set(
              [...state.tabs.map((tab) => tab.path), secondary?.path].filter(
                (path): path is string => !!path
              )
            )
          ]
    }
    if (version !== this.contextVersion || !this.isConnected) return
    this.preparing = false
    this.followStream = true
    // The selection was context for that turn. Keeping it would have the next
    // message silently carry text the user has already moved on from.
    this.selection = ''
    this.selectionPath = null
    const sending = this.turns.start(input)
    if (this.turns.requestId)
      this.messageContexts.set(`${this.turns.requestId}:assistant`, openDocument?.path ?? null)
    await sending
  }

  private onStop = (): void => {
    this.contextVersion++
    this.preparing = false
    this.turns.cancel()
  }

  private onNewChat = (): void => {
    this.contextVersion++
    this.preparing = false
    this.selection = ''
    this.selectionPath = null
    this.renderRoot.querySelector<AiComposer>('writemd-ai-composer')?.resetDraft()
    this.followStream = true
    this.turns.reset()
    this.html.clear()
    this.messageContexts.clear()
    this.stale.clear()
    this.undoNotes = {}
    this.pendingUndo = new Set()
    this.sessionId = this.turns.sessionId
    void this.refreshSessions()
  }

  private onPickSession = (e: CustomEvent<{ id: string }>): void => {
    const id = e.detail.id
    if (id === this.sessionId) return
    if (!id) {
      this.onNewChat()
      return
    }
    const known = this.sessions.find((session) => session.id === id)
    this.contextVersion++
    this.preparing = false
    this.selection = ''
    this.selectionPath = null
    this.renderRoot.querySelector<AiComposer>('writemd-ai-composer')?.resetDraft()
    this.followStream = true
    this.html.clear()
    this.messageContexts.clear()
    this.stale.clear()
    this.undoNotes = {}
    this.pendingUndo = new Set()
    this.turns.load(known ?? { id, title: 'Chat', createdAt: 0, updatedAt: 0 })
    for (const message of this.messages)
      this.messageContexts.set(message.id, known?.contextFile ?? null)
    this.sessionId = id
    void this.restoreChanges(id)
  }

  /** Restore the saved conversation's per-file undo history. */
  private async restoreChanges(sessionId: string): Promise<void> {
    try {
      const changes = await api()?.ai?.listChanges?.(sessionId)
      if (changes && this.isConnected && sessionId === this.sessionId)
        this.turns.adoptChanges(changes, sessionId)
    } catch (err) {
      console.error('Could not load the change history:', err)
    }
  }

  private async refreshSessions(): Promise<void> {
    try {
      const sessions = await api()?.ai?.listSessions?.()
      if (sessions && this.isConnected) this.sessions = sessions
    } catch (err) {
      // No history is a normal state for a fresh vault, not something worth
      // showing in place of the transcript.
      console.error('Could not list AI conversations:', err)
    }
  }

  /**
   * Forget a saved conversation.
   *
   * Deleting the one on screen also starts a new chat: leaving a transcript on
   * screen whose history no longer exists means the next message is saved under a
   * session id that is gone, and the conversation reappears when the list is read.
   */
  private onDeleteSession = (e: CustomEvent<{ id: string }>): void => {
    const id = e.detail.id
    if (this.pendingUndo.has(id)) return
    this.pendingUndo = new Set([...this.pendingUndo, id])
    void (async () => {
      try {
        await api()?.ai?.deleteSession?.(id)
      } catch (err) {
        console.error('Could not delete the AI conversation:', err)
      } finally {
        this.pendingUndo.delete(id)
      }
      if (id === this.sessionId) this.onNewChat()
      await this.refreshSessions()
    })()
  }

  private async undo(change: ChangeView): Promise<void> {
    if (this.pendingUndo.has(change.id)) return
    const sessionId = this.sessionId
    this.pendingUndo = new Set([...this.pendingUndo, change.id])
    let outcome: UndoOutcomeView | undefined
    try {
      outcome = await api()?.ai?.undoChange?.(change.id)
    } catch (err) {
      console.error(`Could not revert ${change.path}:`, err)
    }
    if (!this.isConnected || sessionId !== this.sessionId) return
    this.pendingUndo = new Set([...this.pendingUndo].filter((id) => id !== change.id))
    this.undoNotes = { ...this.undoNotes, [change.id]: undoNote(outcome) }
  }

  private onClose = (): void => {
    this.dispatchEvent(new CustomEvent('ai-close', { bubbles: true, composed: true }))
  }

  private onOpenFloating = (): void => {
    this.dispatchEvent(
      new CustomEvent('ai-open-floating', {
        detail: { path: this.selectionPath ?? this.docPath },
        bubbles: true,
        composed: true
      })
    )
  }

  private suggest(text: string): void {
    this.renderRoot.querySelector<AiComposer>('writemd-ai-composer')?.setPrompt(text)
  }

  setSelectionContext(text: string, documentPath?: string): void {
    this.selection = text
    this.selectionPath = documentPath ?? this.docPath
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<AiComposer>('writemd-ai-composer')?.focus()
    })
  }

  private async copyMessage(message: TurnMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(message.text)
      this.copiedMessage = message.id
    } catch {
      this.error = 'Could not copy the reply. Select the text and copy it manually.'
    }
  }

  private onTranscriptClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!target) return
    event.preventDefault()
    const messageId = target.closest<HTMLElement>('[data-message-id]')?.dataset.messageId ?? ''
    void navigateLink(target.getAttribute('href') ?? '', {
      sourcePath: this.messageContexts.has(messageId)
        ? (this.messageContexts.get(messageId) ?? null)
        : this.docPath,
      openFile: (path) => this.fileState.openFile(path),
      getApi: api
    })
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
    const contextPath = this.selection && this.selectionPath ? this.selectionPath : this.docPath
    return html`
      <div class="head">
        <span class="brand">Assistant</span>
        <span class="head-spacer"></span>
        <writemd-ai-history-picker
          .sessions=${this.sessionOptions}
          .currentId=${this.sessionId}
          @session-pick=${this.onPickSession}
          @session-delete=${this.onDeleteSession}
        ></writemd-ai-history-picker>
        <button class="icon" aria-label="New chat" title="New chat" @click=${this.onNewChat}>
          ${chromeIcon('plus')}
        </button>
        <button
          class="icon"
          aria-label="Close assistant"
          title="Close assistant"
          @click=${this.onClose}
        >
          ${chromeIcon('x')}
        </button>
      </div>
      <div class="context">
        ${
          contextPath
            ? html`<span class="doc" title=${`Current note: ${contextPath}`}
                >${chromeIcon('file', 14)}<span>${displayTitle(contextPath)}</span></span
              >`
            : html`<span class="doc none">No document open</span>`
        }
        <button class="icon floating-link" @click=${this.onOpenFloating}>
          Open in floating bar
        </button>
        ${
          this.selection
            ? html`<span class="chip" title=${`${this.selection.length} characters selected`}>
                Selection · ${this.selection.length}
                <button
                  class="clear-selection"
                  aria-label="Remove selection from context"
                  @click=${() => {
                    this.selection = ''
                    this.selectionPath = null
                  }}
                >
                  ${chromeIcon('x', 12)}
                </button>
              </span>`
            : null
        }
      </div>
      <div
        class="thread"
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        aria-busy=${this.busy ? 'true' : 'false'}
        @click=${this.onTranscriptClick}
        @scroll=${() => {
          const el = this.thread
          if (el) this.followStream = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        ${
          this.messages.length === 0
            ? html`<div class="empty">
                <h2>${this.docPath ? 'Ask about your note' : 'Start a conversation'}</h2>
                <p>
                  ${this.docPath ? 'Summarize, rewrite, or work through an idea.' : 'Write a prompt or reference a note with @.'}
                </p>
                <div class="suggestions">
                  <button
                    @click=${() => this.suggest(this.docPath ? 'Summarize the key points in this note.' : 'Help me outline a new note about ')}
                  >
                    ${chromeIcon('file', 16)}${this.docPath ? 'Summarize this note' : 'Start an outline'}
                  </button>
                  <button
                    @click=${() => this.suggest(this.docPath ? 'Review this note and suggest ways to improve its clarity. Do not edit it yet.' : 'Help me brainstorm ideas for ')}
                  >
                    ${chromeIcon('pencil', 16)}${this.docPath ? 'Improve my writing' : 'Explore an idea'}
                  </button>
                </div>
              </div>`
            : this.messages.map((message) => this.renderMessage(message))
        }
        ${this.renderChanges()}
      </div>
      ${
        this.error
          ? html`<div class="error" role="alert">
              <span>${this.error}</span>${
                this.messages.some((message) => message.role === 'user')
                  ? html`<button
                      class="retry"
                      @click=${() => {
                        const last = [...this.messages]
                          .reverse()
                          .find((message) => message.role === 'user')
                        if (last) this.suggest(last.text)
                      }}
                    >
                      Edit and retry
                    </button>`
                  : null
              }
            </div>`
          : null
      }
      <writemd-ai-composer
        .busy=${this.busy || this.preparing}
        .hasSelection=${!!this.selection}
        .started=${this.messages.length > 0}
        @composer-send=${this.send}
        @composer-stop=${this.onStop}
      ></writemd-ai-composer>
    `
  }

  private renderMessage(message: TurnMessage): unknown {
    if (message.role === 'user') {
      return html`<div class="msg user">
        <span class="role">You</span>
        <div class="bubble">${message.text}</div>
      </div>`
    }
    const live = this.busy && message.id === this.messages[this.messages.length - 1]?.id
    if (live && !message.text.trim()) {
      return html`<div class="msg assistant">
        <div
          class="thinking-indicator"
          role="status"
          title=${this.turns.getState().status || 'Thinking'}
        >
          ${aiThinkingLabel()}
          <span class="status-hint">${this.turns.getState().status || 'Thinking'}</span>
        </div>
      </div>`
    }
    if (!message.text.trim()) return null
    return html`
      <div class="msg assistant" data-message-id=${message.id}>
        <div class="bubble md">${unsafeHTML(this.assistantHtml(message))}</div>
        ${!live ? html`<button class="copy" aria-label="Copy reply" @click=${() => void this.copyMessage(message)}>${this.copiedMessage === message.id ? 'Copied' : 'Copy'}</button>` : null}
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
                ?disabled=${this.pendingUndo.has(change.id) || !!note?.reverted || change.revertedAt !== null}
                aria-label=${`Undo the change to ${change.path}`}
                @click=${() => void this.undo(change)}
              >
                ${this.pendingUndo.has(change.id) ? 'Undoing…' : change.revertedAt !== null ? 'Reverted' : 'Undo'}
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
    if (!this.followStream) return
    el.scrollTop = el.scrollHeight
  }

  static styles = [
    aiActivityStyles,
    scrollbarStyles,
    controlStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--editor-surface);
        color: var(--text);
        font-family: var(--font-ui);
        box-sizing: border-box;
      }

      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
        height: 40px;
        padding: 4px 12px;
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-secondary);
      }
      .thinking-indicator {
        position: relative;
        display: flex;
        align-items: center;
        min-height: 20px;
        color: var(--text);
      }
      .thinking-indicator svg {
        display: block;
      }
      .status-hint {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }
      .head-spacer {
        flex: 1;
      }
      .icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 4px;
        border: none;
        border-radius: var(--radius-sm);
        background: none;
        color: var(--text-secondary);
        flex-shrink: 0;
      }
      .icon:hover {
        background: var(--bg-hover);
        color: var(--text);
      }
      .floating-link {
        width: auto;
        height: 24px;
        padding: 4px;
        margin-left: auto;
        font: inherit;
        font-size: 11px;
      }
      .context {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px 8px;
        flex-shrink: 0;
        padding: 0 16px 8px;
        min-height: 28px;
        font-size: 12px;
        color: var(--text-muted);
      }
      .doc {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        min-width: 0;
        max-width: 100%;
      }
      .doc svg {
        flex-shrink: 0;
      }
      .doc span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 4px 2px 8px;
        border-radius: var(--radius-sm);
        background: var(--bg-hover);
        color: var(--text-secondary);
      }
      .clear-selection {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        background: none;
        padding: 2px;
      }
      .thread {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        display: flex;
        flex-direction: column;
        gap: 24px;
        padding: 16px;
      }
      .empty {
        margin: auto 0;
        padding: 24px 0;
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-secondary);
      }
      .empty h2 {
        margin: 0 0 8px;
        font-size: 16px;
        line-height: 1.4;
        font-weight: 600;
        color: var(--text);
      }
      .empty p {
        margin: 0 0 16px;
      }
      .suggestions {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .suggestions button {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 36px;
        padding: 8px;
        text-align: left;
        font: 13px var(--font-ui);
        background: transparent;
        border: 0;
        border-radius: var(--radius-sm);
      }
      .suggestions button:hover {
        background: var(--bg-hover);
        color: var(--text);
      }
      .msg {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
        flex-shrink: 0;
      }
      .msg.user {
        align-items: flex-end;
      }
      .role {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 500;
        color: var(--text-muted);
      }
      .bubble {
        max-width: 100%;
        font-size: 13px;
        line-height: 1.7;
        overflow-wrap: anywhere;
      }
      .user .bubble {
        max-width: 92%;
        padding: 8px 12px;
        border-radius: var(--radius-sm);
        background: var(--bg-hover);
        color: var(--text);
        white-space: pre-wrap;
      }
      .assistant .bubble {
        width: 100%;
        color: var(--text);
      }
      .copy,
      .retry {
        align-self: flex-start;
        font: 11px var(--font-ui);
        padding: 4px 8px;
        border: 0;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text-secondary);
      }
      .copy:hover,
      .retry:hover {
        background: var(--bg-hover);
        color: var(--text);
      }
      .md {
        min-width: 0;
      }
      .md table {
        display: block;
        width: 100%;
        overflow: auto;
        border-collapse: collapse;
        margin-bottom: 8px;
      }
      .md th,
      .md td {
        padding: 4px 8px;
        border: 1px solid var(--border);
        text-align: left;
      }
      .md img {
        max-width: 100%;
        height: auto;
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
        margin: 12px 0 8px;
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
        padding-left: 12px;
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
        border-radius: var(--radius-md);
        background: var(--bg-card);
      }

      .changes-head {
        font-size: 12px;
        font-weight: 500;
        color: var(--text-secondary);
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
        border-radius: var(--radius-sm);
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
        border-radius: var(--radius-sm);
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
        display: flex;
        flex-direction: column;
        gap: 8px;
        overflow-wrap: anywhere;
        flex-shrink: 0;
        padding: 12px;
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
