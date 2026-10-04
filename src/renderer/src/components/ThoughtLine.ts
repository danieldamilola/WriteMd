import { html, css, LitElement, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { icon } from './icons'

/**
 * A working→settled status line, replacing the plain italic "Thinking..."
 * bubble.
 *
 * Static by design. The first version breathed the glyph, swept a highlight
 * across the label and crossfaded into the settled sentence, which read as
 * animation for its own sake in a panel the user is trying to read. What earns
 * its place is the elapsed time: the line counts while the model works and
 * keeps the number, so a slow reply is legible afterwards.
 *
 * Written from scratch rather than ported: react-bits' Thought Line is
 * MIT + Commons Clause, whose restriction forbids redistributing the component
 * "whether alone, in a bundle, or as a ported version". WriteMd is MIT and
 * ships as an installer, so a copy would be a redistribution.
 */
@customElement('writemd-thought-line')
export class ThoughtLine extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 0.5em;
      color: var(--text-secondary, inherit);
      font-family: inherit;
      font-size: 13px;
      line-height: 1.5;
      /* No bubble chrome: the line sits flat in the transcript like the
         assistant answer beside it, so a "Thought for Xs" row reads as prose,
         not as a chip. */
      padding: 0;
      border-radius: 0;
      background: none;
    }

    :host([hidden]) {
      display: none;
    }

    .glyph {
      display: inline-flex;
      flex: none;
      width: 0.95em;
      height: 0.95em;
      color: var(--text-muted);
    }

    .glyph svg {
      width: 100%;
      height: 100%;
    }

    .stack {
      display: inline-block;
      text-align: left;
    }

    /*
     * Plain swap, no crossfade: a working line that breathes, shimmers and then
     * blurs into its settled form was animation for its own sake. display keeps
     * the inactive label out of layout entirely, so nothing reflows and nothing
     * animates.
     *
     * Both labels are toggled. Only hiding the settled one left the working label
     * in the tree forever, so a restored entry read "Thinking Thought for 0.3s".
     */
    .label {
      display: none;
      white-space: nowrap;
    }

    .label.working[data-active] {
      display: inline;
    }

    .label.settled[data-active] {
      display: inline;
    }

    .timer {
      font-family: var(--font-mono, ui-monospace, monospace);
      font-variant-numeric: tabular-nums;
      /* Tabular stops the digits changing width as the tenths tick. */
      letter-spacing: 0.01em;
      opacity: 0.75;
    }
  `

  /** True while work is in flight. False settles the line. */
  @property({ type: Boolean, reflect: true }) working = true

  @property({ type: String }) label = 'Thinking'
  @property({ type: String }) doneLabel = 'Thought for'
  @property({ type: Boolean }) showTimer = true

  /** Internally managed clock. Ignored once settled. */
  @state() private tenths = 0

  private startedAt = 0
  private timerId: number | null = null
  private settledTenths: number | null = null

  private startClock(): void {
    this.stopClock()
    this.startedAt = performance.now()
    this.tenths = 0
    this.settledTenths = null
    // 100ms rather than 10ms: the readout has one decimal place, so ticking ten
    // times a second is enough and it is a tenth of the wakeups.
    this.timerId = window.setInterval(() => {
      this.tenths = Math.floor((performance.now() - this.startedAt) / 100)
    }, 100)
  }

  private stopClock(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId)
      this.timerId = null
    }
  }

  private format(t: number): string {
    return t < 600
      ? `${(t / 10).toFixed(1)}s`
      : `${Math.floor(t / 600)}m ${((t % 600) / 10).toFixed(1)}s`
  }

  override connectedCallback(): void {
    super.connectedCallback()
    if (this.working) this.startClock()
  }

  override disconnectedCallback(): void {
    this.stopClock()
    super.disconnectedCallback()
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('working')) return
    // Only a real working -> settled transition reports. A line restored from a
    // saved transcript mounts with `working` already false, and treating that
    // initial value as a transition made it emit `thought-settle` on mount: the
    // owner appended another entry, which rendered another line, which settled
    // again, and the session save looped until the renderer died.
    if (this.working || changed.get('working') !== true) {
      // Working again starts a fresh clock; reusing the old one would report
      // the previous attempt's elapsed time.
      if (this.working) this.startClock()
      return
    }
    // Freeze on the value actually shown, not a fresh reading, so the number
    // that lands in the settled sentence is the one the user last saw.
    this.settledTenths = this.tenths
    this.stopClock()
    // The owner persists this as a transcript entry. Without the event the
    // elapsed time is only ever on screen while the bubble is mounted.
    this.dispatchEvent(
      new CustomEvent('thought-settle', {
        detail: { tenths: this.settledTenths },
        bubbles: true,
        composed: true
      })
    )
  }

  private get frozen(): number {
    return this.settledTenths ?? this.tenths
  }

  /**
   * A settled line, rendered directly rather than through the live one. The
   * owner keeps these as transcript entries so the elapsed time stays in the
   * scrollback instead of vanishing with the bubble.
   */
  @property({ type: Number }) elapsed = 0

  render(): unknown {
    const working = this.working
    const timer = working ? this.tenths : this.frozen
    // When frozen from an elapsed prop there is no live clock to read, so the
    // settled label is active from the first paint with no crossfade to run.
    const settledActive = !working || this.elapsed > 0
    return html`
      <span class="glyph" aria-hidden="true">${icon('sparkle')}</span>
      <span class="stack">
        <span class="label working" ?data-active=${working}>${this.label}</span>
        <span class="label settled" ?data-active=${settledActive}
          >${this.doneLabel}${
            this.showTimer
              ? html` <span class="timer"
                  >${this.format(this.elapsed > 0 ? this.elapsed : timer)}</span
                >`
              : ''
          }</span
        >
      </span>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-thought-line': ThoughtLine
  }
}
