import { css, html, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@awesome.me/webawesome/dist/components/popup/popup.js'
import { deepActiveElement } from '../utils/links'
import { emit, on } from '../events/bus'

@customElement('writemd-context-menu')
export class ContextMenu extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }
    .anchor {
      position: fixed;
      width: 0;
      height: 0;
      pointer-events: none;
    }
    wa-popup {
      --auto-size-available-height: 90vh;
    }
    wa-popup::part(popup) {
      z-index: 1000;
    }
    slot {
      display: contents;
    }
  `
  @property({ type: Number }) x = 0
  @property({ type: Number }) y = 0
  @property({ type: String }) placement: 'bottom-start' | 'bottom-end' = 'bottom-start'
  @property({ attribute: false }) anchor: HTMLElement | null = null
  private previous: HTMLElement | null = null
  private unsubscribe: (() => void) | null = null
  private restoreFocus = true
  connectedCallback(): void {
    super.connectedCallback()
    this.previous = deepActiveElement() as HTMLElement | null
    this.unsubscribe = on('menu:open', ({ owner }) => {
      if (owner !== this) {
        this.restoreFocus = false
        this.dismiss()
      }
    })
    window.addEventListener('pointerdown', this.outside, true)
    window.addEventListener('keydown', this.key, true)
  }
  disconnectedCallback(): void {
    window.removeEventListener('pointerdown', this.outside, true)
    window.removeEventListener('keydown', this.key, true)
    this.unsubscribe?.()
    if (this.restoreFocus && this.previous?.isConnected)
      this.previous.focus({ preventScroll: true })
    super.disconnectedCallback()
  }
  private items(): HTMLElement[] {
    return [...this.querySelectorAll<HTMLElement>('.m-item')].filter((item) => {
      let parent: HTMLElement | null = item
      while (parent && parent !== this) {
        if (getComputedStyle(parent).display === 'none') return false
        parent = parent.parentElement
      }
      return !item.hasAttribute('disabled')
    })
  }
  protected firstUpdated(): void {
    emit('menu:open', { owner: this })
    this.querySelector('.m-panel')?.setAttribute('role', 'menu')
    this.querySelectorAll('.m-item').forEach((item) => {
      item.setAttribute('role', 'menuitem')
      item.setAttribute('tabindex', '-1')
    })
    this.items()[0]?.focus({ preventScroll: true })
  }
  private dismiss(): void {
    this.dispatchEvent(new CustomEvent('menu-dismiss', { bubbles: true, composed: true }))
  }
  private outside = (event: PointerEvent): void => {
    if (!event.composedPath().includes(this)) {
      this.restoreFocus = false
      this.dismiss()
    }
  }
  private key = (event: KeyboardEvent): void => {
    const items = this.items()
    const current = items.indexOf(deepActiveElement() as HTMLElement)
    if (event.key === 'Escape' || event.key === 'Tab') {
      this.dismiss()
      if (event.key === 'Escape') event.preventDefault()
    } else if (event.key === 'ArrowDown')
      items[(current + 1 + items.length) % items.length]?.focus()
    else if (event.key === 'ArrowUp') items[(current - 1 + items.length) % items.length]?.focus()
    else if (event.key === 'Home') items[0]?.focus()
    else if (event.key === 'End') items.at(-1)?.focus()
    else if (event.key === 'Enter' || event.key === ' ') items[current]?.click()
    else return
    event.stopImmediatePropagation()
    if (event.key !== 'Tab') event.preventDefault()
  }
  render(): unknown {
    return html`<span id="anchor" class="anchor" style=${`left:${this.x}px;top:${this.y}px`}></span>
      <wa-popup
        .anchor=${this.anchor ?? 'anchor'}
        active
        .placement=${this.placement}
        strategy="fixed"
        flip
        flip-padding="8"
        shift
        shift-padding="8"
        auto-size="vertical"
        auto-size-padding="8"
        ><slot></slot
      ></wa-popup>`
  }
}
