import { css, html, LitElement } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { chromeIcon } from '../../design/icons'
import { controlStyles } from '../../design/controls'
import { menuCheck, menuStyles } from '../menu-styles'
import type { SessionView } from './types'
import '../ContextMenu'

@customElement('writemd-ai-history-picker')
export class AiHistoryPicker extends LitElement {
  @property({ attribute: false }) sessions: SessionView[] = []
  @property({ type: String }) currentId = ''
  @state() private open = false

  private toggle(event: MouseEvent): void {
    const trigger = event.currentTarget as HTMLButtonElement
    trigger.focus({ preventScroll: true })
    this.open = !this.open
  }

  private choose(id: string): void {
    this.open = false
    this.dispatchEvent(
      new CustomEvent<{ id: string }>('session-pick', {
        detail: { id },
        bubbles: true,
        composed: true
      })
    )
  }

  /**
   * Ask for a conversation to be deleted.
   *
   * The menu stays open: deleting one row and closing the whole list turns a
   * tidy-up of five old chats into five reopenings. The list is re-read by the
   * dock after the delete lands, so there is no local copy to keep in step.
   */
  private removeSession(id: string): void {
    this.dispatchEvent(
      new CustomEvent<{ id: string }>('session-delete', {
        detail: { id },
        bubbles: true,
        composed: true
      })
    )
  }

  render(): unknown {
    return html`
      <button
        class="icon"
        aria-label="Conversation history"
        title="Conversation history"
        aria-haspopup="menu"
        aria-expanded=${this.open}
        @click=${this.toggle}
      >
        ${chromeIcon('menu')}
      </button>
      ${
        this.open
          ? html`<writemd-context-menu
              .anchor=${this.shadowRoot?.querySelector<HTMLButtonElement>('.icon') ?? null}
              placement="bottom-end"
              @menu-dismiss=${() => {
                this.open = false
              }}
            >
              <div class="m-panel" aria-label="Conversation history">
                ${this.sessions.slice(0, 20).map(
                  (session) =>
                    html`<div class="row">
                      <button
                        class="m-item"
                        title=${session.title}
                        aria-current=${session.id === this.currentId ? 'true' : 'false'}
                        @click=${() => this.choose(session.id)}
                      >
                        <span class="label">${session.title}</span>
                        ${session.id === this.currentId ? menuCheck() : null}
                      </button>
                      <button
                        class="delete"
                        aria-label=${`Delete conversation: ${session.title}`}
                        title="Delete conversation"
                        @click=${() => this.removeSession(session.id)}
                      >
                        ${chromeIcon('x', 14)}
                      </button>
                    </div>`
                )}
                ${!this.sessions.length ? html`<div class="empty">No saved conversations</div>` : null}
              </div>
            </writemd-context-menu>`
          : null
      }
    `
  }

  static styles = [
    controlStyles,
    menuStyles,
    css`
      :host {
        display: inline-flex;
        flex-shrink: 0;
        font-family: var(--font-ui);
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
        cursor: pointer;
      }
      .icon:hover {
        background: var(--bg-hover);
        color: var(--text);
      }
      .icon:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: 2px;
      }
      .m-panel {
        min-width: min(220px, calc(100vw - 16px));
        width: min(220px, calc(100vw - 16px));
      }
      .m-item {
        width: 100%;
        border: 0;
        background: none;
        text-align: left;
        font-family: inherit;
      }
      /*
       * Delete sits beside the row rather than inside it. Nesting a button in a
       * button is invalid and, in a shadow list like this one, the click lands
       * on the outer row and opens the conversation the user meant to delete.
       */
      .row {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .row .m-item {
        flex: 1;
        min-width: 0;
      }
      .delete {
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
      .delete:hover {
        background: var(--danger-bg);
        color: var(--danger);
      }
      .delete:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: -2px;
      }
      .label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .empty {
        padding: 6px 10px;
        color: var(--text-muted);
        font-size: 12px;
      }
    `
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-ai-history-picker': AiHistoryPicker
  }
}
