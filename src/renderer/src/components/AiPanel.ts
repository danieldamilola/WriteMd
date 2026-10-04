import { html, css, LitElement, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import './ThoughtLine'
import { createChatMarkdownIt } from '../utils/markdown'
import { emit } from '../events/bus'
import { icon } from './icons'
import { scrollbarStyles } from './scrollbars'
import { createLinkInterceptor } from './extensions/safe-links'
import { createStreamReveal } from '../utils/stream-reveal'
import { animateGlyph, glyphPath } from '../utils/glyph-morph'
import { api } from '../api'
import type { AttachedFile } from '../../../shared/electron-api'

// `html: false` is what makes the unsafeHTML below safe: raw markup in a model
// response is escaped rather than parsed. linkify only ever emits http/https/
// ftp/mailto, and clicks are intercepted, so none of it can navigate.
const md = createChatMarkdownIt()

/** How long the live line stays mounted after work finishes. Matches the CSS. */
const SETTLE_HOLD_MS = 420

const GREETING =
  "Hi! I'm your AI Assistant. I'm ready to help you write, brainstorm, or rephrase your document."

export interface AiMessage {
  role: 'user' | 'assistant' | 'thinking'
  content: string
  filePath?: string
  /**
   * Tenths of a second, for `role: 'thinking'`. The settled line is kept in the
   * scrollback so the elapsed time is still there after the live bubble goes.
   */
  elapsed?: number
  /** True while this assistant message is still arriving. Drives the reveal. */
  streaming?: boolean
  /**
   * Names of the files this prompt carried, for the transcript.
   *
   * Metadata only. The transcript persists to disk, and base64 image payloads
   * would put megabytes into every session file that referenced a screenshot.
   */
  attachments?: Array<{ name: string; kind: 'text' | 'image'; size: number }>
}

/**
 * Presentational AI chat panel. All state (messages, loading, configuration)
 * lives in the owner (`Editor`); this element only renders and re-emits input.
 */
@customElement('writemd-ai-panel')
export class AiPanel extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      min-width: 0;
    }

    .panel {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      box-sizing: border-box;
      overflow: hidden;
    }

    /*
     * Without this the chat log falls back to the native Windows scrollbar,
     * arrow buttons and all, which is what the panel showed. Shadow DOM blocks
     * global rules, so each scrollable element opts in.
     */
    ${scrollbarStyles}

    /* Ã¢â€â‚¬Ã¢â€â‚¬ transcript Ã¢â€â‚¬Ã¢â€â‚¬ */

    .chat-log {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      display: flex;
      flex-direction: column;
      font-family: var(--font-mono);
      font-size: 13px;
      line-height: 1.65;
      color: var(--text);
      /* The body sets user-select: none app-wide. An answer you cannot select is
         an answer you cannot quote, so both roles opt back in. */
      user-select: text;
    }

    /*
     * One rule per row rather than a first/last pair: the log is rebuilt from a
     * message array on every token, and a structural selector would have to
     * track which message happens to be first.
     */
    .row {
      display: flex;
      margin-top: 10px;
    }

    .row:first-child {
      margin-top: 0;
    }

    /*
     * The UA's hidden-attribute rule loses to a class selector on specificity,
     * so the live line that is held after a reply finished kept taking up a
     * row's worth of space at the bottom of the transcript.
     */
    .row[hidden] {
      display: none;
    }

    .row.user {
      justify-content: flex-end;
    }

    .bubble {
      min-width: 0;
      padding: 8px 12px;
      /* The squared corner points at the speaker: bottom-right for the prompt on
         the right, bottom-left for the answer on the left. */
      overflow-wrap: break-word;
    }

    .bubble.assistant {
      /* No surface. An answer is reading material, not a control, so it sits
         directly on the panel instead of inside a second rectangle. */
      background: none;
      border-radius: 0;
      padding: 4px 2px;
      max-width: 100%;
    }

    .bubble.user {
      /*
       * A pill, not a card.
       *
       * The prompt is one thing the person said, so it reads as a single object
       * of speech: fully rounded, hugging its text, no border. The earlier card
       * treatment gave it a squared corner and a hairline, which made a one-word
       * prompt look like a panel.
       *
       * The accent is a fill, not a border. A tinted hairline in the accent hue
       * put a coloured outline around ordinary prose, which is the one thing a
       * border should not do here; mixing the hue into the surface says the
       * same thing without drawing a line. Mixed toward the gutter rather than
       * toward transparent, so the result is the same depth on every theme
       * instead of a faint film on the light ones.
       */
      background: color-mix(
        in oklab,
        var(--accent) calc(var(--accent-wash-alpha) * 2.6),
        var(--bg-code)
      );
      color: var(--text);
      border-radius: 999px;
      max-width: 82%;
      /* The prompt is not markdown, so nothing else will turn a typed newline
         into a line break. */
      white-space: pre-wrap;
    }

    /*
     * A wrapped prompt softens its own corners.
     *
     * A 999px radius is "as round as this box can be", so on a three-line prompt
     * each end becomes a 40px semicircle and the first and last words get pushed
     * inward out of a usable column. The pill is right for one line, which is
     * the common case, and wrong past that. Set by measurement in the updated
     * hook, since whether a prompt wraps depends on the panel width and nothing
     * in CSS can see it.
     */
    .bubble.user[data-wrapped] {
      border-radius: 16px;
    }

    /*
     * markdown inside an answer. markdown-it emits bare tags and the shadow
     * root has no reset, so without these every list, block and fence in a
     * reply arrived with browser defaults: Times New Roman, no indent, a
     * transparent code block.
     */
    .prose > :first-child {
      margin-top: 0;
    }

    .prose > :last-child {
      margin-bottom: 0;
    }

    /* No pre-wrap: the chat markdown instance already runs with breaks on, so a
       single newline is a <br>. Adding pre-wrap on top renders it twice. */
    .prose p {
      margin: 0.55em 0;
    }

    /*
     * A step wide enough to see at 13px. At 1.08em a heading landed within a
     * pixel of the body size and read as a sentence that happened to be short;
     * the size is doing the work here, weight alone is not enough in a mono face.
     */
    .prose h1,
    .prose h2,
    .prose h3,
    .prose h4 {
      margin: 1em 0 0.4em;
      font-weight: 600;
      line-height: 1.35;
      color: var(--text);
    }

    .prose h1 {
      font-size: 1.35em;
      letter-spacing: -0.01em;
    }

    .prose h2 {
      font-size: 1.2em;
    }

    .prose h3 {
      font-size: 1.08em;
    }

    .prose h4 {
      font-size: 1em;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .prose ul,
    .prose ol {
      margin: 0.55em 0;
      padding-inline-start: 1.35em;
    }

    .prose li + li {
      margin-top: 0.25em;
    }

    .prose li > ul,
    .prose li > ol {
      margin: 0.25em 0;
    }

    .prose blockquote {
      margin: 0.6em 0;
      padding: 0.1em 0 0.1em 0.85em;
      border-left: 2px solid var(--border);
      color: var(--text-secondary);
    }

    .prose hr {
      margin: 0.9em 0;
      border: none;
      border-top: 1px solid var(--border-subtle);
    }

    .prose code {
      background: var(--bg-code);
      border-radius: 4px;
      padding: 0.1em 0.35em;
      font-size: 0.92em;
    }

    .prose pre {
      margin: 0.65em 0;
      padding: 9px 11px;
      background: var(--bg-code);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      overflow-x: auto;
      white-space: pre;
    }

    .prose pre code {
      background: none;
      padding: 0;
      font-size: 0.88em;
    }

    .prose table {
      margin: 0.65em 0;
      border-collapse: collapse;
      display: block;
      overflow-x: auto;
      max-width: 100%;
    }

    .prose th,
    .prose td {
      border: 1px solid var(--border-subtle);
      padding: 4px 9px;
      text-align: left;
    }

    .prose th {
      background: var(--bg-hover);
      font-weight: 600;
    }

    .prose a {
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .prose img {
      max-width: 100%;
    }

    /* Ã¢â€â‚¬Ã¢â€â‚¬ streaming reveal Ã¢â€â‚¬Ã¢â€â‚¬ */

    /*
     * The spans the streamedText directive creates live in this shadow root, so
     * the rules that animate them have to be declared here.
     */
    .stream {
      display: block;
    }

    .stream .stream-w {
      opacity: 0;
      filter: blur(1px);
      transition:
        opacity 350ms cubic-bezier(0.22, 1, 0.36, 1),
        filter 350ms cubic-bezier(0.22, 1, 0.36, 1);
    }

    .stream .stream-w.is-in {
      opacity: 1;
      filter: blur(0);
    }

    :host-context([data-motion='reduced']) {
      .stream .stream-w {
        opacity: 1;
        filter: none;
        transition: none;
      }
    }

    /* Files a sent prompt carried, listed above its text. */
    .ai-sent-files {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 5px;
    }

    .ai-sent-files:empty {
      display: none;
    }

    .ai-sent-file {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 100%;
      padding: 1px 6px;
      border-radius: 5px;
      background: var(--bg-hover);
      font-size: 11px;
      color: var(--text-muted);
    }

    .ai-sent-file svg {
      width: 10px;
      height: 10px;
      flex-shrink: 0;
    }

    .ai-sent-file span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Ã¢â€â‚¬Ã¢â€â‚¬ prompt bar Ã¢â€â‚¬Ã¢â€â‚¬ */

    /*
     * The composer is one raised card with the text field above a control row,
     * rather than a bordered strip with a send button beside it. The reference
     * this follows is react-bits' Prompt Bar, which is MIT + Commons Clause;
     * that forbids redistributing the component as a port, and WriteMd ships as
     * an installer, so the layout is rebuilt here on this project's own tokens.
     *
     * --bg-elevated is the panel's surface, so the bar needs a step off it to
     * read as a card rather than as a slightly different grey rectangle.
     */
    /*
     * No border at all, at rest or on focus.
     *
     * The bar is a raised surface on a raised panel, so the elevation alone
     * separates it. Outlining it drew a second edge just inside the panel's own,
     * and on focus that edge turned accent-coloured -- a coloured rectangle
     * wrapped around the thing the user is typing in, which is decoration with
     * no job. Focus is shown by the lift instead: a deeper shadow and a slightly
     * lighter surface.
     */
    .ai-composer {
      flex-shrink: 0;
      position: relative;
      border: none;
      border-radius: 14px;
      background: var(--bg-code);
      box-shadow: var(--shadow-1);
      transition:
        background 140ms ease,
        box-shadow 140ms ease;
    }

    .ai-composer:focus-within {
      background: var(--bg-elevated);
      box-shadow: var(--shadow-2);
    }

    .ai-composer[data-dragover] {
      background: var(--bg-elevated);
      box-shadow: var(--shadow-2), inset 0 0 0 1.5px var(--accent);
    }

    .ai-attachments {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 9px 12px 0;
    }

    .ai-attachments:empty {
      display: none;
    }

    .ai-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      max-width: 100%;
      height: 24px;
      padding: 0 4px 0 8px;
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-elevated);
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
    }

    .ai-chip svg {
      width: 12px;
      height: 12px;
      flex-shrink: 0;
      color: var(--text-muted);
    }

    .ai-chip-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ai-chip-drop {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 16px;
      height: 16px;
      padding: 0;
      border: none;
      border-radius: 4px;
      background: none;
      color: var(--text-muted);
      cursor: pointer;
    }

    .ai-chip-drop:hover {
      background: var(--bg-hover);
      color: var(--text);
    }

    .ai-chip-drop:focus-visible {
      outline: 1px solid var(--border-focus);
      outline-offset: 1px;
    }

    .ai-chip-drop svg {
      width: 9px;
      height: 9px;
      color: currentColor;
    }

    .ai-input {
      display: block;
      width: 100%;
      /*
     * The textarea is sized in JS from scrollHeight, and this is the ceiling that
     * stops a pasted document turning the bar into a wall. The number is the
     * textarea alone: the bar adds its own padding above and below, and the
     * e2e spec asserts the whole thing stays under 140px so a long prompt cannot
     * crowd out the transcript.
     */
      min-height: 46px;
      max-height: 116px;
      resize: none;
      border: none;
      background: none;
      padding: 12px 14px 4px;
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 13px;
      line-height: 20px;
      overflow-y: auto;
    }

    .ai-input:focus {
      outline: none;
    }

    .ai-input::placeholder {
      color: var(--text-muted);
    }

    .ai-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px 8px 8px;
    }

    .ai-tool {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      border-radius: 8px;
      background: none;
      color: var(--text-muted);
      cursor: pointer;
      transition:
        background 120ms ease,
        color 120ms ease,
        transform 100ms ease;
    }

    .ai-tool:hover {
      background: var(--bg-hover);
      color: var(--text);
    }

    .ai-tool:focus-visible {
      outline: 1px solid var(--border-focus);
      outline-offset: 1px;
    }

    .ai-tool[aria-expanded='true'] {
      background: var(--bg-active);
      color: var(--text);
    }

    .ai-tool svg {
      width: 15px;
      height: 15px;
      flex-shrink: 0;
    }

    /*
     * The model chip. A text button with the value and a chevron, which is what
     * makes it read as a choice rather than as a label.
     */
    .ai-chip-pick {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex: none;
      max-width: 46%;
      height: 28px;
      padding: 0 9px;
      border: none;
      border-radius: 8px;
      background: none;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: 12px;
      cursor: pointer;
      transition:
        background 120ms ease,
        color 120ms ease,
        transform 100ms ease;
    }

    .ai-chip-pick:hover {
      background: var(--bg-hover);
      color: var(--text);
    }

    .ai-chip-pick:focus-visible {
      outline: 1px solid var(--border-focus);
      outline-offset: 1px;
    }

    .ai-tool:active,
    .ai-chip-pick:active,
    .ai-send:active {
      transform: scale(0.94);
    }

    .ai-chip-pick[aria-expanded='true'] {
      background: var(--bg-active);
      color: var(--text);
    }

    .ai-chip-pick span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ai-chip-pick svg {
      width: 11px;
      height: 11px;
      flex-shrink: 0;
      color: var(--text-muted);
    }

    .ai-bar-spacer {
      flex: 1;
      min-width: 0;
    }

    /*
     * The send control is a tall pill, not a 24px square: at the width of this
     * bar a small square reads as an afterthought next to the chips.
     */
    .ai-send {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 30px;
      height: 34px;
      padding: 0;
      border: none;
      border-radius: 10px;
      background: var(--bg-active);
      color: var(--text-muted);
      cursor: pointer;
      transition:
        background 140ms ease,
        color 140ms ease,
        transform 100ms ease;
    }

    .ai-send svg {
      width: 15px;
      height: 15px;
    }

    /* Armed: there is something to send, so the pill takes the accent. */
    .ai-send[data-armed] {
      background: var(--accent);
      color: var(--accent-text);
    }

    .ai-send[data-armed]:hover {
      background: var(--accent-hover);
    }

    /* Busy: the pill is now a stop control, so it stays filled. */
    .ai-send[data-busy] {
      background: var(--accent);
      color: var(--accent-text);
    }

    .ai-send:focus-visible {
      outline: 1px solid var(--border-focus);
      outline-offset: 1px;
    }

    /* Ã¢â€â‚¬Ã¢â€â‚¬ popovers Ã¢â€â‚¬Ã¢â€â‚¬ */

    .ai-pop {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 6px;
      z-index: 30;
      width: 260px;
      max-height: 240px;
      overflow-y: auto;
      padding: 4px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--bg-elevated);
      box-shadow: var(--shadow-3);
      transform-origin: bottom left;
      animation: ai-pop-in var(--motion-fast) var(--motion-ease);
    }

    @keyframes ai-pop-in {
      from {
        opacity: 0;
        transform: translateY(4px) scale(0.97);
      }
    }

    :host-context([data-motion='reduced']) {
      .ai-pop {
        animation: none;
      }
    }

    .ai-pop-note {
      padding: 9px 10px;
      font-family: var(--font-mono);
      font-size: 11px;
      line-height: 1.5;
      color: var(--text-muted);
    }

    .ai-pop-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 8px;
      border: none;
      border-radius: 6px;
      background: none;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: 12px;
      text-align: left;
      cursor: pointer;
    }

    .ai-pop-item:hover {
      background: var(--bg-hover);
      color: var(--text);
    }

    .ai-pop-item:focus-visible {
      outline: 1px solid var(--border-focus);
      outline-offset: -1px;
    }

    .ai-pop-item svg {
      width: 12px;
      height: 12px;
      flex-shrink: 0;
      color: var(--text-muted);
    }

    .ai-pop-item span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ai-pop-item[aria-selected='true'] {
      color: var(--text);
    }

    .ai-pop-check {
      margin-left: auto;
      flex: none;
      width: 12px;
      height: 12px;
      color: var(--accent);
    }

    /* Ã¢â€â‚¬Ã¢â€â‚¬ unconfigured Ã¢â€â‚¬Ã¢â€â‚¬ */

    /*
     * This used to reuse .empty-state, which is declared in Editor's shadow root
     * and therefore never matched anything in here. With no rule constraining the
     * svg it filled the whole panel, which is what the giant star was. Styles
     * have to live in the shadow root that owns them.
     */
    .ai-empty {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 24px 28px;
      text-align: center;
      box-sizing: border-box;
    }

    .ai-empty-mark {
      width: 36px;
      height: 36px;
      color: var(--text-muted);
      opacity: 0.5;
      margin-bottom: 2px;
    }

    .ai-empty-title {
      margin: 0;
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
    }

    .ai-empty-body {
      margin: 0;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.6;
      color: var(--text-muted);
      max-width: 30ch;
    }

    .ai-empty-action {
      margin-top: 4px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 28px;
      padding: 0 12px;
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-card);
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: 12px;
      cursor: pointer;
      transition:
        background 120ms ease,
        color 120ms ease,
        border-color 120ms ease;
    }

    .ai-empty-action:hover {
      background: var(--bg-hover);
      color: var(--text);
      border-color: var(--border);
    }

    .ai-empty-action:focus-visible {
      outline: 1px solid var(--border-focus);
      outline-offset: 1px;
    }

    .ai-empty-action svg {
      width: 13px;
      height: 13px;
      flex-shrink: 0;
    }
  `

  @property({ type: Boolean }) configured = false
  @property({ type: Array }) messages: AiMessage[] = []
  @property({ type: Boolean }) loading = false
  /** Named on the composer chip, so the target of a send is always visible. */
  @property({ type: String }) model = ''
  /** Models the provider reports for this key. Drives the chip's popover. */
  @property({ type: Array }) models: string[] = []
  /** True while the model list is being fetched, so the popover can say so. */
  @property({ type: Boolean }) modelsLoading = false

  /**
   * The live line stays mounted briefly after `loading` goes false, otherwise it
   * is unmounted in the same cycle that `working` flips: it never re-renders, so
   * its settle event never fires and the elapsed time is lost.
   */
  @state() private settling = false
  private settleTimer: number | null = null

  /** What is in the textarea right now, so the send button can follow it. */
  @state() private draft = ''
  /** True while files are being dragged over the composer: CSS accent ring. */
  @state() private dragOver = false

  /**
   * Files attached to the next prompt.
   *
   * Owned by the editor, not by this panel: the editor runs the dialog and the
   * reads, so it holds the result and passes it down. One source of truth, and
   * the owner already has the files in hand when `ai-submit` arrives.
   */
  @property({ type: Array, attribute: false }) attachments: AttachedFile[] = []

  /**
   * Which popover is open, if any. Only one at a time.
   *
   * Not named `popover`: that is a native HTML property on HTMLElement, and a
   * private field shadowing it makes the class structurally incompatible with its
   * own base.
   */
  @state() private openMenu: 'model' | null = null

  /**
   * True while the owner is reading a chosen file.
   *
   * Set by the owner rather than awaited here: the reads cross the bridge and
   * can take a moment on a large image, and the plus button has to say so rather
   * than look inert.
   */
  @property({ type: Boolean }) attaching = false

  /** Ground answers with a keyless web search before sending to the model. */
  @property({ type: Boolean }) webSearch = false

  /**
   * Owns the word-by-word reveal for the one message that is still arriving.
   * A controller rather than a directive: a directive's update runs before its
   * output is committed, and this needs the DOM that update has just produced.
   */
  private readonly reveal = createStreamReveal()

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('loading') || this.loading) return
    // Only hold the live line if it was actually working. On mount `loading` is
    // assigned from its class default, which Lit reports as a change from
    // undefined; treating that as "just finished" put the panel straight into
    // the settle state and mounted a settled live line that reported itself.
    if (changed.get('loading') !== true) return
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer)
    this.settling = true
    this.settleTimer = window.setTimeout(() => {
      this.settling = false
      this.settleTimer = null
    }, SETTLE_HOLD_MS)
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLTextAreaElement
    this.draft = el.value
    this.autoGrow(el)
  }

  /** The textarea has no rows to grow from; its height comes from content. */
  private autoGrow(el: HTMLTextAreaElement): void {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  /**
   * Hand the prompt, and anything attached, to the owner.
   *
   * Attachments clear here rather than after the send resolves: the user has
   * committed them by hitting Enter, and holding them through a 30-second reply
   * would re-attach the same screenshot to the next question.
   */
  private send(text: string): void {
    if (this.loading) return
    // An attachment alone is a valid prompt: a screenshot with no words is the
    // most common single-image question.
    if (!text.trim() && this.attachments.length === 0) return
    this.draft = ''
    this.openMenu = null
    // `attachments` is not cleared here. It is the owner's array, and the owner
    // clears it when it handles this event, which is the same moment it stops
    // needing the files.
    this.dispatchEvent(
      new CustomEvent('ai-submit', {
        detail: { text: text.trim(), attachments: this.attachments },
        bubbles: true,
        composed: true
      })
    )
  }

  /** True when there is something worth sending. */
  private get armed(): boolean {
    return this.loading || this.draft.trim().length > 0 || this.attachments.length > 0
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Escape closes a popover before it does anything else; the reference bar
    // behaves the same way.
    if (e.key === 'Escape' && this.openMenu) {
      e.preventDefault()
      e.stopPropagation()
      this.openMenu = null
      return
    }
    // Enter closes an open list rather than sending past it. The list is a
    // picker, not a filter box, so there is no query for Enter to commit.
    if (this.openMenu) return
    if (e.key !== 'Enter' || e.shiftKey) return
    // While an IME candidate is up, Enter is accepting the candidate, not
    // sending a prompt made of half-typed pinyin.
    if (e.isComposing) return
    e.preventDefault()
    const el = e.target as HTMLTextAreaElement
    this.send(el.value)
    el.value = ''
    el.style.height = 'auto'
  }

  private onSendClick(): void {
    if (this.loading) {
      this.dispatchEvent(new CustomEvent('ai-cancel', { bubbles: true, composed: true }))
      return
    }
    const el = this.shadowRoot?.querySelector<HTMLTextAreaElement>('.ai-input')
    if (!el) return
    this.send(el.value)
    el.value = ''
    el.style.height = 'auto'
    el.focus()
  }

  /**
   * Ask the owner to attach files.
   *
   * The panel holds no filesystem access of its own: it raises the intent and
   * the owner runs the dialog and the reads, which keeps every path crossing
   * the bridge in one place.
   */
  private requestAttach(): void {
    this.dispatchEvent(new CustomEvent('ai-attach-request', { bubbles: true, composed: true }))
  }

  /** Drop one attachment. The owner owns the list, so this only asks. */
  private removeAttachment(path: string): void {
    this.dispatchEvent(
      new CustomEvent('ai-attach-remove', {
        detail: { path },
        bubbles: true,
        composed: true
      })
    )
  }

  /** Files dropped on the composer attach to the next prompt, like the dialog. */
  private onComposerDragOver(e: DragEvent): void {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    this.dragOver = true
  }

  private onComposerDragLeave(e: DragEvent): void {
    // dragleave fires for every child; only clear when leaving the composer.
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      this.dragOver = false
    }
  }

  private onComposerDrop(e: DragEvent): void {
    e.preventDefault()
    this.dragOver = false
    const electron = api()
    if (!electron || this.loading) return
    const paths: string[] = []
    for (const file of e.dataTransfer?.files ?? []) {
      const p = electron.file.getPathForFile(file)
      if (p) paths.push(p)
    }
    if (paths.length > 0) {
      this.dispatchEvent(
        new CustomEvent('ai-attach-files', {
          detail: { paths },
          bubbles: true,
          composed: true
        })
      )
    }
  }

  private pickModel(model: string): void {
    this.openMenu = null
    this.dispatchEvent(
      new CustomEvent('ai-model-change', {
        detail: { model },
        bubbles: true,
        composed: true
      })
    )
  }

  /**
   * Mark every user prompt that took more than one line.
   *
   * Whether a prompt wraps depends on the panel's width, the text, and the font
   * actually loaded, so it has to be measured. Comparing the rendered height
   * against a single line's height avoids re-implementing any of that: the
   * comparison is done in layout, by the same engine that will draw it.
   *
   * The attribute is set imperatively rather than in the template because the
   * template cannot know it. Lit re-renders only the parts it owns, and an
   * attribute it never wrote is left alone between renders.
   */
  private markWrappedBubbles(): void {
    const bubbles = this.shadowRoot?.querySelectorAll<HTMLElement>('.bubble.user') ?? []
    for (const bubble of bubbles) {
      // The bubble's own height, less its padding, is the text's height: one
      // line of 13px text at 1.65 is ~21px, so anything past 30px wrapped. A
      // bubble holding only attachment chips measures short and is correctly
      // treated as a single line.
      const cs = getComputedStyle(bubble)
      const inner = bubble.offsetHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      // Skipped when there is no layout to measure, which is jsdom: there the
      // height is zero, and the comparison would otherwise quietly mark every
      // prompt as unwrapped.
      if (bubble.offsetHeight === 0) continue
      if (inner > 30) bubble.setAttribute('data-wrapped', '')
      else bubble.removeAttribute('data-wrapped')
    }
  }

  /**
   * Move the send glyph between the arrow and the stop square.
   *
   * Driven from `updated` rather than by a CSS transition because `d` is not an
   * interpolatable property: the browser cannot morph one path into another on
   * its own, so each frame recomputes the outline.
   */
  private morphGlyph(busy: boolean): void {
    const path = this.shadowRoot?.querySelector<SVGPathElement>('.ai-send-glyph')
    if (!path) return
    this.stopMorph?.()
    this.stopMorph = animateGlyph(busy, (t) => path.setAttribute('d', glyphPath(t)))
  }

  private stopMorph: (() => void) | null = null

  /** Assistant prose: the reveal controller wraps whatever is in the box. */
  private assistantBody(m: AiMessage): unknown {
    // A settled message has no box, so it renders as plain markdown.
    return unsafeHTML(
      m.streaming ? `<span class="stream">${md.render(m.content)}</span>` : md.render(m.content)
    )
  }

  private renderMessage(m: AiMessage): unknown {
    if (m.role === 'thinking') {
      return html`
        <div class="row">
          <!-- Property binding, not the boolean-attribute form: a persisted entry
               is settled, and leaving the reflected attribute absent would keep
               the property at its true default, so the line would start
               counting. -->
          <writemd-thought-line
            .working=${false}
            .elapsed=${m.elapsed ?? 0}
            label=${m.content || 'Thinking'}
          ></writemd-thought-line>
        </div>
      `
    }
    const user = m.role === 'user'
    /*
     * One line, no interior whitespace, on purpose.
     *
     * A user prompt is rendered with `white-space: pre-wrap` so the newlines
     * somebody typed survive. Lit keeps the whitespace inside a template literal
     * as real text nodes, so an indented multi-line template turned its own
     * indentation into message content: one word rendered as six blank lines
     * plus eighteen leading spaces, and the bubble grew to fit them. Anything
     * between the tags here is content, not formatting.
     */
    // prettier-ignore
    return html`<div class="row ${user ? 'user' : ''}"><div
        class="bubble ${user ? 'user' : 'assistant'}"
      >${user ? this.userBody(m) : html`<div class="prose">${this.assistantBody(m)}</div>`}</div></div>`
  }

  /** The inside of a user bubble: any attached files, then the prompt. */
  private userBody(m: AiMessage): unknown {
    if (!m.attachments || m.attachments.length === 0) return m.content
    // prettier-ignore
    return html`<div class="ai-sent-files">${m.attachments.map(
      (f) =>
        html`<span class="ai-sent-file"
          >${icon(f.kind === 'image' ? 'eye' : 'file', 11)}<span>${f.name}</span></span
        >`
    )}</div>${m.content}`
  }

  // Capture phase: the rendered message markup lives in this element's shadow
  // root, and a bubble-phase handler could be pre-empted from below.
  private readonly interceptLinks = createLinkInterceptor(() => this.shadowRoot) as EventListener

  connectedCallback(): void {
    super.connectedCallback()
    // Model output can contain links, and the whole file under edit is pasted
    // into the prompt, so a URL from a malicious note can come back as a chat
    // link. Route clicks to the main process instead of navigating the window.
    this.addEventListener('click', this.interceptLinks, true)
    document.addEventListener('pointerdown', this.onPointerDown, true)
  }

  override disconnectedCallback(): void {
    this.removeEventListener('click', this.interceptLinks, true)
    document.removeEventListener('pointerdown', this.onPointerDown, true)
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer)
    this.settleTimer = null
    // The message it was revealing is going away with the panel; leaving the
    // timer running would tick against a detached tree.
    this.reveal.reset()
    this.stopMorph?.()
    super.disconnectedCallback()
  }

  /**
   * Click outside closes the model list, and Escape closes it from the keyboard.
   *
   * Capture phase on the document, so a click that also lands on a chip is
   * caught before that chip's own handler decides to open something.
   */
  private readonly onPointerDown = (e: Event): void => {
    if (!this.openMenu) return
    const inside = e
      .composedPath()
      .some(
        (n) =>
          n instanceof Element &&
          (n.classList.contains('ai-pop') || n.classList.contains('ai-chip-pick'))
      )
    if (!inside) this.openMenu = null
  }

  protected override firstUpdated(): void {
    // From here on the glyph is in the DOM, so every later morph has something
    // to write into.
    this.morphGlyph(this.loading)
  }

  protected override updated(changed: PropertyValues<this>): void {
    // Only one message streams at a time, so there is at most one box. Passing
    // null resets the reveal, which is what ends it when the reply settles.
    this.reveal.sync(this.shadowRoot?.querySelector('.stream') ?? null)
    const log = this.shadowRoot?.querySelector('.chat-log')
    if (log) log.scrollTop = log.scrollHeight
    if (changed.has('messages') || changed.size === 1) this.markWrappedBubbles()
    // In `updated`, not `willUpdate`: the morph writes to the path element, and
    // `willUpdate` runs before this cycle's output is committed.
    if (changed.has('loading') && changed.get('loading') !== undefined) {
      this.morphGlyph(this.loading)
    }
  }

  render(): unknown {
    if (!this.configured) {
      // No decoration without function: the mark is the panel's own glyph at a
      // fixed size, and the single action is what actually resolves the state.
      return html`
        <div class="ai-empty" role="status">
          <span class="ai-empty-mark">${icon('sparkle', 36)}</span>
          <p class="ai-empty-title">No assistant selected</p>
          <p class="ai-empty-body">
            Add an API key and pick a model, use local Ollama, or select the opencode CLI.
          </p>
          <button
            class="ai-empty-action"
            type="button"
            @click=${() => emit('settings:open', { tab: 'ai' })}
          >
            ${icon('sliders', 13)} Configure
          </button>
        </div>
      `
    }
    return html`
      <div class="panel">
        <div class="chat-log" role="log" aria-live="polite" aria-label="Assistant conversation">
          <div class="row">
            <div class="bubble assistant">${GREETING}</div>
          </div>

          ${this.messages.map((m) => this.renderMessage(m))}
          ${
            this.loading || this.settling
              ? html`
                  <!-- Hidden, not unmounted, once work is over: the persisted
                       entry above already shows the elapsed time, and the live
                       line has to stay in the tree long enough to fire its
                       settle event. -->
                  <div class="row" ?hidden=${this.settling}>
                    <writemd-thought-line ?working=${this.loading}></writemd-thought-line>
                  </div>
                `
              : ''
          }
        </div>
        <div
          class="ai-composer"
          ?data-dragover=${this.dragOver}
          @dragover=${(e: DragEvent) => this.onComposerDragOver(e)}
          @dragleave=${(e: DragEvent) => this.onComposerDragLeave(e)}
          @drop=${(e: DragEvent) => this.onComposerDrop(e)}
        >
          ${
            this.attachments.length > 0
              ? html`
                  <div class="ai-attachments">
                    ${this.attachments.map(
                      (f) => html`
                        <span class="ai-chip">
                          ${icon(f.kind === 'image' ? 'eye' : 'file', 12)}
                          <span class="ai-chip-name">${f.name}</span>
                          <button
                            class="ai-chip-drop"
                            type="button"
                            aria-label=${`Remove ${f.name}`}
                            @click=${() => this.removeAttachment(f.path)}
                          >
                            ${icon('x', 9)}
                          </button>
                        </span>
                      `
                    )}
                  </div>
                `
              : ''
          }

          <textarea
            class="ai-input"
            rows="1"
            aria-label="Ask the AI assistant"
            placeholder="Ask anything"
            .value=${this.draft}
            .disabled=${this.loading}
            @input=${(e: Event) => this.onInput(e)}
            @keydown=${(e: KeyboardEvent) => this.onKeyDown(e)}
          ></textarea>

          <div class="ai-bar">
            <button
              class="ai-tool"
              type="button"
              aria-label="Attach files"
              title="Attach files"
              ?disabled=${this.loading || this.attaching}
              @click=${() => this.requestAttach()}
            >
              ${icon(this.attaching ? 'clock' : 'plus', 15)}
            </button>

            <button
              class="ai-tool"
              type="button"
              aria-label="Search the web"
              aria-pressed=${this.webSearch}
              title=${this.webSearch ? 'Web search on' : 'Web search off'}
              style=${this.webSearch ? 'color: var(--accent);' : ''}
              @click=${() => {
                this.dispatchEvent(
                  new CustomEvent('ai-websearch-toggle', { bubbles: true, composed: true })
                )
              }}
            >
              ${icon('globe', 15)}
            </button>

            <button
              class="ai-chip-pick"
              type="button"
              aria-label="Choose model"
              aria-haspopup="listbox"
              aria-expanded=${this.openMenu === 'model'}
              @click=${() => {
                this.openMenu = this.openMenu === 'model' ? null : 'model'
              }}
            >
              <span>${this.model || 'No model selected'}</span>
              ${icon('chevron-down', 11)}
            </button>

            <span class="ai-bar-spacer"></span>

            <button
              class="ai-send"
              type="button"
              aria-label=${this.loading ? 'Stop' : 'Send'}
              ?data-armed=${this.armed && !this.loading}
              ?data-busy=${this.loading}
              @click=${() => this.onSendClick()}
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="currentColor"
                stroke-width="2"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <!-- The class is on the path, which is the element the morph
                     rewrites every frame. -->
                <path class="ai-send-glyph" d=${glyphPath(0)}></path>
              </svg>
            </button>
          </div>

          ${
            this.openMenu === 'model'
              ? html`
                  <div class="ai-pop" role="listbox" aria-label="Choose model">
                    ${
                      this.modelsLoading
                        ? html`<div class="ai-pop-note">Loading models...</div>`
                        : this.models.length === 0
                          ? html`<div class="ai-pop-note">
                              No models available. Add a key in Settings.
                            </div>`
                          : this.models.map(
                              (m) => html`
                                <button
                                  class="ai-pop-item"
                                  type="button"
                                  role="option"
                                  aria-selected=${m === this.model}
                                  @click=${() => this.pickModel(m)}
                                >
                                  <span>${m}</span>
                                  ${m === this.model ? icon('check', 12) : ''}
                                </button>
                              `
                            )
                    }
                  </div>
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
    'writemd-ai-panel': AiPanel
  }
}
