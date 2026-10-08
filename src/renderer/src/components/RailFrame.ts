import { css, html, LitElement, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { animate } from 'motion'
import { WorkspaceState } from '../state/workspace'
import { SettingsStore } from '../state/settings'
import { reducedMotionNow } from '../utils/motion'
import { resizeHandleStyles } from '../design/controls'

@customElement('writemd-rail-frame')
export class RailFrame extends LitElement {
  static styles = [
    resizeHandleStyles,
    css`
      :host {
        display: block;
        flex: 0 0 auto;
        min-width: 0;
        position: relative;
        overflow: hidden;
      }
      .rail {
        height: 100%;
      }
      slot {
        display: block;
        height: 100%;
      }
      .divider {
        position: absolute;
        inset: 0 0 0 auto;
        width: 8px;
        cursor: col-resize;
        touch-action: none;
        z-index: 4;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .divider:focus-visible {
        outline: none;
      }
      .divider:hover .resize-handle {
        color: var(--text);
      }
      .divider:focus-visible .resize-handle {
        outline: 2px solid var(--border-focus);
        border-radius: var(--radius-sm);
      }
    `
  ]
  @property({ type: Boolean }) collapsed = false
  /** Collapsed leaves a slim strip holding the expand button, not zero width. */
  private static readonly SLIM_WIDTH = 48
  @state() private width = WorkspaceState.getInstance().railWidth
  private animation: ReturnType<typeof animate> | null = null
  private pointer: number | null = null
  private start = 0
  private initial = 0
  private unsubscribe: (() => void) | null = null
  connectedCallback(): void {
    super.connectedCallback()
    this.unsubscribe = SettingsStore.getInstance().subscribe('appearance.railWidth', () => {
      if (this.pointer === null) this.width = WorkspaceState.getInstance().railWidth
    })
  }
  disconnectedCallback(): void {
    this.animation?.stop()
    this.unsubscribe?.()
    super.disconnectedCallback()
  }
  protected updated(changed: PropertyValues): void {
    if (!changed.has('collapsed') && !changed.has('width')) return
    const target = this.collapsed ? RailFrame.SLIM_WIDTH : this.width
    this.animation?.stop()
    if (
      reducedMotionNow() ||
      this.pointer !== null ||
      !changed.has('collapsed') ||
      changed.get('collapsed') === undefined
    )
      this.style.width = `${target}px`
    else
      this.animation = animate(
        this,
        { width: `${target}px` },
        { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
      )
  }
  private down = (event: PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    this.animation?.stop()
    this.pointer = event.pointerId
    this.start = event.clientX
    this.initial = this.width
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  private move = (event: PointerEvent): void => {
    if (this.pointer !== event.pointerId) return
    this.width = Math.max(160, Math.min(360, this.initial + event.clientX - this.start))
  }
  private up = (event: PointerEvent): void => {
    if (this.pointer !== event.pointerId) return
    this.pointer = null
    if (event.type === 'pointercancel') this.width = this.initial
    else WorkspaceState.getInstance().resizeRail(this.width)
  }
  private key = (event: KeyboardEvent): void => {
    if (event.key === 'Enter')
      this.dispatchEvent(new CustomEvent('toggle-rail', { bubbles: true, composed: true }))
    else if (event.key === 'ArrowLeft') this.width = Math.max(160, this.width - 16)
    else if (event.key === 'ArrowRight') this.width = Math.min(360, this.width + 16)
    else if (event.key === 'Home') this.width = 160
    else if (event.key === 'End') this.width = 360
    else return
    event.preventDefault()
    if (event.key !== 'Enter') WorkspaceState.getInstance().resizeRail(this.width)
  }
  render(): unknown {
    return html`<div
      class="rail"
      style=${`width:${this.collapsed ? RailFrame.SLIM_WIDTH : this.width}px`}
    >
      <slot></slot>
      ${
        this.collapsed
          ? ''
          : html`<div
              class="divider"
              role="separator"
              tabindex="0"
              aria-label="Resize document rail"
              aria-orientation="vertical"
              aria-valuemin="160"
              aria-valuemax="360"
              aria-valuenow=${this.width}
              @pointerdown=${this.down}
              @pointermove=${this.move}
              @pointerup=${this.up}
              @pointercancel=${this.up}
              @keydown=${this.key}
            >
              <span class="resize-handle" aria-hidden="true"><i></i><i></i><i></i></span>
            </div>`
      }
    </div>`
  }
}
