import { css, html, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@awesome.me/webawesome/dist/components/popup/popup.js'
import { emit, on } from '../events/bus'
import { closeSurface } from '../utils/motion'

/** Shared anchored cards. Contents keep their native input and button semantics. */
@customElement('writemd-popover')
export class Popover extends LitElement {
  @property({ attribute: false }) anchor: HTMLElement | null = null
  @property() placement = 'right-start'
  @property() label = ''
  @property({ type: Boolean }) autoFocus = true
  private unsubscribe?: () => void
  private restoreFocus = false
  private focused = false
  private closing = false
  static styles = css`
    :host {
      display: contents;
    }
    wa-popup::part(popup) {
      z-index: 1000;
    }
    /* Fade only, for the same reason menus fade only: the anchored popup
       measures the box it places, and a transform during the entrance hands it
       a moved rectangle. */
    [role='dialog'] {
      animation: popover-in var(--motion-fast) var(--motion-ease-out);
    }
    @keyframes popover-in {
      from {
        opacity: 0;
      }
    }
    :host-context([data-motion='reduced']) [role='dialog'] {
      animation: none;
    }
    slot {
      display: contents;
    }
  `
  connectedCallback(): void {
    super.connectedCallback()
    this.unsubscribe = on('menu:open', ({ owner }) => {
      if (owner !== this) this.dismiss()
    })
    window.addEventListener('pointerdown', this.outside, true)
    window.addEventListener('focusin', this.outside, true)
    window.addEventListener('keydown', this.key, true)
  }
  disconnectedCallback(): void {
    this.unsubscribe?.()
    window.removeEventListener('pointerdown', this.outside, true)
    window.removeEventListener('focusin', this.outside, true)
    window.removeEventListener('keydown', this.key, true)
    if (this.restoreFocus) this.anchor?.focus({ preventScroll: true })
    super.disconnectedCallback()
  }
  protected firstUpdated(): void {
    emit('menu:open', { owner: this })
  }
  private focusContents = (): void => {
    if (!this.autoFocus || this.focused) return
    this.focused = true
    const target =
      this.querySelector<HTMLElement>('input') ??
      this.querySelector<HTMLElement>('[aria-checked="true"]') ??
      this.querySelector<HTMLElement>('.m-item:not(:disabled), button:not(:disabled)')
    target?.focus({ preventScroll: true })
  }
  private dismiss(): void {
    if (this.closing) return
    this.closing = true
    closeSurface(this.renderRoot.querySelector('[role="dialog"]'), () =>
      this.dispatchEvent(new CustomEvent('popover-dismiss', { bubbles: true, composed: true }))
    )
  }
  private outside = (event: Event): void => {
    if (
      !event.composedPath().includes(this) &&
      !event.composedPath().includes(this.anchor as EventTarget)
    )
      this.dismiss()
  }
  private key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.restoreFocus = true
      this.dismiss()
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  render(): unknown {
    return html`<wa-popup
      .anchor=${this.anchor}
      active
      .placement=${this.placement}
      strategy="fixed"
      distance="8"
      flip
      flip-padding="8"
      shift
      shift-padding="8"
      auto-size="vertical"
      auto-size-padding="8"
      @wa-reposition=${this.focusContents}
      ><div role="dialog" aria-label=${this.label}><slot></slot></div
    ></wa-popup>`
  }
}
