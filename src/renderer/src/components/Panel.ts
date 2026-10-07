import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import './Background'
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
      border-radius: 0;
      isolation: isolate;
      background: var(--editor-surface);
      backdrop-filter: blur(var(--surface-blur, 0px));
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

  @property({ type: Boolean }) empty = false

  render(): unknown {
    return html`
      <writemd-background target="workspace" .empty=${this.empty}></writemd-background>
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
