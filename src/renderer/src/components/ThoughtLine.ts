import { html, css, LitElement, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { icon } from './icons'

/**
 * A working→settled status line, replacing the plain italic "Thinking..."
 * bubble.
 *
 * Written from scratch rather than ported: react-bits' Thought Line is
 * MIT + Commons Clause, whose restriction forbids redistributing the component
 * "whether alone, in a bundle, or as a ported version". WriteMd is MIT and
 * ships as an installer, so a copy would be a redistribution. The behaviour
 * here is ordinary CSS: an opacity cycle, a swept highlight, and a crossfade.
 *
 * Everything is expressed as CSS custom properties so a caller can retune it,
 * and every animation is disabled under prefers-reduced-motion rather than
 * merely shortened.
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
      /* The bubble used to be a block with its own background; the line owns
         that so it can be dropped anywhere without extra wrapper styling. */
      padding: 12px 16px;
      border-radius: 8px;
      border-bottom-left-radius: 2px;
      background: var(--bg-elevated);
    }

    :host([hidden]) {
      display: none;
    }

    .glyph {
      display: inline-flex;
      flex: none;
      width: 1.05em;
      height: 1.05em;
      color: var(--text-muted);
      animation: breathe var(--breath-period, 1.6s) cubic-bezier(0.77, 0, 0.175, 1) infinite;
    }

    .glyph svg {
      width: 100%;
      height: 100%;
    }

    .stack {
      position: relative;
      display: inline-block;
      min-width: 8ch;
      text-align: left;
    }

    /*
     * Both labels occupy the same origin so the swap cannot reflow the row. The
     * settled one is absolutely positioned and only becomes static once active,
     * which is what stops the container jumping as the words differ in length.
     */
    .label {
      white-space: nowrap;
    }

    .label.working {
      animation: settle var(--settle-duration, 350ms) ease both;
    }

    .label.settled {
      position: absolute;
      top: 0;
      left: 0;
      opacity: 0;
      filter: blur(var(--settle-blur, 2px));
      transition:
        opacity var(--settle-duration, 350ms) ease,
        filter var(--settle-duration, 350ms) ease;
    }

    .label.settled[data-active] {
      position: static;
      opacity: 1;
      filter: blur(0);
    }

    /* A band of ink sweeps the working label. Opacity only, so it never causes
       layout or paint of the text itself. */
    .label.working[data-shimmer] .text {
      background-image: linear-gradient(
        100deg,
        transparent 20%,
        var(--shimmer-tint, rgba(255, 255, 255, 0.55)) 45%,
        transparent 70%
      );
      background-repeat: no-repeat;
      background-size: 260% 100%;
      animation: shimmer var(--shimmer-duration, 1.8s) ease-in-out infinite;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .text {
      display: inline-block;
    }

    .timer {
      font-family: ui-monospace, 'Geist Mono', monospace;
      font-variant-numeric: tabular-nums;
      /* Tabular stops the digits changing width as the tenths tick. */
      letter-spacing: 0.01em;
      opacity: 0.75;
    }

    @keyframes breathe {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: calc(1 - var(--breath-depth, 0.45));
      }
    }

    @keyframes shimmer {
      0% {
        background-position: 180% 0;
      }
      100% {
        background-position: -80% 0;
      }
    }

    @keyframes settle {
      from {
        opacity: 1;
        filter: blur(0);
      }
      to {
        opacity: 1;
        filter: blur(0);
      }
    }

    /*
     * Reduced motion: stop the loops entirely rather than shortening them, and
     * drop the blur so the crossfade stays legible. The timer still runs, since
     * elapsed time is information rather than decoration.
     */
    @media (prefers-reduced-motion: reduce) {
      .glyph {
        animation: none;
        opacity: 0.8;
      }

      .label.working[data-shimmer] .text {
        animation: none;
        -webkit-text-fill-color: currentColor;
        background-image: none;
      }

      .label.settled {
        filter: none;
      }
    }
  `

  /** True while work is in flight. False settles the line. */
  @property({ type: Boolean, reflect: true }) working = true

  @property({ type: String }) label = 'Thinking'
  @property({ type: String }) doneLabel = 'Thought for'
  @property({ type: Boolean }) showTimer = true
  @property({ type: Boolean }) shimmer = true

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
    if (this.working) {
      // Working again starts a fresh clock; reusing the old one would report
      // the previous attempt's elapsed time.
      this.startClock()
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
        <span class="label working" ?data-shimmer=${working && this.shimmer}>${this.label}</span>
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
