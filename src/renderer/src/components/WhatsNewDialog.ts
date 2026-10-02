import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { createDocumentMarkdownIt } from '../utils/markdown'

@customElement('writemd-whats-new')
export class WriteMdWhatsNew extends LitElement {
  static styles = css`
    .overlay {
      position: fixed;
      inset: 0;
      background: var(--scrim);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .dialog {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 24px;
      width: 520px;
      max-width: calc(100vw - 48px);
      max-height: 70vh;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-3);
    }
    h2 {
      margin: 0 0 12px 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
      flex-shrink: 0;
    }
    .notes {
      overflow-y: auto;
      user-select: text;
      font-size: 13px;
      line-height: 1.6;
      color: var(--text-secondary);
    }
    .notes h1,
    .notes h2,
    .notes h3 {
      color: var(--text);
      margin: 14px 0 6px;
      font-size: 14px;
    }
    .notes p {
      margin: 0 0 8px;
    }
    .notes ul {
      padding-left: 18px;
      margin: 0 0 8px;
    }
    .notes a {
      color: var(--accent);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 16px;
      flex-shrink: 0;
    }
    button {
      background: var(--accent);
      border: 1px solid var(--accent);
      color: var(--accent-text);
      padding: 6px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    button:hover {
      filter: brightness(1.1);
    }
  `

  @property({ type: Boolean }) open = false
  @property({ type: String }) version = ''
  @property({ type: String }) markdown = ''

  private md = createDocumentMarkdownIt()

  private close = (): void => {
    this.open = false
  }

  private handleOverlayKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.preventDefault()
      this.close()
    }
  }

  render(): unknown {
    if (!this.open) return html``
    return html`
      <div class="overlay" @click=${this.close} @keydown=${this.handleOverlayKeydown}>
        <div
          class="dialog"
          role="dialog"
          aria-modal="true"
          aria-label="What's new"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <h2>What's new in v${this.version}</h2>
          <div class="notes">${unsafeHTML(this.md.render(this.markdown))}</div>
          <div class="actions">
            <button @click=${this.close}>Done</button>
          </div>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-whats-new': WriteMdWhatsNew
  }
}
