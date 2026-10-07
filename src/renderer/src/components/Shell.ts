import { css, html, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'

/** Layout only; file state, settings and editor instances belong to their owners. */
@customElement('writemd-shell')
export class Shell extends LitElement {
  @property({ type: Boolean, reflect: true }) vertical = true
  @property({ type: Boolean, reflect: true, attribute: 'settings-open' }) settingsOpen = false
  static styles = css`
    :host {
      display: grid;
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 0;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: var(--shell-header-height) minmax(0, 1fr);
    }
    :host([vertical]) {
      grid-template-columns: max-content minmax(0, 1fr);
    }
    slot {
      display: contents;
    }
    ::slotted([slot='header']) {
      grid-column: -2;
      grid-row: 1;
      z-index: 10;
    }
    :host([settings-open]) ::slotted([slot='header']) {
      grid-column: 1 / -1;
      margin-left: var(--shell-sidebar-width);
    }
    ::slotted([slot='rail']) {
      grid-column: 1;
      grid-row: 1 / -1;
    }
    ::slotted([slot='content']) {
      grid-column: -2;
      grid-row: 2;
      min-width: 0;
      min-height: 0;
    }
    ::slotted([slot='overlay']) {
      position: absolute;
      inset: 0;
    }
  `
  render(): unknown {
    return html`<slot name="rail"></slot><slot name="header"></slot><slot name="content"></slot
      ><slot name="overlay"></slot>`
  }
}
