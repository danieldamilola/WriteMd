import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ breaks: true, linkify: true })

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

  /** Keep the latest message visible above the pinned input. */
  updated(): void {
    const log = this.shadowRoot?.querySelector('.chat-log')
    if (log) log.scrollTop = log.scrollHeight
  }

  render(): unknown {
    if (!this.configured) {
      return html`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L9.5 8.5L3 11L9.5 13.5L12 20L14.5 13.5L21 11L14.5 8.5L12 2Z" />
          </svg>
          <p>AI Assistant is not configured yet.</p>
        </div>
      `
    }
    return html`
      <div
        style="padding: 16px; display: flex; flex-direction: column; flex: 1; min-height: 0; box-sizing: border-box; overflow: hidden; gap: 16px;"
      >
        <div
          class="chat-log"
          style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; font-family: var(--font-body); font-size: 14px; color: var(--text);"
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
            placeholder="Ask AI..."
            .disabled=${this.loading}
            style="width: 100%; padding: 12px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: var(--font-body); box-sizing: border-box; opacity: ${
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
