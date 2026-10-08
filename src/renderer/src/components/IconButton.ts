import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'

export type IconButtonSize = 'sm' | 'md' | 'caption'

@customElement('writemd-icon-button')
export class WriteMdIconButton extends LitElement {
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
      color: var(--text-muted);
      transition:
        background var(--motion-fast) var(--motion-ease),
        color var(--motion-fast) var(--motion-ease),
        transform var(--motion-instant) var(--motion-ease);
      box-sizing: border-box;
      -webkit-app-region: no-drag;
    }

    /*
     * A press is a scale, not another colour. The same 0.985 the app's motion
     * tokens define, so every control answers a click the same way. Written as
     * a transform rather than a filter so it stays on the compositor.
     */
    button:active {
      transform: scale(var(--motion-press-scale));
    }

    :host-context([data-motion='reduced']) button {
      transition:
        background var(--motion-fast) var(--motion-ease),
        color var(--motion-fast) var(--motion-ease);
    }

    :host-context([data-motion='reduced']) button:active {
      transform: none;
    }

    :host([size='md']) button {
      width: 28px;
      height: 28px;
      border-radius: 4px;
      padding: 0;
    }

    :host([size='caption']) button {
      width: var(--caption-button-width);
      height: 100%;
      min-height: 32px;
      border-radius: 0;
      padding: 0;
    }

    button:hover {
      background: var(--bg-hover);
      color: var(--text);
    }

    :host([variant='close']) button:hover {
      background: var(--danger);
      color: var(--text);
    }

    :host([size='caption']) button:hover {
      background: var(--bg-hover);
      color: var(--text);
    }

    :host([size='caption'][variant='close']) button:hover {
      background: var(--danger);
      color: var(--text);
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

    :host([size='caption']) {
      align-self: stretch;
    }

    :host([size='caption']) ::slotted(svg) {
      width: 10px;
      height: 10px;
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
    'writemd-icon-button': WriteMdIconButton
  }
}
