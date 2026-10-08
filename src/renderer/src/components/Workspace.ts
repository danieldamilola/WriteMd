import { css, html, LitElement, type PropertyValues } from 'lit'
import { customElement, property, state, eventOptions } from 'lit/decorators.js'
import '@awesome.me/webawesome/dist/components/split-panel/split-panel.js'
import type WaSplitPanel from '@awesome.me/webawesome/dist/components/split-panel/split-panel.js'
import { WorkspaceState, paneGeometry } from '../state/workspace'
import { SettingsStore } from '../state/settings'
import { resizeHandleStyles } from '../design/controls'

@customElement('writemd-workspace')
export class Workspace extends LitElement {
  static styles = [
    resizeHandleStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        min-height: 0;
        position: relative;
        background: transparent;
      }
      wa-split-panel {
        flex: 1;
        min-width: 0;
        min-height: 0;
        height: 100%;
        --divider-width: var(--workspace-gutter);
        --divider-hit-area: 12px;
      }
      wa-split-panel::part(panel) {
        display: flex;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }
      wa-split-panel::part(divider) {
        background: var(--editor-surface);
        border-radius: 0;
      }
      wa-split-panel::part(divider):focus-visible {
        background: transparent;
        outline: 1px solid var(--border-focus);
        outline-offset: -1px;
      }
      wa-split-panel.single {
        --divider-width: 0px;
      }
      wa-split-panel.single::part(divider) {
        display: none;
      }
      wa-split-panel.primary::part(end),
      wa-split-panel.auxiliary::part(start) {
        display: none;
      }
      slot {
        display: flex;
        flex: 1;
        min-width: 0;
        min-height: 0;
      }
      ::slotted(*) {
        flex: 1;
        min-width: 0;
        min-height: 0;
      }
      .compact-switch {
        display: flex;
        gap: var(--space-small);
        padding-bottom: var(--space-small);
      }
      button {
        border: 0;
        border-radius: var(--radius-small);
        padding: 4px 10px;
        font: inherit;
        color: var(--text-muted);
        background: transparent;
        cursor: pointer;
      }
      button[aria-pressed='true'] {
        color: var(--text);
        background: var(--bg-hover);
      }
      button:focus-visible {
        outline: 1px solid var(--accent);
      }
    `
  ]
  @property({ type: Boolean }) active = false
  @property({ type: String }) surface = 'launcher'
  @state() private available = 0
  @state() private width = WorkspaceState.getInstance().paneWidth
  @state() private auxiliary = false
  private layout = WorkspaceState.getInstance()
  private observer: ResizeObserver | null = null
  private dragging = false
  private keyboard = false
  private unsubscribe: (() => void) | null = null
  private get panel(): WaSplitPanel | null {
    return this.renderRoot.querySelector('wa-split-panel')
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.observer = new ResizeObserver(([entry]) => {
      if (entry) this.available = entry.contentRect.width
      this.dispatchEvent(new CustomEvent('workspace-measure', { bubbles: true, composed: true }))
    })
    this.observer.observe(this)
    this.unsubscribe = SettingsStore.getInstance().subscribe('appearance.paneWidth', () => {
      if (!this.dragging) this.width = this.layout.paneWidth
    })
    window.addEventListener('pointerup', this.finishResize)
    window.addEventListener('pointercancel', this.cancelResize)
    window.addEventListener('blur', this.cancelResize)
  }
  disconnectedCallback(): void {
    this.observer?.disconnect()
    this.unsubscribe?.()
    window.removeEventListener('pointerup', this.finishResize)
    window.removeEventListener('pointercancel', this.cancelResize)
    window.removeEventListener('blur', this.cancelResize)
    super.disconnectedCallback()
  }
  protected willUpdate(changed: PropertyValues): void {
    if (changed.has('surface') && this.active) this.auxiliary = this.surface !== 'launcher'
    if (!this.active) this.auxiliary = false
  }
  private isDivider(event: Event): boolean {
    return event
      .composedPath()
      .some((node) => node instanceof Element && node.getAttribute('role') === 'separator')
  }
  private startResize = (event: PointerEvent): void => {
    if (event.button !== 0) return
    if (!this.isDivider(event)) return
    this.dragging = true
  }
  private finishResize = (): void => {
    if (!this.dragging) return
    this.dragging = false
    const width = this.panel?.positionInPixels
    if (width && this.active) this.layout.resizePane(paneGeometry(this.available, width).width)
    this.dispatchEvent(new CustomEvent('workspace-measure', { bubbles: true, composed: true }))
  }
  private cancelResize = (): void => {
    if (!this.dragging) return
    this.dragging = false
    this.width = this.layout.paneWidth
    this.requestUpdate()
  }
  @eventOptions({ capture: true })
  private onKey(event: KeyboardEvent): void {
    if (
      this.isDivider(event) &&
      ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)
    )
      this.keyboard = true
  }
  private reposition = (): void => {
    const position = this.panel?.positionInPixels
    if (position === undefined) return
    if (this.dragging) this.width = position
    if (this.keyboard) {
      this.keyboard = false
      this.width = paneGeometry(this.available, position).width
      this.layout.resizePane(this.width)
    }
    this.dispatchEvent(new CustomEvent('workspace-measure', { bubbles: true, composed: true }))
  }
  render(): unknown {
    const geometry = paneGeometry(this.available, this.width)
    const split = this.active && !geometry.compact
    const showAuxiliary = this.active && geometry.compact && this.auxiliary
    const position = split ? geometry.width : showAuxiliary ? 0 : this.available
    return html` ${
        this.active && geometry.compact
          ? html`<div class="compact-switch" aria-label="Workspace surfaces">
              <button aria-pressed=${!showAuxiliary} @click=${() => (this.auxiliary = false)}>
                Document
              </button>
              <button aria-pressed=${showAuxiliary} @click=${() => (this.auxiliary = true)}>
                ${this.surface === 'ai' ? 'AI' : 'Second pane'}
              </button>
            </div>`
          : ''
      }
      <wa-split-panel
        class=${split ? 'split' : `single ${showAuxiliary ? 'auxiliary' : 'primary'}`}
        primary="start"
        .positionInPixels=${position}
        ?disabled=${!split}
        style=${`--min: ${split ? geometry.min : 0}px; --max: ${split ? geometry.max : this.available}px`}
        @pointerdown=${this.startResize}
        @keydown=${this.onKey}
        @wa-reposition=${this.reposition}
      >
        <span slot="divider" class="resize-handle" aria-hidden="true"><i></i><i></i><i></i></span>
        <slot name="primary" slot="start"></slot><slot name="auxiliary" slot="end"></slot>
      </wa-split-panel>`
  }
}
