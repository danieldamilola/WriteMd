import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'

export type ButtonVariant = 'default' | 'vault' | 'icon'
export type ButtonWidth = 'auto' | '160' | '46' | 'full'

@customElement('writemd-button')
export class WriteMdButton extends LitElement {
  static styles = css`
    :host {
      display: inline-block;
      box-sizing: border-box;
    }

    .wrap {
      position: relative;
      border-radius: 5px;
      background: linear-gradient(180deg, #282828 0%, #000000 100%);
      padding: 1px;
      box-sizing: border-box;
      display: flex;
      width: 100%;
      height: 100%;
    }

    :host([width='160']) {
      width: 160px;
    }
    :host([width='46']) {
      width: 46px;
      flex: 0 0 46px;
    }
    :host([width='full']) {
      width: 100%;
    }

    button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      height: 44px;
      padding: 10px;
      background: #161616;
      border: none;
      border-radius: 4px;
      color: #ffffff;
      font-family: 'Geist Mono', monospace;
      font-size: 14px;
      line-height: 18px;
      cursor: pointer;
      box-sizing: border-box;
      user-select: none;
      transition: background 120ms ease;
    }

    button:hover {
      background: #1e1e1e;
    }

    button:active {
      background: #121212;
    }

    :host([variant='vault']) button {
      font-size: 16px;
      line-height: 21px;
    }

    ::slotted(svg) {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }

    .label {
      white-space: nowrap;
      overflow: hidden;
      -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
      mask-image: linear-gradient(to right, black 80%, transparent 100%);
    }
  `

  @property({ type: String, reflect: true }) variant: ButtonVariant = 'default'
  @property({ type: String, reflect: true }) width: ButtonWidth = 'auto'
  @property({ type: String }) label = ''

  render(): unknown {
    return html`
      <div class="wrap">
        <button type="button">
          <slot name="icon"></slot>
          ${this.label ? html`<span class="label">${this.label}</span>` : html`<slot></slot>`}
        </button>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-button': WriteMdButton
  }
}
