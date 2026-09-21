import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
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
      background: #141414;
      overflow: hidden;
      box-sizing: border-box;
      container-type: size;
    }

    /* 1px Gradient border */
    :host::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 10px;
      padding: 1px;
      background: linear-gradient(180deg, #282828 0%, #000000 100%);
      -webkit-mask:
        linear-gradient(#fff 0 0) content-box,
        linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
      z-index: 1;
    }

    .fade-bar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 49px;
      background: linear-gradient(180deg, #141414 76.4%, transparent 100%);
      z-index: 2;
      pointer-events: none;
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

  @property({ type: Boolean }) showFade = false

  render(): unknown {
    return html`
      ${this.showFade ? html`<div class="fade-bar"></div>` : ''}
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
