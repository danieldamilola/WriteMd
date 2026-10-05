import { css, html, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import './IconButton'
import { api } from '../api'
import { SettingsStore } from '../state/settings'
import { scrollbarStyles } from './scrollbars'
import { summarizeNotesForVersion } from '../services/whats-new'

type UpStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

/**
 * The toolbar update affordance.
 *
 * The button only exists while there is something to act on: idle, error and
 * checking all render nothing so the bar stays quiet. The three live states
 * are distinct at a glance - a red dot for an update waiting, a ring around
 * the icon while it downloads, a green check once it is ready - and each one
 * says what a click will do in its hover card.
 */
@customElement('writemd-update-button')
export class WriteMdUpdateButton extends LitElement {
  static styles = [
    scrollbarStyles,
    css`
      :host {
        display: inline-flex;
        position: relative;
      }

      .wrap {
        position: relative;
        display: inline-flex;
      }

      /* Red dot for a waiting update, green check for a ready-to-install one. */
      .dot {
        position: absolute;
        top: 3px;
        right: 3px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--danger);
        pointer-events: none;
      }

      .check-badge {
        position: absolute;
        top: 2px;
        right: 2px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--bg-elevated);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      }

      /* Dash ring around the button while the download runs. */
      .ring {
        position: absolute;
        inset: -2px;
        pointer-events: none;
        animation: spin 1.2s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(-90deg);
        }
        to {
          transform: rotate(270deg);
        }
      }

      /*
       * Hover card. Anchored to the wrap rather than the host so it can sit
       * outside the 20px button box without stretching the bar's hit area.
       * opacity rather than display, so opening it does not reflow the toolbar
       * and the transition has something to interpolate.
       */
      .card {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        width: 280px;
        padding: 10px 12px;
        background: var(--menu-bg);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-3);
        z-index: 300;
        opacity: 0;
        transform: translateY(calc(var(--motion-reveal-shift) * -1));
        pointer-events: none;
        transition:
          opacity var(--motion-fast) var(--motion-ease),
          transform var(--motion-fast) var(--motion-ease);
      }

      .card.open {
        opacity: 1;
        transform: translateY(0);
      }

      :host-context([data-motion='reduced']) .card {
        transform: none;
        transition: opacity var(--motion-fast) var(--motion-ease);
      }

      :host-context([data-motion='reduced']) .card.open {
        transform: none;
      }

      /*
       * The card sits below the bar, so the pointer has to travel across the
       * gap between button and card without the card closing. Padding on the
       * wrap bridges it: the card stays a child, so :hover never lifts.
       */
      .card-bridge {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        height: 8px;
      }

      .card-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--text);
        margin-bottom: 2px;
      }

      .card-action {
        font-size: 11px;
        color: var(--text-muted);
      }

      .card ul {
        margin: 6px 0 0 0;
        padding: 0;
        list-style: none;
      }

      .card li {
        position: relative;
        font-size: 11.5px;
        line-height: 1.45;
        color: var(--text-secondary);
        padding-left: 12px;
        margin-bottom: 4px;
      }

      .card li:last-child {
        margin-bottom: 0;
      }

      .card li::before {
        content: '';
        position: absolute;
        left: 2px;
        top: 7px;
        width: 3px;
        height: 3px;
        border-radius: 50%;
        background: var(--text-muted);
      }

      /* Long titles wrap to two lines and the card grows with them. */
      .card-scroll {
        max-height: 180px;
        overflow-y: auto;
      }

      .skip {
        margin-top: 8px;
        padding: 0;
        border: none;
        background: none;
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--text-muted);
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }

      .skip:hover {
        color: var(--text);
      }
    `
  ]

  @state() private status: UpStatus = 'idle'
  @state() private version = ''
  @state() private percent = 0
  @state() private cardOpen = false

  private unsubs: Array<() => void> = []

  connectedCallback(): void {
    super.connectedCallback()
    const u = api()?.updater
    if (!u) return
    void u
      .getState()
      .then((s) => {
        this.status = s.status
        this.version = s.version
        this.percent = s.percent
      })
      .catch(() => undefined)
    this.unsubs.push(
      u.onUpdateAvailable((info) => {
        this.status = 'available'
        this.version = info?.version ?? ''
      }),
      u.onUpdateNotAvailable(() => {
        this.status = 'idle'
      }),
      u.onDownloadProgress((p) => {
        this.status = 'downloading'
        this.percent = Math.round(p.percent ?? 0)
      }),
      u.onUpdateDownloaded((info) => {
        this.status = 'downloaded'
        this.version = info?.version ?? this.version
        this.percent = 100
      }),
      u.onError(() => {
        this.status = 'error'
      })
    )
  }

  disconnectedCallback(): void {
    this.unsubs.forEach((fn) => fn())
    this.unsubs = []
    super.disconnectedCallback()
  }

  private handleClick(): void {
    if (this.status === 'available') {
      this.status = 'downloading'
      this.percent = 0
      void api()
        ?.updater?.download?.()
        .catch(() => {
          this.status = 'error'
        })
    } else if (this.status === 'downloaded') {
      void api()?.updater?.install?.()
    }
  }

  /**
   * Declining writes the version rather than hiding the button, so the startup
   * check stops offering this one release and the next release prompts again.
   * Dismissing the hover card is not declining - only the link is.
   */
  private handleSkip(): void {
    SettingsStore.getInstance().set('updates.skippedVersion', this.version)
    this.status = 'idle'
    this.cardOpen = false
  }

  private renderCard(): unknown {
    if (this.status === 'downloading') {
      return html`
        <div class="card-title">Downloading update</div>
        <div class="card-action">${this.percent}% - this cannot be cancelled</div>
      `
    }

    if (this.status === 'downloaded') {
      return html`
        <div class="card-title">Update ready</div>
        <div class="card-action">
          Click to install${this.version ? ` v${this.version}` : ''} and restart
        </div>
      `
    }

    // available
    const notes = summarizeNotesForVersion(this.version)
    return html`
      <div class="card-title">
        ${this.version ? `Update v${this.version} available` : 'Update available'}
      </div>
      <div class="card-action">Click to download</div>
      ${
        notes.length > 0
          ? html`<ul class="card-scroll">
              ${notes.map((note) => html`<li>${note}</li>`)}
            </ul>`
          : ''
      }
      <button class="skip" @click=${this.handleSkip}>Skip this version</button>
    `
  }

  render(): unknown {
    // The button only exists while there is something to act on. Idle, error,
    // and checking all collapse to nothing so the toolbar stays quiet.
    if (this.status === 'idle' || this.status === 'error' || this.status === 'checking') {
      return html``
    }

    // Hovering is what opens the card, and so is keyboard focus, so the
    // affordance is not mouse-only.
    const live =
      this.status === 'available' || this.status === 'downloading' || this.status === 'downloaded'

    const title =
      this.status === 'downloading'
        ? `Downloading ${this.percent}% - please wait`
        : this.status === 'downloaded'
          ? 'Ready to install - click to restart'
          : 'Update available - click to download'

    // The ring's fill proportion mirrors the download progress; the whole
    // circle keeps spinning so a stalled transfer still reads as "working".
    const radius = 13
    const circumference = 2 * Math.PI * radius
    const filled = circumference * (this.percent / 100)

    return html`
      <div
        class="wrap"
        @mouseenter=${() => {
          if (live) this.cardOpen = true
        }}
        @mouseleave=${() => {
          this.cardOpen = false
        }}
        @focusin=${() => {
          if (live) this.cardOpen = true
        }}
        @focusout=${() => {
          this.cardOpen = false
        }}
      >
        <writemd-icon-button title=${title} @click=${this.handleClick}>
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
            <path
              d="M10 3v8M6.5 8.5L10 12l3.5-3.5"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M4 14.5v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </writemd-icon-button>

        ${this.status === 'available' ? html`<span class="dot"></span>` : ''}
        ${
          this.status === 'downloading'
            ? html`<svg class="ring" width="30" height="30" viewBox="0 0 30 30" fill="none">
                <circle cx="15" cy="15" r=${radius} stroke="var(--border)" stroke-width="1.5" />
                <circle
                  cx="15"
                  cy="15"
                  r=${radius}
                  stroke="var(--success)"
                  stroke-width="2"
                  stroke-dasharray="${filled} ${circumference}"
                  stroke-linecap="round"
                />
              </svg>`
            : ''
        }
        ${
          this.status === 'downloaded'
            ? html`<span class="check-badge">
                <svg width="6" height="6" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M2 5.5L4.2 7.7L8 3"
                    stroke="var(--success)"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </span>`
            : ''
        }

        <div class="card ${live && this.cardOpen ? 'open' : ''}" role="tooltip">
          ${live ? this.renderCard() : ''}
        </div>
        ${live ? html`<div class="card-bridge"></div>` : ''}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-update-button': WriteMdUpdateButton
  }
}
