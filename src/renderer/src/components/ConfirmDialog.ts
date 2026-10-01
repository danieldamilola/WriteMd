import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'

// One module-level slot cannot serve two overlapping prompts: the second call
// overwrites the first resolver and the first promise never settles, hanging
// whoever awaited it. A FIFO queue keeps every caller paired with its own
// answer, and a new prompt supersedes anything still queued behind it.
const pending: Array<(value: boolean) => void> = []

export function showConfirm(message: string, title = 'Confirm'): Promise<boolean> {
  const dialog = ensureDialog()

  return new Promise<boolean>((resolve) => {
    if (dialog.open) {
      // A prompt is already up. Settle the previous one as cancelled so its
      // caller resumes, then answer this one from the dialog that is showing.
      while (pending.length > 0) pending.shift()?.(false)
    } else {
      dialog.titleText = title
      dialog.message = message
      dialog.open = true
    }
    pending.push(resolve)
  })
}

function ensureDialog(): WriteMdConfirm {
  const existing = document.querySelector('writemd-confirm')
  if (existing) return existing as WriteMdConfirm
  const dialog = document.createElement('writemd-confirm') as WriteMdConfirm
  document.body.appendChild(dialog)
  return dialog
}

@customElement('writemd-confirm')
export class WriteMdConfirm extends LitElement {
  static styles = css`
    .overlay {
      position: fixed;
      inset: 0;
      background: var(--scrim, rgba(0, 0, 0, 0.5));
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .dialog {
      background: var(--bg-elevated, #212226);
      border: 1px solid var(--border, #333);
      border-radius: var(--radius-lg, 12px);
      padding: 24px;
      width: 320px;
      box-shadow: var(--shadow-3, 0 8px 24px rgba(0, 0, 0, 0.4));
    }
    h2 {
      margin: 0 0 12px 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text, #e8e8e8);
    }
    p {
      margin: 0 0 24px 0;
      font-size: 13px;
      color: var(--text-secondary, #a3a3a3);
      line-height: 1.5;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }
    button {
      background: transparent;
      border: 1px solid var(--border, #333);
      color: var(--text, #e8e8e8);
      padding: 6px 16px;
      border-radius: var(--radius-sm, 4px);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.15s;
    }
    button:hover {
      background: var(--bg-hover, #2d2d2d);
    }
    button.primary {
      background: var(--accent, #ffffff);
      border-color: var(--accent, #ffffff);
      color: var(--accent-text, #000000);
    }
    button.primary:hover {
      filter: brightness(1.1);
    }
    button:focus-visible {
      outline: 2px solid var(--border-focus, #4a9eff);
      outline-offset: 2px;
    }
  `

  @property({ type: Boolean }) open = false
  @property({ type: String }) titleText = 'Confirm'
  @property({ type: String }) message = ''

  private previouslyFocused: HTMLElement | null = null

  private handleClose(result: boolean): void {
    this.open = false
    // Answer whoever is actually waiting. A queue entry only lands here if the
    // dialog is open, so this cannot fire on a stale prompt.
    const resolve = pending.shift()
    if (resolve) resolve(result)
  }

  private handleKeydown = (e: KeyboardEvent): void => {
    if (!this.open) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.preventDefault()
      this.handleClose(false)
    }
  }

  private handleOverlayKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return
    const focusable = this.focusableButtons()
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = (this.shadowRoot as ShadowRoot | null)?.activeElement
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  private focusableButtons(): HTMLElement[] {
    return Array.from(this.renderRoot?.querySelectorAll<HTMLElement>('.actions button') ?? [])
  }

  protected updated(changed: Map<string, unknown>): void {
    super.updated(changed)
    if (!changed.has('open')) return
    if (this.open) {
      // Descend through shadow roots: document.activeElement only reports the
      // outermost host, and focusing that host restores nothing.
      let active: Element | null = document.activeElement
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
      this.previouslyFocused = (active as HTMLElement) ?? null
      // Focus the safe default so a stray Enter or Space does not confirm.
      this.focusableButtons()[0]?.focus()
    } else {
      // Restore focus to whatever opened the prompt, or drop it on the body so
      // a keyboard user is not left at the top of the document.
      const target = this.previouslyFocused
      this.previouslyFocused = null
      if (target?.isConnected) target.focus()
      else document.body?.focus()
    }
  }

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('keydown', this.handleKeydown, true)
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this.handleKeydown, true)
    super.disconnectedCallback()
  }

  render(): unknown {
    // Not rendered at all when closed. The element is cached on document.body
    // for the lifetime of the app, so a hidden-but-present dialog keeps its
    // buttons in the tab order forever.
    if (!this.open) return html``
    return html`
      <div class="overlay open" @keydown=${this.handleOverlayKeydown}>
        <div class="dialog" role="dialog" aria-modal="true" aria-label=${this.titleText}>
          <h2>${this.titleText}</h2>
          <p>${this.message}</p>
          <div class="actions">
            <button @click=${() => this.handleClose(false)}>Cancel</button>
            <button class="primary" @click=${() => this.handleClose(true)}>OK</button>
          </div>
        </div>
      </div>
    `
  }
}
