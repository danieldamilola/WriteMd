import { css, html, LitElement } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import './Popover'
import { api } from '../api'
import { SettingsStore } from '../state/settings'
import { menuStyles } from './menu-styles'
import { scrollbarStyles } from './scrollbars'
import { summarizeNotes, summarizeNotesForVersion } from '../services/whats-new'
import { updateReleaseNotes } from '../../../shared/release-notes'
import { chromeIcon } from '../design/icons'
import type { UpdaterState } from '../../../shared/electron-api'

@customElement('writemd-update-button')
export class WriteMdUpdateButton extends LitElement {
  @property({ type: Boolean, reflect: true }) sidebar = false
  @state() private status: UpdaterState['status'] = 'idle'
  @state() private version = ''
  @state() private releaseNotes = ''
  @state() private percent = 0
  @state() private cardOpen = false
  private unsubs: (() => void)[] = []
  private closeTimer?: ReturnType<typeof setTimeout>
  private receivedEvent = false
  static styles = [
    menuStyles,
    scrollbarStyles,
    css`
      :host {
        display: inline-flex;
        font-family: var(--font-ui);
      }
      :host([sidebar]) {
        display: block;
      }
      .wrap {
        display: inline-flex;
        position: relative;
      }
      :host([sidebar]) .wrap {
        display: block;
      }
      button {
        font-family: inherit;
        cursor: pointer;
      }
      .action {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        min-width: 32px;
        min-height: 32px;
        padding: 6px;
        border: 0;
        border-radius: var(--radius-md);
        background: transparent;
        color: var(--text-secondary);
      }
      .action:hover {
        background: var(--bg-hover);
        color: var(--text);
      }
      .action:focus-visible,
      .skip:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: -2px;
      }
      .sidebar-action {
        width: 100%;
        min-height: 34px;
        box-sizing: border-box;
        padding: 8px;
        gap: 8px;
        text-align: left;
        justify-content: flex-start;
        background: color-mix(in srgb, var(--accent) 12%, transparent);
        color: var(--text);
      }
      .sidebar-action:hover {
        background: color-mix(in srgb, var(--accent) 18%, transparent);
      }
      .sidebar-action > svg {
        color: var(--accent);
        flex-shrink: 0;
      }
      .copy {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        font-weight: 500;
        line-height: 16px;
      }
      .action:disabled {
        cursor: default;
      }
      .progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 2px;
        background: var(--accent);
        border-radius: var(--radius-sm);
      }
      .dot,
      .check-badge {
        position: absolute;
        top: 3px;
        right: 3px;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--accent);
      }
      .check-badge {
        background: var(--success);
      }
      .ring {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        color: var(--accent);
        pointer-events: none;
      }
      .card {
        position: relative;
        width: 290px;
        max-width: calc(100vw - 16px);
        max-height: min(65vh, var(--auto-size-available-height, 65vh));
        box-sizing: border-box;
        overflow-y: auto;
        padding: 12px;
      }
      .card-title {
        color: var(--text);
        font-size: 13px;
        font-weight: 500;
      }
      .card-action,
      .empty {
        font-size: 11px;
        line-height: 1.5;
        color: var(--text-muted);
        margin-top: 5px;
      }
      .card ul {
        padding-left: 16px;
        margin: 12px 0;
        color: var(--text-secondary);
        font-size: 12px;
        line-height: 1.5;
      }
      .card li + li {
        margin-top: 5px;
      }
      .card li {
        overflow-wrap: anywhere;
      }
      .skip {
        color: var(--text-muted);
        background: transparent;
        border: 0;
        font-size: 11px;
        padding: 5px 0 0;
        text-decoration: underline;
        text-underline-offset: 3px;
      }
    `
  ]
  connectedCallback(): void {
    super.connectedCallback()
    const updater = api()?.updater
    if (!updater) return
    void updater
      .getState()
      .then((snapshot) => {
        if (!this.isConnected || this.receivedEvent) return
        this.status = snapshot.status
        this.version = snapshot.version
        this.percent = snapshot.percent
        this.releaseNotes = snapshot.releaseNotes ?? ''
      })
      .catch(() => undefined)
    this.unsubs = [
      updater.onUpdateAvailable((info) => {
        this.receivedEvent = true
        this.status = 'available'
        this.version = info.version ?? ''
        this.releaseNotes = updateReleaseNotes(info.releaseNotes)
      }),
      updater.onUpdateNotAvailable(() => {
        this.receivedEvent = true
        this.status = 'idle'
        this.cardOpen = false
        this.releaseNotes = ''
      }),
      updater.onDownloadProgress((info) => {
        this.receivedEvent = true
        this.status = 'downloading'
        this.percent = Math.max(0, Math.min(100, Math.round(info.percent ?? 0)))
      }),
      updater.onUpdateDownloaded((info) => {
        this.receivedEvent = true
        this.status = 'downloaded'
        this.version = info.version ?? this.version
        this.percent = 100
        this.releaseNotes = updateReleaseNotes(info.releaseNotes) || this.releaseNotes
      }),
      updater.onError(() => {
        this.receivedEvent = true
        this.status = 'error'
        this.cardOpen = false
      })
    ]
  }
  disconnectedCallback(): void {
    this.unsubs.forEach((unsubscribe) => unsubscribe())
    clearTimeout(this.closeTimer)
    super.disconnectedCallback()
  }
  private showCard = (): void => {
    clearTimeout(this.closeTimer)
    this.cardOpen = true
  }
  private hideCard = (): void => {
    clearTimeout(this.closeTimer)
    this.closeTimer = setTimeout(() => {
      this.cardOpen = false
    }, 180)
  }
  private focusOut = (event: FocusEvent): void => {
    if (event.relatedTarget instanceof Node && this.shadowRoot?.contains(event.relatedTarget))
      return
    this.hideCard()
  }
  private handleClick = (): void => {
    if (this.status === 'available') {
      this.status = 'downloading'
      this.percent = 0
      void api()
        ?.updater.download()
        .catch(() => {
          this.status = 'error'
          this.cardOpen = false
        })
    } else if (this.status === 'downloaded') void api()?.updater.install()
  }
  private handleSkip = (): void => {
    SettingsStore.getInstance().set('updates.skippedVersion', this.version)
    this.status = 'idle'
    this.cardOpen = false
  }
  private notes(): string[] {
    if (!this.releaseNotes) return summarizeNotesForVersion(this.version, 5)
    const text = this.releaseNotes
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/(?:p|div|h[1-6]|ul|ol)>|<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
    const document = new DOMParser().parseFromString(text, 'text/html')
    return summarizeNotes(document.body.textContent ?? text, 5)
  }
  render(): unknown {
    if (!['available', 'downloading', 'downloaded'].includes(this.status)) return null
    const target = this.version ? `v${this.version.replace(/^v/, '')}` : ''
    const label =
      this.status === 'downloaded'
        ? 'Restart to update'
        : this.status === 'downloading'
          ? `Downloading ${this.percent}%`
          : target
            ? `Update to ${target}`
            : 'Update available'
    const title =
      this.status === 'available'
        ? `Update to ${target}`.trim()
        : `${label}${target ? ` to ${target}` : ''}`
    const notes = this.notes()
    return html`<div
      class="wrap"
      @mouseenter=${this.showCard}
      @mouseleave=${this.hideCard}
      @focusin=${this.showCard}
      @focusout=${this.focusOut}
    >
      <button
        class=${`action ${this.sidebar ? 'sidebar-action' : ''}`}
        title=${title}
        aria-label=${title}
        aria-haspopup="dialog"
        aria-expanded=${this.cardOpen}
        ?disabled=${this.status === 'downloading'}
        @click=${this.handleClick}
      >
        ${chromeIcon(this.status === 'downloaded' ? 'refresh' : 'download', this.sidebar ? 16 : 18)}
        ${this.sidebar ? html`<span class="copy" role="status">${label}</span>` : html`<span class=${this.status === 'available' ? 'dot' : this.status === 'downloaded' ? 'check-badge' : 'progress'}></span>`}
        ${this.status === 'downloading' ? html`<span class="progress" style=${`width:${this.percent}%`}></span>${!this.sidebar ? html`<svg class="ring" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="1.5" pathLength="100" stroke-dasharray="${this.percent} 100" /></svg>` : null}` : null}
      </button>
      ${
        this.cardOpen
          ? html`<writemd-popover
              .anchor=${this.shadowRoot?.querySelector<HTMLElement>('.action') ?? null}
              placement=${this.sidebar ? 'right-end' : 'bottom-end'}
              .autoFocus=${false}
              label="Update details"
              @popover-dismiss=${() => {
                this.cardOpen = false
              }}
            >
              <section
                class="m-panel card open"
                @mouseenter=${this.showCard}
                @mouseleave=${this.hideCard}
              >
                <div class="card-title">
                  ${this.status === 'downloaded' ? 'Update ready' : this.status === 'downloading' ? 'Downloading update' : `Update ${target} available`}
                </div>
                <div class="card-action">
                  ${this.status === 'downloaded' ? `Click to install ${target} and restart` : this.status === 'downloading' ? `${this.percent}% downloaded` : 'Click to download'}
                </div>
                ${
                  notes.length
                    ? html`<ul>
                        ${notes.map((note) => html`<li>${note}</li>`)}
                      </ul>`
                    : html`<p class="empty">Release notes were not included with this update.</p>`
                }
                ${
                  this.status === 'available'
                    ? html`<div class="m-divider"></div>
                        <button class="skip" @click=${this.handleSkip}>Skip this version</button>`
                    : null
                }
              </section></writemd-popover
            >`
          : null
      }
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-update-button': WriteMdUpdateButton
  }
}
