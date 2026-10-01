import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { createChatMarkdownIt } from '../utils/markdown'
import { emit } from '../events/bus'
import { icon } from './icons'
import { scrollbarStyles } from './scrollbars'
import { createLinkInterceptor } from './extensions/safe-links'

// `html: false` is what makes the unsafeHTML below safe: raw markup in a model
// response is escaped rather than parsed. linkify only ever emits http/https/
// ftp/mailto, and clicks are intercepted, so none of it can navigate.
const md = createChatMarkdownIt()

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
  filePath?: string
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

    /*
     * The unconfigured state used to reuse .empty-state, which is declared in
     * Editor's shadow root and therefore never matched anything in here. With
     * no rule constraining the svg it filled the whole panel, which is what the
     * giant star was. Styles have to live in the shadow root that owns them.
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
      background: var(--bg-elevated);
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

    /* Without this the chat log falls back to the native Windows scrollbar,
       arrow buttons and all, which is what the panel showed. Shadow DOM blocks
       global rules, so each scrollable element opts in. */
    ${scrollbarStyles}
  `

  @property({ type: Boolean }) configured = false
  @property({ type: Array }) messages: AiMessage[] = []
  @property({ type: Boolean }) loading = false

  private submit(e: KeyboardEvent): void {
    if (e.key !== 'Enter') return
    const input = e.target as HTMLInputElement
    const text = input.value
    input.value = ''
    this.dispatchEvent(
      new CustomEvent('ai-submit', { detail: { text }, bubbles: true, composed: true })
    )
  }

  connectedCallback(): void {
    super.connectedCallback()
    // Model output can contain links, and the whole file under edit is pasted
    // into the prompt, so a URL from a malicious note can come back as a chat
    // link. Route clicks to the main process instead of navigating the window.
    this.addEventListener('click', this.interceptLinks, true)
  }

  disconnectedCallback(): void {
    this.removeEventListener('click', this.interceptLinks, true)
    super.disconnectedCallback()
  }

  // Capture phase: the rendered message markup lives in this element's shadow
  // root, and a bubble-phase handler could be pre-empted from below.
  private readonly interceptLinks = createLinkInterceptor(() => this.shadowRoot) as EventListener

  /** Keep the latest message visible above the pinned input. */
  updated(): void {
    const log = this.shadowRoot?.querySelector('.chat-log')
    if (log) log.scrollTop = log.scrollHeight
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
            Add an API key and pick a model, or point WriteMd at a local Ollama instance.
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
      <div
        style="padding: 16px; display: flex; flex-direction: column; flex: 1; min-height: 0; box-sizing: border-box; overflow: hidden; gap: 16px;"
      >
        <div
          class="chat-log"
          role="log"
          aria-live="polite"
          aria-label="Assistant conversation"
          style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; font-family: var(--font-mono); font-size: 14px; color: var(--text);"
        >
          <div style="display: flex; gap: 8px;">
            <div
              style="background: var(--bg-elevated); padding: 12px 16px; border-radius: 8px; border-bottom-left-radius: 2px;"
            >
              Hi! I'm your AI Assistant. I'm ready to help you write, brainstorm, or rephrase your
              document.
            </div>
          </div>

          ${this.messages.map(
            (m) => html`
              <div
                style="display: flex; gap: 8px; justify-content: ${
                  m.role === 'user' ? 'flex-end' : 'flex-start'
                }"
              >
                <div
                  style="background: var(${m.role === 'user' ? '--accent' : '--bg-elevated'}); color: var(${
                    m.role === 'user' ? '--accent-text' : '--text'
                  }); padding: 12px 16px; border-radius: 8px; border-bottom-${
                    m.role === 'user' ? 'right' : 'left'
                  }-radius: 2px; max-width: 85%; ${
                    m.role === 'user' ? 'white-space: pre-wrap;' : ''
                  } overflow-wrap: break-word;"
                >
                  ${m.role === 'assistant' ? unsafeHTML(md.render(m.content)) : m.content}
                </div>
              </div>
            `
          )}
          ${
            this.loading
              ? html`
                  <div style="display: flex; gap: 8px;">
                    <div
                      style="background: var(--bg-elevated); padding: 12px 16px; border-radius: 8px; border-bottom-left-radius: 2px; color: var(--text-secondary); font-style: italic;"
                    >
                      Thinking...
                    </div>
                  </div>
                `
              : ''
          }
        </div>
        <div style="flex-shrink: 0;">
          <input
            type="text"
            aria-label="Ask the AI assistant"
            placeholder="Ask AI..."
            .disabled=${this.loading}
            style="width: 100%; padding: 12px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: var(--font-mono); box-sizing: border-box; opacity: ${
              this.loading ? 0.5 : 1
            };"
            @keydown=${(e: KeyboardEvent) => this.submit(e)}
          />
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
