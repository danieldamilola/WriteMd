import { css, html, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { chromeIcon } from '../design/icons'
import { controlStyles } from '../design/controls'
import { groupRowIcon } from './group-icons'
import type { TabGroup } from '../state/file-state'
import './IconButton'
import './SearchBar'
import './UpdateButton'

/**
 * Vertical document panel: palette search, icon-only quick actions, the
 * open-documents rail, and workspace shortcuts. Collapsed, it shrinks to a slim
 * strip holding the expand button, one icon per tab group, and settings, so the
 * panel can always be reopened from the rail itself and the folders stay
 * visible while it is shut.
 */
@customElement('writemd-sidebar')
export class Sidebar extends LitElement {
  @property({ type: Boolean }) welcome = false
  @property({ type: Boolean }) collapsed = false
  @property({ type: Boolean }) aiEnabled = false
  @property({ type: Boolean }) aiOpen = false
  @property() activeGroupId = ''
  /** Draws one icon per group in the collapsed strip. */
  @property({ type: Array }) tabGroups: TabGroup[] = []
  static styles = [
    controlStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--frame-surface);
        font-family: var(--font-ui);
      }
      /*
       * Spacing follows a 4px scale (4/8/12/16/20/24/32) with the
       * internal <= external rule: the space around a group is never smaller
       * than the space inside it, so each group reads as a unit.
       *
       * 8px between the quick actions and the search field, 8px around the
       * field itself, and a 4px gap inside the icon-only cluster. The action
       * row sits on the left edge rather than centred: it is the start of the
       * rail, and centring it left a hole on the left of every note row.
       */
      .panel-top {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 8px 8px 0;
        flex-shrink: 0;
      }
      /*
       * Open file draws a document, not a folder. It sat next to folder-plus in
       * a three-button row, so two of the three read as the same shape, and it
       * was wrong anyway: the dialog picks one markdown file, not a folder.
       * Only New group carries a folder now, being the one action here that
       * makes one. WelcomeScreen's Open file button matches.
       */
      .actions {
        display: flex;
        justify-content: flex-start;
        gap: 4px;
        flex: 1;
        min-width: 0;
      }
      /*
       * The row is the flex container and the search bar fills it. Overriding
       * the bar to display:block instead left the field inside it without a
       * flex parent, so it collapsed to 133px of a 192px row.
       */
      .search-row {
        display: flex;
        padding: 8px;
        flex-shrink: 0;
      }
      .body {
        display: flex;
        flex: 1;
        flex-direction: column;
        overflow: hidden;
        min-height: 0;
      }
      .home-hint {
        margin: 20px 16px;
        color: var(--text-secondary);
        font-size: 12px;
        line-height: 1.6;
      }
      slot {
        display: flex;
        flex: 1;
        min-height: 0;
      }
      .footer {
        padding: 8px;
      }
      .footer-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
      }
      .assistant[aria-pressed='true'] {
        color: var(--text);
        background: var(--bg-active);
        border-radius: var(--radius-sm);
      }
      .version {
        padding: 8px;
        font-size: 11px;
        color: var(--text-muted);
      }
      .nav-row:hover {
        background: var(--bg-hover);
        color: var(--text);
      }
      /*
       * The collapsed strip. Expand sits at the top, one icon per group fills
       * the middle, and settings stays pinned to the bottom, matching where
       * each control lives when the panel is open so none of them shift as the
       * panel collapses. Settings in particular used to become unreachable the
       * moment the panel was hidden: the only way back to it was to expand the
       * strip again first.
       */
      .slim {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 48px;
        height: 100%;
        padding-top: 12px;
      }
      .slim-bottom {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: auto;
        padding-bottom: 8px;
      }
      /*
       * One icon per group, filling the gap between expand and settings. The
       * list scrolls rather than compressing, so a vault with thirty folders
       * does not squeeze them into unreadable slivers.
       */
      .slim-groups {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 8px 0;
        scrollbar-width: none;
      }
      .slim-groups:empty {
        display: none;
      }
      .slim-group {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 0;
      }
      .slim-group:hover {
        background: var(--bg-hover);
        color: var(--text);
      }
      .slim-group:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: -2px;
      }
    `
  ]
  private action(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }))
  }
  render(): unknown {
    if (this.collapsed) {
      return html`
        <div class="slim">
          <writemd-icon-button
            size="md"
            title="Expand panel"
            @click=${() => this.action('toggle-panel')}
            >${chromeIcon('sidebar')}</writemd-icon-button
          >
          <div class="slim-groups">
            ${this.tabGroups.map(
              (group) => html`
                <button
                  class="slim-group"
                  data-group-id=${group.id}
                  title=${group.label}
                  aria-label=${group.label}
                  aria-haspopup="dialog"
                  aria-expanded=${this.activeGroupId === group.id}
                  @click=${(event: MouseEvent) =>
                    this.dispatchEvent(
                      new CustomEvent('open-group', {
                        detail: { groupId: group.id, anchor: event.currentTarget },
                        bubbles: true,
                        composed: true
                      })
                    )}
                >
                  ${groupRowIcon(group)}
                </button>
              `
            )}
          </div>
          <div class="slim-bottom">
            <writemd-update-button></writemd-update-button>
            ${this.renderAssistantButton()}
            <writemd-icon-button
              size="md"
              title="Settings"
              @click=${() => this.action('open-settings')}
              >${chromeIcon('settings')}</writemd-icon-button
            >
          </div>
        </div>
      `
    }
    return html`
      <div class="panel-top">
        <div class="actions">
          <writemd-icon-button size="md" title="New note" @click=${() => this.action('new-file')}
            >${chromeIcon('plus')}</writemd-icon-button
          >
          <writemd-icon-button size="md" title="Open file" @click=${() => this.action('open-file')}
            >${chromeIcon('file-text')}</writemd-icon-button
          >
          <writemd-icon-button
            size="md"
            title="New group"
            ?disabled=${this.welcome}
            @click=${() => this.action('new-group')}
            >${chromeIcon('folder-plus')}</writemd-icon-button
          >
        </div>
        <writemd-icon-button
          size="md"
          title="Collapse panel"
          @click=${() => this.action('toggle-panel')}
          >${chromeIcon('sidebar')}</writemd-icon-button
        >
      </div>
      <div class="search-row">
        <writemd-search-bar
          placeholder="Search"
          kbd="Ctrl+K"
          aria-label="Search commands"
          @search-activate=${() => this.action('open-menu')}
        ></writemd-search-bar>
      </div>
      <div class="body">
        ${this.welcome ? html` <p class="home-hint">Nothing</p> ` : html`<slot></slot>`}
      </div>
      <div class="footer">
        <writemd-update-button sidebar></writemd-update-button>
        <div class="footer-actions">
          <writemd-icon-button
            size="md"
            title="Settings"
            @click=${() => this.action('open-settings')}
          >
            ${chromeIcon('settings')}
          </writemd-icon-button>
          ${this.renderAssistantButton()}
        </div>
      </div>
    `
  }
  private renderAssistantButton(): unknown {
    return this.aiEnabled
      ? html`<writemd-icon-button
          class="assistant"
          size="md"
          title="AI assistant"
          aria-pressed=${this.aiOpen ? 'true' : 'false'}
          @click=${() => this.action('toggle-ai')}
          @mousedown=${(event: MouseEvent) => event.preventDefault()}
          >${chromeIcon('ai')}</writemd-icon-button
        >`
      : null
  }
}
