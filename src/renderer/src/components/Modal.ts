import { css, html, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@awesome.me/webawesome/dist/components/dialog/dialog.js'

export function nativeModalAvailable(): boolean {
  return (
    typeof HTMLDialogElement !== 'undefined' &&
    typeof HTMLDialogElement.prototype.showModal === 'function'
  )
}

/** Web Awesome owns modal focus, background inertness and dismissal. */
@customElement('writemd-modal')
export class Modal extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }
    wa-dialog {
      --spacing: 0px;
      --width: max-content;
      --backdrop-filter: blur(4px);
      --show-duration: var(--motion-fast);
      --hide-duration: var(--motion-fast);
    }
    wa-dialog::part(dialog) {
      padding: 0;
      border: none;
      border-radius: var(--radius-lg);
      background: transparent;
      box-shadow: none;
      max-width: 100vw;
      max-height: 100vh;
    }
    wa-dialog::part(body) {
      padding: 0;
      display: flex;
      max-height: 100vh;
      min-height: 0;
    }
    wa-dialog.fullscreen::part(dialog) {
      width: 100vw;
      height: 100vh;
      max-height: 100vh;
      border-radius: 0;
    }
    wa-dialog.fullscreen::part(body) {
      height: 100%;
    }
    slot {
      display: contents;
    }
    :host-context([data-motion='reduced']) wa-dialog {
      --show-duration: 0ms;
      --hide-duration: 0ms;
    }
  `
  @property({ type: String }) label = 'Dialog'
  @property({ type: Boolean }) fullscreen = false
  @property({ type: Boolean }) dismissible = true
  private dismiss = (event: Event): void => {
    event.stopPropagation()
    if (!this.dismissible) {
      event.preventDefault()
      return
    }
    this.dispatchEvent(new CustomEvent('modal-dismiss', { bubbles: true, composed: true }))
  }
  render(): unknown {
    if (!nativeModalAvailable()) return html`<slot></slot>`
    return html`<wa-dialog
      open
      without-header
      .label=${this.label}
      ?light-dismiss=${this.dismissible}
      class=${this.fullscreen ? 'fullscreen' : ''}
      @wa-hide=${this.dismiss}
      ><slot></slot
    ></wa-dialog>`
  }
}
