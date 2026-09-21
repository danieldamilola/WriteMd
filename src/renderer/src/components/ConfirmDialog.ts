import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'

let confirmResolve: ((value: boolean) => void) | null = null

export function showConfirm(message: string, title = 'Confirm'): Promise<boolean> {
  let dialog = document.querySelector('writemd-confirm') as WriteMdConfirm
  if (!dialog) {
    dialog = document.createElement('writemd-confirm') as WriteMdConfirm
    document.body.appendChild(dialog)
  }
  dialog.titleText = title
  dialog.message = message
  dialog.open = true

  return new Promise((resolve) => {
    confirmResolve = resolve
  })
}

@customElement('writemd-confirm')
export class WriteMdConfirm extends LitElement {
  static styles = css`
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s ease;
    }
    .overlay.open {
      opacity: 1;
      pointer-events: auto;
    }
    .dialog {
      background: var(--bg-elevated, #212226);
      border: 1px solid var(--border, #333);
      border-radius: var(--radius-lg, 12px);
      padding: 24px;
      width: 320px;
      box-shadow: var(--shadow-3, 0 8px 24px rgba(0, 0, 0, 0.4));
      transform: translateY(10px);
      transition: transform 0.15s ease;
    }
    .overlay.open .dialog {
      transform: translateY(0);
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
  `

  @property({ type: Boolean }) open = false
  @property({ type: String }) titleText = 'Confirm'
  @property({ type: String }) message = ''

  private handleClose(result: boolean): void {
    this.open = false
    if (confirmResolve) {
      confirmResolve(result)
      confirmResolve = null
    }
  }

  render(): unknown {
    return html`
      <div class="overlay ${this.open ? 'open' : ''}">
        <div class="dialog">
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
