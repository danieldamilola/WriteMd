import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'

export type IconButtonSize = 'sm' | 'md'

@customElement('writemd-icon-button')
export class WriteMDIconButton extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 20px;
      padding: 1px 4px;
      border: none;
      background: none;
      border-radius: 5px;
      cursor: pointer;
      color: #737373;
      transition:
        background 120ms ease,
        color 120ms ease;
      box-sizing: border-box;
      -webkit-app-region: no-drag;
    }

    :host([size='md']) button {
      width: 28px;
      height: 28px;
      border-radius: 4px;
      padding: 0;
    }

    button:hover {
      background: rgba(255, 255, 255, 0.05);
      color: #d4d4d4;
    }

    :host([variant='close']) button:hover {
      background: #d32f2f;
      color: #ffffff;
    }

    ::slotted(svg) {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }

    :host([size='md']) ::slotted(svg) {
      width: 12px;
      height: 12px;
    }
  `

  @property({ type: String, reflect: true }) size: IconButtonSize = 'sm'
  @property({ type: String, reflect: true }) variant: 'default' | 'close' = 'default'
  @property({ type: String }) title = ''
  @property({ type: String, attribute: 'aria-label' }) ariaLabel = ''

  render(): unknown {
    return html`
      <button type="button" title="${this.title}" aria-label="${this.ariaLabel || this.title}">
        <slot></slot>
      </button>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-icon-button': WriteMDIconButton
  }
}
