import { css, html, LitElement, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { FileState, isGroupWithin } from '../state/file-state'
import { groupRowIcon } from './group-icons'
import { chromeIcon } from '../design/icons'
import { menuStyles } from './menu-styles'
import { scrollbarStyles } from './scrollbars'
import './Popover'
import { icon } from './icons'

@customElement('writemd-group-card')
export class GroupCard extends LitElement {
  @property() groupId = ''
  @property({ attribute: false }) anchor: HTMLElement | null = null
  @state() private currentId = ''
  @state() private search = ''
  @state() private creatingFolder = false
  @state() private error = ''
  @state() private creatingNote = false
  private files = FileState.getInstance()
  private unsubscribe?: () => void
  static styles = [
    menuStyles,
    scrollbarStyles,
    css`
      :host {
        display: contents;
        font-family: var(--font-ui);
      }
      .m-panel {
        position: relative;
        width: 300px;
        max-width: calc(100vw - 16px);
        box-sizing: border-box;
        max-height: min(85vh, var(--auto-size-available-height, 85vh));
        overflow-y: auto;
      }
      .heading {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        color: var(--text);
        font-size: 13px;
      }
      .heading span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .heading svg,
      .m-item svg {
        flex-shrink: 0;
        width: 16px;
        height: 16px;
      }
      button {
        font: inherit;
      }
      .back {
        display: grid;
        place-items: center;
        border: 0;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text-secondary);
        padding: 4px;
        cursor: pointer;
      }
      input {
        box-sizing: border-box;
        width: calc(100% - 8px);
        margin: 0 4px 4px;
        padding: 8px;
        font: 12px var(--font-ui);
        color: var(--text);
        background: var(--bg-hover);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
        outline: none;
      }
      input:focus-visible,
      button:focus-visible {
        outline: 2px solid var(--border-focus);
        outline-offset: -2px;
      }
      .items {
        max-height: min(320px, 45vh);
        overflow-y: auto;
      }
      .m-item {
        box-sizing: border-box;
        width: 100%;
        border: 0;
        background: transparent;
        text-align: left;
      }
      .m-item:hover,
      .m-item[aria-current='page'] {
        background: var(--bg-active);
      }
      .name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dirty {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--text-secondary);
      }
      .empty,
      .error {
        padding: 12px;
        margin: 0;
        color: var(--text-muted);
        font-size: 12px;
      }
      .error {
        color: var(--danger);
      }
      .m-divider {
        margin: 4px;
      }
    `
  ]
  connectedCallback(): void {
    super.connectedCallback()
    this.unsubscribe = this.files.subscribe(() => this.requestUpdate())
  }
  disconnectedCallback(): void {
    this.unsubscribe?.()
    super.disconnectedCallback()
  }
  protected updated(changed: PropertyValues): void {
    if (changed.has('groupId')) {
      this.currentId = this.groupId
      this.search = ''
      this.creatingFolder = false
    }
    if (changed.has('creatingFolder') && this.creatingFolder)
      this.shadowRoot?.querySelector<HTMLInputElement>('.folder-name')?.focus()
  }
  private close(): void {
    this.dispatchEvent(new CustomEvent('group-card-dismiss', { bubbles: true, composed: true }))
  }
  private async newNote(): Promise<void> {
    if (this.creatingNote) return
    this.creatingNote = true
    const before = this.files.getState()
    const previous = before.tabs[before.activeTab]?.id
    try {
      await this.files.newFile()
      const after = this.files.getState()
      if (after.tabs[after.activeTab]?.id === previous) return
      this.files.setTabGroup(after.activeTab, this.currentId || this.groupId)
      this.close()
    } catch {
      this.error = 'Could not create a note. Try again.'
    } finally {
      this.creatingNote = false
    }
  }
  private createFolder(event: Event): void {
    event.preventDefault()
    const input = this.shadowRoot?.querySelector<HTMLInputElement>('.folder-name')
    if (!input?.value.trim()) return
    const id = this.files.createTabGroup(input.value.trim())
    this.files.moveTabGroup(id, this.currentId || this.groupId)
    this.creatingFolder = false
    this.currentId = id
    this.search = ''
  }
  private keydown(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const active = this.shadowRoot?.activeElement
    if (
      active instanceof HTMLInputElement &&
      (active.classList.contains('folder-name') || event.key === 'Home' || event.key === 'End')
    )
      return
    const items = [
      ...(this.shadowRoot?.querySelectorAll<HTMLButtonElement>('.m-item:not(:disabled)') ?? [])
    ]
    if (!items.length) return
    event.preventDefault()
    const index = items.indexOf(active as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : index < 0
            ? event.key === 'ArrowDown'
              ? 0
              : items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
    items[next]?.scrollIntoView?.({ block: 'nearest' })
  }
  render(): unknown {
    const state = this.files.getState()
    const groups = state.tabGroups ?? []
    const id = this.currentId || this.groupId
    const group = groups.find((item) => item.id === id)
    if (!group) return null
    const query = this.search.trim().toLowerCase()
    const folders = groups.filter(
      (item) =>
        item.id !== id &&
        (query ? isGroupWithin(groups, item.id, id) : item.parentId === id) &&
        (!query || item.label.toLowerCase().includes(query))
    )
    const notes = state.tabs
      .map((tab, index) => ({ tab, index }))
      .filter(
        ({ tab }) =>
          tab.groupId &&
          (query ? isGroupWithin(groups, tab.groupId, id) : tab.groupId === id) &&
          (!query || (tab.path ?? 'Untitled.md').toLowerCase().includes(query))
      )
    return html`<writemd-popover
      .anchor=${this.anchor}
      label=${group.label}
      @popover-dismiss=${this.close}
    >
      <div class="m-panel" @keydown=${this.keydown}>
        <div class="heading">
          ${
            group.parentId
              ? html`<button
                  class="back"
                  aria-label="Parent folder"
                  @click=${() => {
                    this.currentId = group.parentId!
                    this.search = ''
                  }}
                >
                  ${chromeIcon('arrow-left', 14)}
                </button>`
              : groupRowIcon(group)
          }<span>${group.label}</span>
        </div>
        <input
          type="search"
          aria-label="Search folder"
          placeholder="Search notes and folders..."
          .value=${this.search}
          @input=${(event: Event) => {
            this.search = (event.currentTarget as HTMLInputElement).value
          }}
        />
        <div class="items">
          ${folders.map(
            (folder) =>
              html`<button
                class="m-item"
                @click=${() => {
                  this.currentId = folder.id
                  this.search = ''
                }}
              >
                ${groupRowIcon(folder)}<span class="name">${folder.label}</span
                >${icon('chevron-right', 12)}
              </button>`
          )}
          ${notes.map(
            ({ tab, index }) =>
              html`<button
                class="m-item"
                aria-current=${index === state.activeTab ? 'page' : 'false'}
                @click=${() => {
                  this.files.switchTab(index)
                  this.close()
                }}
              >
                ${chromeIcon('file-text', 16)}<span class="name"
                  >${tab.path?.split(/[/\\]/).pop() ?? 'Untitled.md'}</span
                >${tab.dirty ? html`<span class="dirty" title="Unsaved changes"></span>` : null}
              </button>`
          )}
          ${!folders.length && !notes.length ? html`<p class="empty">${query ? 'No matching notes or folders.' : 'This folder is empty.'}</p>` : null}
        </div>
        <div class="m-divider"></div>
        ${this.creatingFolder ? html`<form @submit=${this.createFolder}><input class="folder-name" aria-label="Folder name" placeholder="Folder name, then Enter" /></form>` : null}
        <button class="m-item" ?disabled=${this.creatingNote} @click=${() => void this.newNote()}>
          ${chromeIcon('plus', 16)}New note
        </button>
        <button
          class="m-item"
          @click=${() => {
            this.creatingFolder = !this.creatingFolder
          }}
        >
          ${chromeIcon('folder-plus', 16)}New folder
        </button>
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : null}
      </div></writemd-popover
    >`
  }
}
