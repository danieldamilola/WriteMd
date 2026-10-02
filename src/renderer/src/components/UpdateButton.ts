import { html, css, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import './IconButton'
import { api } from '../api'

type UpStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

@customElement('writemd-update-button')
export class WriteMdUpdateButton extends LitElement {
  static styles = css`
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
  `

  @state() private status: UpStatus = 'idle'
  @state() private version = ''
  @state() private percent = 0

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

  render(): unknown {
    // The button only exists while there is something to act on. Idle, error,
    // and checking all collapse to nothing so the toolbar stays quiet.
    if (this.status === 'idle' || this.status === 'error' || this.status === 'checking') {
      return html``
    }

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
      <div class="wrap">
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
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-update-button': WriteMdUpdateButton
  }
}
