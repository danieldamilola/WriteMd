import { css, html, LitElement, type TemplateResult, type PropertyValues } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { api } from '../../api'
import { createMarkdownIt } from '../../utils/markdown'
import type { AiSendInput, ChangeView, PreviewChangeView, SkippedView } from './types'
import type { TurnState } from './turn-controller'
import { conversationController, connectConversation, disconnectConversation } from './conversation'
import type { ComposerSendDetail } from './Composer'
import type { QuickAiContext } from './quick-context'
import { collectReferences } from './references'
import { previewChanges } from '../../utils/document-changes'
import { conceal } from '../../utils/motion'
import { stageAiHandoff, type AiHandoff } from './handoff'
import { aiActivityStyles, chromeIcon } from '../../design/icons'
import { scrollbarStyles } from '../scrollbars'
import { controlStyles } from '../../design/controls'
import './Composer'

/** Replies are prose, not documents, so a single newline stays a line break. */
const md = createMarkdownIt({ breaks: true })

/**
 * Which file, in words rather than a path.
 *
 * "this note" for the one on screen and the bare file name for anything else,
 * because a bar floating over the document is talking about that document and
 * only needs to name something else when the change is elsewhere in the vault.
 */
function displayName(path: string, openPath: string | null): string {
  if (openPath && path === openPath) return 'this note'
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

/** Clears the document footer's 30px, plus a gap. */
const FOOTER_CLEARANCE = 46

/**
 * The floating command bar.
 *
 * This is the whole AI surface for people who do not want the side panel: the
 * AI button in the toolbar, or in the vertical panel, opens this instead. It
 * sits over the bottom of the document rather than in the middle of it, so it
 * covers the least amount of the thing you are reading, and it is gone again
 * the moment you click away.
 *
 * It answers in place. A reply, a suggested edit and its Accept and Discard sit
 * in a card directly above the bar, so a one-shot request never becomes a
 * conversation you have to go and find. Anything longer belongs in the chat
 * panel, which the bar hands off to.
 */
@customElement('writemd-ai-quick')
export class QuickAi extends LitElement {
  @property({ attribute: false }) readContext?: () => QuickAiContext
  @property({ attribute: false }) context: QuickAiContext = {
    path: null,
    content: '',
    selection: null
  }

  /**
   * Resolves the pane the bar measures itself against.
   *
   * A resolver rather than an element so it is asked afresh every time: the
   * editor re-creates its pane on a split toggle or a tab change, and a stored
   * reference would go on describing a box that is no longer on screen.
   */
  @property({ attribute: false }) paneFor: (() => HTMLElement | null) | null = null
  @property({ type: Boolean }) autoAcceptEdits = false

  @state() private busy = false
  @state() private applying = false
  @state() private reply = ''
  @state() private error = ''
  @state() private previews: PreviewChangeView[] = []
  @state() private skipped: SkippedView[] = []
  @state() private status = ''
  /** Files written by the turn, named in the reply card. */
  @state() private applied: string[] = []
  /**
   * This bar has run a turn.
   *
   * The ChatGPT plan notice is empty-state chrome, and the bar is usually torn
   * down and reopened rather than kept around, so the flag is set on the first
   * send and never cleared. Tracking `reply` instead would be wrong: it is reset
   * by the next send, so the card would reappear between turns in the same bar.
   */
  @state() private started = false
  readonly turns = conversationController()
  private sendVersion = 0
  private preparing = false
  private applyError = ''
  private activeApply: { preview: PreviewChangeView; sessionId: string } | null = null
  private proposalContext: QuickAiContext | null = null
  @query('writemd-ai-composer') private composer!: HTMLElement & {
    focus: () => void
    setPrompt: (text: string) => void
    resetDraft: () => void
  }

  private unsubscribe?: () => void
  private restoreFocus: HTMLElement | null = null
  private observer?: ResizeObserver
  private observed: Element | null = null
  private closing = false

  connectedCallback(): void {
    super.connectedCallback()
    this.restoreFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    connectConversation(this.turns)
    this.unsubscribe = this.turns.subscribe((turn) => this.applyTurnState(turn))
    this.applyTurnState(this.turns.getState())
    document.addEventListener('keydown', this.onGlobalKeyDown)
    this.observer = new ResizeObserver(this.syncAnchor)
    // The editor finishes its first render after this one, so the pane is not
    // necessarily there yet. Measure now and again on the next frame.
    this.syncAnchor()
    requestAnimationFrame(this.syncAnchor)
    this.applyInitialPrompt()
    this.focusPrompt()
  }

  disconnectedCallback(): void {
    document.removeEventListener('keydown', this.onGlobalKeyDown)
    this.observer?.disconnect()
    this.observer = undefined
    this.observed = null
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.sendVersion++
    disconnectConversation(this.turns)
    if (this.restoreFocus?.isConnected) this.restoreFocus.focus()
    super.disconnectedCallback()
  }

  /**
   * Line the bar up with the writing, not with the window.
   *
   * Fixed positioning against measured coordinates, because every ancestor
   * between here and the document has `overflow: hidden` and would clip an
   * element that floated inside it.
   *
   * What gets watched is the pane rather than this element's parent: opening a
   * split pane or the chat panel leaves the content area the same width and
   * narrows only the pane inside it, so an observer on the parent never fires
   * and the bar keeps the width it was measured with.
   */
  private syncAnchor = (): void => {
    const pane = this.paneFor?.() ?? this.parentElement
    if (pane && pane !== this.observed) {
      this.observer?.disconnect()
      if (pane) this.observer?.observe(pane)
      this.observed = pane ?? null
    }
    // Collapsed, the handle belongs where the bar's bottom edge was rather than
    // on the document footer, so it clears the same 46px.
    const rect = pane?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    this.style.setProperty('--quick-ai-left', `${Math.round(rect.left)}px`)
    this.style.setProperty('--quick-ai-width', `${Math.round(rect.width)}px`)
    this.style.setProperty(
      '--quick-ai-bottom',
      `${Math.round(window.innerHeight - rect.bottom + FOOTER_CLEARANCE)}px`
    )
  }

  /** Type a question in for the caller, once, so one click asks it. */
  private applyInitialPrompt(): void {
    const text = this.initialPrompt.trim()
    if (!text) return
    this.initialPrompt = ''
    void this.updateComplete.then(() => this.composer?.setPrompt(text))
  }

  /** The prompt takes focus as the bar opens, but a collapsed bar must not steal it. */
  private focusPrompt(): void {
    if (this.collapsed) return
    void this.updateComplete.then(() => this.composer?.focus())
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('collapsed') && !this.collapsed) this.focusPrompt()
    if (
      this.autoAcceptEdits &&
      !this.busy &&
      !this.applying &&
      !this.error &&
      this.previews.length
    ) {
      this.accept(this.previews[0])
    }
  }

  reportApplyError(message: string, preview?: PreviewChangeView): void {
    if (preview && !this.isApplying(preview)) return
    this.activeApply = null
    this.applying = false
    this.applyError = message
    this.error = message
  }

  reportApplySuccess(preview: PreviewChangeView, change: ChangeView | null): void {
    if (!this.isApplying(preview)) return
    this.activeApply = null
    this.applying = false
    this.turns.acceptPreview(preview, change)
  }

  private isApplying(preview: PreviewChangeView): boolean {
    return (
      this.activeApply?.preview === preview && this.activeApply.sessionId === this.turns.sessionId
    )
  }

  /**
   * Escape puts the bar away rather than closing it.
   *
   * Escape means "get this out of my way", and the collapsed handle is that -
   * it keeps the conversation and the draft one click from coming back, where a
   * close would throw both away on a keystroke the user pressed while reaching
   * for something else in the note. Closing is the icon or the hotkey.
   */
  private onGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.isConnected) return
    event.preventDefault()
    event.stopPropagation()
    if (this.collapsed) this.close()
    else this.collapse()
  }

  /**
   * Close the bar with the same motion other panels close with.
   *
   * The element cannot simply be unmounted: the icon's pressed state and the
   * panel's width animation both assume a single frame between the decision and
   * the change, so an instant disappearance reads as a glitch next to the
   * sidebar sliding shut beside it.
   */
  private close(): void {
    if (this.closing) return
    this.closing = true
    const surface = this.shadowRoot?.querySelector<HTMLElement>('.panel, .handle')
    if (surface) void conceal(surface).then(() => this.dispatchClose())
    else this.dispatchClose()
  }

  private dispatchClose(): void {
    this.dispatchEvent(new CustomEvent('quick-ai-close', { bubbles: true, composed: true }))
  }

  private expand = (): void => {
    this.collapsed = false
    void this.updateComplete.then(() => this.composer?.focus())
  }

  private collapse = (): void => {
    this.collapsed = true
    // The app owns whether the bar is collapsed, so its AI icon can keep
    // meaning "close" rather than having to learn a third state.
    this.dispatchEvent(new CustomEvent('quick-ai-collapse', { bubbles: true, composed: true }))
  }

  private applyTurnState(turn: Readonly<TurnState>): void {
    this.busy = turn.busy || this.preparing
    this.error = turn.error ?? this.applyError
    this.status = turn.status ?? ''
    this.previews = turn.previews
    this.skipped = turn.skipped
    this.applied = turn.changes.map((change) => change.path)
    this.setReply(turn.reply ?? '')
  }

  /**
   * Keep the reply empty when the only thing the model said was "review the
   * suggested change". The card below already says that; repeating it in prose
   * puts a sentence above a button that does the same job.
   */
  private setReply(text: string): void {
    this.reply =
      this.previews.length && text === 'Review the suggested change before accepting it.'
        ? ''
        : text
  }

  /** What "Open full chat" carries across, with the exchange that produced it. */
  private handoff(): AiHandoff {
    return {
      sessionId: this.turns.sessionId,
      messages: this.turns.getState().messages.map((message) => ({
        role: message.role,
        content: message.text
      })),
      path: this.context.path,
      selection: this.context.selection?.text ?? null
    }
  }

  private send = async (event: Event): Promise<void> => {
    const detail = (event as CustomEvent<ComposerSendDetail>).detail
    if (!detail?.text.trim() || this.busy || this.applying) return
    const send = api()?.ai?.send
    if (!send) {
      this.error = 'The assistant is unavailable in this build.'
      return
    }
    const version = ++this.sendVersion
    const sessionId = this.turns.sessionId
    this.started = true
    this.preparing = true
    this.busy = true
    this.reply = ''
    this.error = ''
    this.applyError = ''
    this.status = ''
    this.previews = []
    this.skipped = []
    this.applied = []
    const prompt = detail.text.trim()
    /*
     * The same reach the panel has.
     *
     * The bar used to send an empty reference list and no open paths, so
     * "compare these two notes" had nothing to compare, the model could not tell
     * which files were already on screen, and a request to edit a second file
     * was refused because `previewOnly` was scoped to the open note alone.
     */
    try {
      const context = this.readContext?.() ?? this.context
      this.context = context
      this.proposalContext = context
      const selection = context.selection
      const references = await (context.collectReferences ?? collectReferences)(prompt)
      if (this.sendVersion !== version || this.turns.sessionId !== sessionId) return
      const input: AiSendInput = {
        // Every requested Markdown file arrives as a suggestion to review.
        previewOnly: true,
        sessionId,
        userText: prompt,
        document: context.path ? { path: context.path, content: context.content } : null,
        selection: selection?.text ?? null,
        references,
        attachments: detail.attachments,
        openPaths: context.openPaths ?? []
      }
      this.preparing = false
      stageAiHandoff(this.handoff())
      await this.turns.start(input)
    } catch (error) {
      if (this.sendVersion !== version) return
      this.error = error instanceof Error ? error.message : String(error)
      this.busy = false
    } finally {
      if (this.sendVersion === version) {
        this.preparing = false
        this.busy = this.turns.getState().busy
      }
    }
  }

  private stop = (): void => {
    this.sendVersion++
    this.preparing = false
    this.busy = false
    this.applying = false
    this.activeApply = null
    this.applyError = ''
    this.error = ''
    this.turns.cancel()
    this.turns.discardPreviews()
  }

  /**
   * Hand the conversation to the chat panel.
   *
   * The transcript is staged rather than sent in the event: the panel is mounted
   * after this bar is torn down, so an event fired on close arrives with nobody
   * listening.
   */
  private openChat = (): void => {
    stageAiHandoff(this.handoff())
    this.dispatchEvent(new CustomEvent('quick-ai-full-chat', { bubbles: true, composed: true }))
  }

  private accept(change: PreviewChangeView): void {
    if (this.applying) return
    this.applying = true
    this.activeApply = { preview: change, sessionId: this.turns.sessionId }
    this.dispatchEvent(
      new CustomEvent<{ change: PreviewChangeView; context: QuickAiContext }>('quick-ai-accept', {
        detail: { change, context: this.proposalContext ?? this.context },
        bubbles: true,
        composed: true
      })
    )
  }

  /** Which file a suggestion is for, in words rather than a path. */
  private changeLabel(change: PreviewChangeView): string {
    return displayName(change.path, this.context.path)
  }

  private renderReply(): TemplateResult | null {
    if (!this.reply) return null
    return html`<div class="reply">${unsafeHTML(md.render(this.reply))}</div>`
  }

  private renderOutput(): unknown {
    const reply = this.renderReply()
    const hasOutput =
      !!reply ||
      this.previews.length > 0 ||
      this.applied.length > 0 ||
      this.skipped.length > 0 ||
      !!this.error
    return html`
      <div class="bar-controls">
        <button
          class="icon-action"
          aria-label="Put the prompt bar away"
          title="Put the prompt bar away"
          @click=${this.collapse}
        >
          ${chromeIcon('arrow-down', 16)}
        </button>
        <button
          class="handoff"
          title="Open the conversation in the chat panel"
          @click=${this.openChat}
        >
          Open full chat
        </button>
      </div>
      ${
        hasOutput
          ? html`<div class="output" aria-live="polite">
              ${reply}
              ${(this.autoAcceptEdits ? [] : this.previews).map(
                (change) =>
                  html`<section
                    class="suggestion"
                    aria-label=${`Suggested edit to ${this.changeLabel(change)}`}
                  >
                    <div class="suggestion-label">
                      Suggested edit
                      <span class="suggestion-file">${this.changeLabel(change)}</span>
                    </div>
                    <div class="diff">
                      ${previewChanges(change.original, change.content).map(
                        (passage) => html`
                          ${passage.original ? html`<del>${passage.original}</del>` : null}
                          ${
                            passage.content
                              ? html`<div class="replacement">${passage.content}</div>`
                              : null
                          }
                        `
                      )}
                    </div>
                    <div class="actions">
                      <button
                        class="accept"
                        ?disabled=${this.applying}
                        @click=${() => this.accept(change)}
                      >
                        Accept
                      </button>
                      <button
                        class="discard"
                        ?disabled=${this.applying}
                        @click=${() => this.turns.discardPreviews()}
                      >
                        Discard
                      </button>
                    </div>
                  </section>`
              )}
              ${
                this.applied.length
                  ? html`<p class="applied" role="status">
                      ${
                        this.applied.length === 1
                          ? 'Changed'
                          : `Changed ${this.applied.length} files`
                      }:
                      ${this.applied.map((file) => displayName(file, this.context.path)).join(', ')}
                    </p>`
                  : null
              }
              ${this.skipped.map(
                (item) => html`<p class="skipped" role="status">${item.detail}</p>`
              )}
              ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : null}
            </div>`
          : null
      }
    `
  }

  /**
   * Collapse the bar to a handle without throwing away the conversation.
   *
   * Three exits for one surface, because they are three different intentions:
   * clicking away was never one of them. The icon or the hotkey closes it; this
   * only gets it out of the way, and the handle brings it back with the transcript
   * and the draft intact.
   */
  @property({ type: Boolean, reflect: true }) collapsed = false

  /**
   * A question to open with, left empty for the ordinary case.
   *
   * Explain and Summarize set it so one click asks the question. It is read once
   * on open rather than watched: the bar is torn down and rebuilt for each use,
   * so there is no later turn that would clear it.
   */
  @property({ type: String }) initialPrompt = ''

  /**
   * Everything stays mounted; collapsing hides it.
   *
   * The composer holds the draft, and unmounting it to collapse is how a
   * half-written question gets thrown away by a click on an arrow that was
   * supposed to be reversible. One tree, two presentations.
   */
  render(): unknown {
    const selected = this.context.selection
    return html`
      <button class="handle" ?hidden=${!this.collapsed} @click=${this.expand}>
        ${chromeIcon('ai', 16)}<span>Ask AI</span>
      </button>
      <section class="panel" role="dialog" aria-label="Ask AI" ?hidden=${this.collapsed}>
        ${this.renderOutput()}
        <writemd-ai-composer
          compact
          .modelPicker=${false}
          .placeholder=${
            selected
              ? 'Ask about your selection, / for skills…'
              : 'Ask about the whole text, / for skills…'
          }
          .busy=${this.busy || this.applying}
          .thinking=${this.busy}
          .thinkingStatus=${this.status}
          .hasSelection=${!!selected}
          .started=${this.started}
          @composer-send=${this.send}
          @composer-stop=${this.stop}
        ></writemd-ai-composer>
      </section>
    `
  }

  static styles = [
    aiActivityStyles,
    scrollbarStyles,
    controlStyles,
    css`
      :host {
        position: fixed;
        z-index: 800;
        left: var(--quick-ai-left, 0px);
        bottom: var(--quick-ai-bottom, 46px);
        width: var(--quick-ai-width, 100vw);
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        color: var(--text);
        font: 13px/1.5 var(--font-ui);
        /* Only the bar and its output take clicks; the document stays live. */
        pointer-events: none;
      }
      /* A prompt is not a page. Sized to a few words plus a reply, not to the editor's
         720px measure: at that width the bar read as a second header across the
         document rather than as a control sitting on it. */
      /* The collapsed handle is the same control, shrunk to the one row that has
         to stay reachable: the AI icon, and the fact that it is still holding a
         conversation. It sits exactly where the bar was, so nothing moves. */
      .handle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        align-self: center;
        min-height: 30px;
        padding: 0 12px 0 10px;
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-full);
        background: var(--bg-elevated);
        box-shadow: var(--shadow-2);
        color: var(--text-secondary);
        font: 12px var(--font-ui);
        cursor: pointer;
        pointer-events: auto;
        animation: quick-bar-in var(--motion-base) var(--motion-out);
      }
      .handle:hover {
        color: var(--text);
        border-color: var(--border);
      }
      .panel {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: min(520px, calc(100% - 64px));
        margin-inline: auto;
        min-height: 0;
        pointer-events: auto;
        animation: quick-bar-in var(--motion-base) var(--motion-out);
      }
      /* Collapsing and restoring both arrive through the same keyframe, so the
         bar never appears from a different direction than it left. */
      .panel:not([hidden]) {
        animation: quick-bar-in var(--motion-base) var(--motion-out);
      }
      /* One keyframe and one reduced-motion guard for every state the bar can be
         in, so entering, expanding and handing over all arrive the same way. */
      @keyframes quick-bar-in {
        from {
          opacity: 0;
          transform: translateY(var(--motion-reveal-shift)) scale(0.99);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      :host-context([data-motion='reduced']) .panel,
      :host-context([data-motion='reduced']) .handle {
        animation: none;
      }
      /* The hidden attribute has to beat the display values above, or
         collapsing does nothing. */
      .handle[hidden],
      .panel[hidden] {
        display: none;
      }
      .output {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: min(42vh, 380px);
        overflow: auto;
        overscroll-behavior: contain;
        padding: 8px 14px 12px;
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-lg);
        background: var(--bg-elevated);
        box-shadow: var(--shadow-3);
      }
      /* The bar's two exits - put it away, or go further - sit on one line
         above whatever the bar is showing, so both are reachable whether there
         is a reply yet or not. */
      .bar-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 0 2px;
      }
      /* A click-away scrim would tell the user the bar is modal. It is not: the
         document beside it stays live, so the row carries no surface of its own
         and the only chrome is the two controls. */
      .icon-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        border: none;
        border-radius: var(--radius-sm);
        background: none;
        color: var(--text-muted);
        cursor: pointer;
      }
      .icon-action:hover {
        background: var(--bg-hover);
        color: var(--text);
      }
      .reply {
        overflow-wrap: anywhere;
      }
      .reply > :first-child {
        margin-top: 0;
      }
      .reply > :last-child {
        margin-bottom: 0;
      }
      .reply p {
        margin: 0 0 8px;
      }
      .reply :is(h1, h2, h3, h4, h5, h6) {
        margin: 14px 0 4px;
        font-weight: 600;
        line-height: 1.35;
      }
      .reply h1 {
        font-size: 16px;
      }
      .reply h2 {
        font-size: 14px;
      }
      .reply :is(h3, h4, h5, h6) {
        font-size: 13px;
        color: var(--text-secondary);
      }
      .reply h1:first-child,
      .reply h2:first-child,
      .reply h3:first-child {
        margin-top: 0;
      }
      .reply :is(ul, ol) {
        margin: 0 0 8px;
        padding-left: 20px;
      }
      .reply li {
        margin: 2px 0;
      }
      .reply code {
        padding: 1px 4px;
        border-radius: var(--radius-sm);
        background: var(--bg-code);
        font: 12px/1.5 var(--font-mono);
      }
      .reply pre {
        margin: 0 0 8px;
        padding: 8px 10px;
        overflow: auto;
        border-radius: var(--radius-md);
        background: var(--bg-code);
      }
      .reply pre code {
        padding: 0;
        background: none;
      }
      .reply a {
        color: var(--accent);
      }
      .reply blockquote {
        margin: 0 0 8px;
        padding-left: 10px;
        border-left: 2px solid var(--border);
        color: var(--text-secondary);
      }
      .reply table {
        border-collapse: collapse;
      }
      .reply :is(th, td) {
        padding: 3px 8px;
        border: 1px solid var(--border-subtle);
      }
      /* A rule rather than a second box: the card around the reply is already the
         surface, and a bordered card inside it reads as a panel within a panel. */
      /* The card above the bar is the reply's surface. A suggested edit is one
         reply, so it takes that surface rather than boxing itself inside it -
         two nested panels read as a panel within a panel. */
      .suggestion {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      /* Which file the change is for, above what it changes. A suggestion can now
         target any note in the vault, and a diff with no filename on it is a
         diff the user cannot check before accepting. */
      .suggestion-label {
        display: flex;
        align-items: baseline;
        gap: 6px;
        color: var(--text-muted);
        font-size: 11px;
      }
      .suggestion-file {
        color: var(--text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .diff {
        display: grid;
        gap: 8px;
        max-height: 260px;
        overflow: auto;
      }
      del,
      .replacement {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      del {
        color: var(--text-muted);
        text-decoration-color: var(--danger);
      }
      .replacement {
        color: var(--text);
      }
      .actions {
        display: flex;
        gap: 8px;
      }
      .actions button {
        min-height: 28px;
        padding: 0 14px;
        border: 1px solid var(--border);
        border-radius: var(--radius-full);
        background: transparent;
        color: var(--text);
        font: inherit;
        cursor: pointer;
      }
      .actions button:hover {
        filter: brightness(1.08);
      }
      .actions .accept {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--accent-text);
      }
      .handoff {
        border: none;
        border-radius: var(--radius-sm);
        padding: 2px 6px;
        background: none;
        color: var(--text-muted);
        font: inherit;
        font-size: 11px;
        cursor: pointer;
      }
      .handoff:hover {
        background: var(--bg-hover);
        color: var(--text);
      }
      .applied,
      .skipped {
        margin: 0;
        color: var(--text-muted);
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .applied {
        color: var(--text-secondary);
      }
      .error {
        margin: 0;
        color: var(--danger);
        overflow-wrap: anywhere;
      }
      writemd-ai-composer {
        display: block;
        flex: 0 0 auto;
      }
      @media (max-height: 520px) {
        :host {
          --quick-ai-bottom: 38px;
        }
        .output {
          max-height: 34vh;
        }
      }
      @media (max-width: 560px) {
        .panel {
          width: calc(100% - 24px);
        }
      }
    `
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-ai-quick': QuickAi
  }
}
