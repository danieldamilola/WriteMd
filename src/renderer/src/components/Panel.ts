import { html, css, LitElement } from 'lit'
import { customElement } from 'lit/decorators.js'
import { scrollbarStyles } from './scrollbars'

@customElement('writemd-panel')
export class WriteMdPanel extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
      min-height: 0;
      position: relative;
      border-radius: 10px;
      background: var(--bg-elevated);
      overflow: hidden;
      box-sizing: border-box;
      container-type: size;
    }

    .content {
      position: relative;
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      z-index: 3;
      overflow: auto;
    }
    ${scrollbarStyles}
  `

  render(): unknown {
    return html`
      <div class="content">
        <slot></slot>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-panel': WriteMdPanel
  }
}
