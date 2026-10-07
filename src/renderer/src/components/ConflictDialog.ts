import './Modal'
import { nativeModalAvailable } from './Modal'
import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { FileState, ConflictInfo } from '../state/file-state'

@customElement('writemd-conflict-dialog')
export class ConflictDialog extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 400;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--scrim, rgba(0, 0, 0, 0.65));
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      animation: fadeIn var(--motion-fast) var(--motion-ease-out);
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .dialog-box {
      width: min(520px, 92vw);
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg, 12px);
      box-shadow: var(--shadow-3);
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-sizing: border-box;
      animation: slideUp var(--motion-base) var(--motion-ease-out);
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(8px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .icon-wrap {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: rgba(224, 122, 95, 0.15);
      color: var(--warning, #e07a5f);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .icon-wrap svg {
      width: 20px;
      height: 20px;
    }

    .header-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
    }

    .subtitle {
      font-size: 12px;
      color: var(--text-muted);
    }

    .file-badge {
      font-family: var(--font-mono, monospace);
      font-size: 12px;
      color: var(--text-secondary);
      background: var(--bg);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm, 4px);
      padding: 8px 12px;
      word-break: break-all;
    }

    .message {
      font-size: 13px;
      line-height: 1.5;
      color: var(--text-secondary);
    }

    .actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 8px;
      padding-top: 16px;
      border-top: 1px solid var(--border-subtle);
    }

    .btn {
      padding: 8px 14px;
      border-radius: var(--radius-sm, 6px);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition:
        background var(--transition-fast),
        border-color var(--transition-fast);
      user-select: none;
    }

    /* Suppressing the outline without a replacement made all three buttons
       invisible to keyboard focus. Only drop it for pointer interaction. */
    .btn:focus:not(:focus-visible) {
      outline: none;
    }

    .btn:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
    }

    .btn-secondary {
      background: var(--bg-hover);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .btn-secondary:hover {
      background: var(--bg-active);
      border-color: var(--border-focus);
    }

    .btn-primary {
      background: var(--accent);
      color: var(--accent-text, #ffffff);
      border: 1px solid transparent;
    }

    .btn-primary:hover {
      background: var(--accent-hover);
    }

    .btn-subtle {
      background: transparent;
      color: var(--text-muted);
      border: 1px solid transparent;
      margin-right: auto;
    }

    .btn-subtle:hover {
      color: var(--danger, #f87171);
      background: var(--bg-hover);
    }
  `

  @property({ type: Object }) conflict: ConflictInfo | null = null

  private fileState = FileState.getInstance()

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('keydown', this.handleKeyDown, true)
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this.handleKeyDown, true)
    super.disconnectedCallback()
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (nativeModalAvailable()) return
    if (!this.conflict) return
    if (e.key === 'Escape') {
      e.preventDefault()
      // Capture phase, and stop propagation: App and SettingsModal each attach
      // their own Escape handler to window. A sibling listener on the same
      // target cannot be stopped by stopPropagation, only by
      // stopImmediatePropagation, so without this one Escape could resolve the
      // conflict and close a modal behind it.
      e.stopImmediatePropagation()
      this.fileState.resolveConflictDismiss()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopImmediatePropagation()
      this.fileState.resolveConflictReview()
    } else if (e.key === 'Tab') {
      if (!nativeModalAvailable()) this.trapFocus(e)
    }
  }

  /** Keep Tab inside the dialog: the document behind it is not inert. */
  private trapFocus(e: KeyboardEvent): void {
    const buttons = Array.from(
      this.renderRoot?.querySelectorAll<HTMLElement>('.actions button') ?? []
    )
    if (buttons.length === 0) return
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    const active = (this.shadowRoot as ShadowRoot | null)?.activeElement
    if (e.shiftKey && (active === first || !active)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  firstUpdated(): void {
    // Focus the safe default so Enter does not fire the destructive choice by
    // accident. The global Enter handler is what actually resolves it.
    this.renderRoot?.querySelector<HTMLElement>('.btn-secondary')?.focus()
  }

  private handleReview = (): void => {
    this.fileState.resolveConflictReview()
  }

  private handleReload = (): void => {
    this.fileState.resolveConflictReload()
  }

  private handleDismiss = (): void => {
    this.fileState.resolveConflictDismiss()
  }

  render(): unknown {
    const fileName = this.conflict?.path.replace(/\\/g, '/').split('/').pop() ?? 'Document'

    return html`
      <writemd-modal label="Conflict Detected" @modal-dismiss=${this.handleDismiss}>
        <div
          class="dialog-box"
          role="dialog"
          aria-modal="true"
          aria-label="Conflict Detected"
          @click=${(e: MouseEvent) => e.stopPropagation()}
        >
          <div class="dialog-header">
            <div class="icon-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div class="header-text">
              <span class="title">File Modified Externally</span>
              <span class="subtitle">External changes conflict with unsaved local edits</span>
            </div>
          </div>

          <div class="file-badge">${this.conflict?.path ?? ''}</div>

          <div class="message" aria-live="assertive">
            <strong>${fileName}</strong> has been modified on disk by another application while you
            have unsaved changes. Review the differences in Split View to resolve changes.
          </div>

          <div class="actions">
            <button
              class="btn btn-subtle"
              @click=${this.handleReload}
              title="Discard local edits and reload disk version"
            >
              Overwrite Local
            </button>
            <button class="btn btn-secondary" @click=${this.handleDismiss}>Keep Local</button>
            <button class="btn btn-primary" @click=${this.handleReview}>
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <line x1="8" y1="2" x2="8" y2="14" />
              </svg>
              Review in Split View
            </button>
          </div>
        </div>
      </writemd-modal>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-conflict-dialog': ConflictDialog
  }
}
