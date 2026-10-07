import './ContextMenu'
import { repeat } from 'lit/directives/repeat.js'
import { html, css, LitElement, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { scrollbarStyles } from './scrollbars'
import { menuStyles, menuIcon } from './menu-styles'
import { FileState, type TabGroup } from '../state/file-state'
import './Tab'
import { TabDragController } from '../controllers/tab-drag'

export interface VerticalTabItem {
  id?: string
  path: string | null
  dirty: boolean
  isPinned?: boolean
  groupId?: string | null
}

interface ContextMenuState {
  type: 'tab' | 'group'
  index?: number
  groupId?: string
  x: number
  y: number
}

function tabLabel(path: string | null): string {
  return path?.split(/[/\\]/).pop() ?? 'Untitled.md'
}

const PRESET_COLORS = [
  'transparent',
  '#f24e1e',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4'
]

@customElement('writemd-vertical-tab-bar')
export class VerticalTabBar extends LitElement {
  static styles = [
    menuStyles,
    scrollbarStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        flex-shrink: 0;
        min-height: 0;
        height: 100%;
        padding: 8px 8px 0;
        margin-right: 0;
        box-sizing: border-box;
        user-select: none;
        position: relative;
        font-family: var(--font-ui);
      }

      .scroll-container {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: 6px;
        gap: 4px;
      }

      .section-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 10px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--text-muted);
        padding: 2px 6px 4px 6px;
        opacity: 0.8;
      }

      .pinned-section {
        display: flex;
        flex-direction: column;
        gap: 3px;
        margin-bottom: 6px;
      }

      .pinned-divider {
        height: 1px;
        width: 48px;
        max-width: 40%;
        flex-shrink: 0;
        align-self: center;
        margin: 8px 0;
        background: var(--border);
      }

      .tab-group-container {
        display: flex;
        flex-direction: column;
        margin-bottom: 4px;
      }

      .group-header {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 6px;
        border-radius: 5px;
        cursor: pointer;
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 500;
        transition:
          background 100ms ease,
          color 100ms ease;
        position: relative;
        box-sizing: border-box;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        overflow: hidden;
      }

      .group-header:hover {
        background: var(--bg-hover);
        color: var(--text);
      }

      .group-header.drag-over {
        background: var(--bg-hover);
        outline: 1px dashed var(--accent-primary, #f24e1e);
      }
      [data-drop-target] {
        outline: 1px solid var(--border-focus);
        outline-offset: -1px;
      }

      .group-chevron {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        color: var(--text-muted);
        transition: transform 140ms ease;
        flex-shrink: 0;
      }

      .group-chevron.collapsed {
        transform: rotate(-90deg);
      }

      .group-color-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .group-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
      }

      .group-rename-input {
        flex: 1;
        min-width: 0;
        width: 100%;
        box-sizing: border-box;
        height: 22px;
        background: var(--bg-active);
        border: 1px solid var(--border-focus);
        border-radius: 3px;
        color: var(--text);
        font-family: inherit;
        font-size: 12px;
        padding: 1px 6px;
        outline: none;
      }

      .group-tabs {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding-left: 12px;
        margin-top: 2px;
      }

      .group-tabs.collapsed {
        display: none;
      }

      .tab-row {
        position: relative;
        touch-action: none;
        border-radius: 5px;
        display: flex;
        align-items: center;
      }

      writemd-tab {
        width: 100%;
        max-width: none;
        flex: 1;
        height: 30px;
      }

      .color-palette {
        display: flex;
        gap: 6px;
        padding: 4px 10px;
      }

      .color-dot-btn {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 1px solid var(--border-subtle);
        cursor: pointer;
        transition: transform 100ms ease;
        box-sizing: border-box;
      }

      .color-dot-btn:hover {
        transform: scale(1.2);
      }

      .color-dot-btn.none-color {
        background: transparent !important;
        border: 1px dashed var(--text-muted);
        position: relative;
      }

      .color-dot-btn.none-color::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 1px;
        right: 1px;
        height: 1px;
        background: var(--text-muted);
        transform: rotate(-45deg);
      }

      .m-panel {
        position: fixed;
        z-index: 100;
      }
    `
  ]

  @property({ type: Array }) tabs: VerticalTabItem[] = []
  @property({ type: Number }) activeTab = 0
  @property({ type: Array }) tabGroups: TabGroup[] = []
  @property({ type: String }) secondaryPath: string | null = null
  @property({ type: Boolean }) secondaryDirty = false

  @state() private contextMenu: ContextMenuState | null = null
  @state() private renamingGroupId: string | null = null
  @state() private liveAnnouncement = ''

  private fileState = FileState.getInstance()
  private tabDrag = new TabDragController(this, 'y')

  private handleTabContextMenu(e: MouseEvent, index: number): void {
    e.preventDefault()
    e.stopPropagation()
    this.contextMenu = {
      type: 'tab',
      index,
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 200)
    }
  }

  private handleGroupContextMenu(e: MouseEvent, groupId: string): void {
    e.preventDefault()
    e.stopPropagation()
    this.contextMenu = {
      type: 'group',
      groupId,
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 240)
    }
  }

  private closeContextMenu(): void {
    this.contextMenu = null
  }

  private focusRenameInput(groupId: string): void {
    this.requestUpdate()
    setTimeout(() => {
      const scrollEl = this.renderRoot?.querySelector('.scroll-container') as HTMLElement | null
      if (scrollEl) scrollEl.scrollLeft = 0
      const input = this.renderRoot?.querySelector(
        `[data-group-id="${groupId}"] .group-rename-input`
      ) as HTMLInputElement | null
      input?.focus({ preventScroll: true })
      input?.select()
    }, 50)
  }

  private handleScrollContainerScroll = (e: Event): void => {
    const el = e.currentTarget as HTMLElement | null
    if (el && el.scrollLeft !== 0) {
      el.scrollLeft = 0
    }
  }

  private handleCreateGroupWithTab(index: number): void {
    this.closeContextMenu()
    const defaultLabel = `Group ${(this.tabGroups?.length ?? 0) + 1}`
    const id = this.fileState.createTabGroup(defaultLabel, undefined, [index])
    this.renamingGroupId = id
    this.focusRenameInput(id)
  }

  private handleRenameGroupSubmit(groupId: string, newName: string): void {
    if (newName.trim()) {
      this.fileState.updateTabGroup(groupId, { label: newName.trim() })
    }
    this.renamingGroupId = null
  }

  // --- Template Helpers ---

  private renderTabItem(tab: VerticalTabItem, index: number): TemplateResult {
    return html`
      <div
        class="tab-row"
        data-tab-index=${index}
        data-tab-id=${tab.id ?? `tab-${index}`}
        data-pinned=${tab.isPinned ? 'true' : 'false'}
        data-group-id=${tab.groupId ?? ''}
        @click=${() => {
          if (this.tabDrag.suppressClick) return
          this.dispatchEvent(
            new CustomEvent('select-tab', {
              detail: { index },
              bubbles: true,
              composed: true
            })
          )
        }}
        @contextmenu=${(e: MouseEvent) => this.handleTabContextMenu(e, index)}
      >
        <writemd-tab
          vertical
          ?pinned=${Boolean(tab.isPinned)}
          label=${tabLabel(tab.path)}
          ?active=${index === this.activeTab}
          .dirty=${tab.dirty}
          @select=${(): void => {
            if (this.tabDrag.suppressClick) return
            this.dispatchEvent(
              new CustomEvent('select-tab', {
                detail: { index },
                bubbles: true,
                composed: true
              })
            )
          }}
          @close=${(): void => {
            this.dispatchEvent(
              new CustomEvent('close-tab', {
                detail: { index },
                bubbles: true,
                composed: true
              })
            )
          }}
          @reorder-tab=${(e: CustomEvent<{ delta: -1 | 1 }>): void => {
            this.fileState.moveTabRelative(index, e.detail.delta)
          }}
        ></writemd-tab>
      </div>
    `
  }

  private renderGroup(group: TabGroup): TemplateResult {
    const groupTabs = this.tabs
      .map((tab, idx) => ({ tab, idx }))
      .filter(({ tab }) => !tab.isPinned && tab.groupId === group.id)

    return html`
      <div class="tab-group-container" data-group-id=${group.id}>
        <div
          class="group-header"
          data-group-id=${group.id}
          @click=${() => {
            if (this.tabDrag.suppressClick) return
            if (this.renamingGroupId === group.id) return
            this.fileState.toggleTabGroupCollapse(group.id)
          }}
          @contextmenu=${(e: MouseEvent) => this.handleGroupContextMenu(e, group.id)}
        >
          <div
            class="group-chevron ${group.collapsed ? 'collapsed' : ''}"
            @click=${(e: MouseEvent) => {
              e.stopPropagation()
              if (this.tabDrag.suppressClick) return
              this.fileState.toggleTabGroupCollapse(group.id)
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
          ${
            group.color && group.color !== 'transparent'
              ? html`<span class="group-color-dot" style="background-color: ${group.color}"></span>`
              : ''
          }
          ${
            this.renamingGroupId === group.id
              ? html`
                  <input
                    type="text"
                    class="group-rename-input"
                    .value=${group.label}
                    @blur=${(e: Event) =>
                      this.handleRenameGroupSubmit(group.id, (e.target as HTMLInputElement).value)}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === 'Enter') {
                        this.handleRenameGroupSubmit(group.id, (e.target as HTMLInputElement).value)
                      } else if (e.key === 'Escape') {
                        this.renamingGroupId = null
                      }
                    }}
                    @click=${(e: MouseEvent) => e.stopPropagation()}
                  />
                `
              : html`
                  <span
                    class="group-label"
                    @dblclick=${(e: MouseEvent) => {
                      e.stopPropagation()
                      this.renamingGroupId = group.id
                      this.focusRenameInput(group.id)
                    }}
                    >${group.label}</span
                  >
                `
          }
        </div>
        <div class="group-tabs ${group.collapsed ? 'collapsed' : ''}">
          ${repeat(
            groupTabs,
            ({ tab }) => tab.id,
            ({ tab, idx }) => this.renderTabItem(tab, idx)
          )}
        </div>
      </div>
    `
  }

  private renderContextMenu(): TemplateResult | string {
    if (!this.contextMenu) return ''
    const { type, index, groupId, x, y } = this.contextMenu

    return html`
      <writemd-context-menu
        .x=${this.contextMenu.x}
        .y=${this.contextMenu.y}
        @menu-dismiss=${() => (this.contextMenu = null)}
      >
        <div
          class="m-panel"
          style="left: ${x}px; top: ${y}px;"
          @click=${(e: MouseEvent) => e.stopPropagation()}
        >
          ${
            type === 'tab' && index !== undefined
              ? html`
                  ${
                    this.tabs[index]?.isPinned
                      ? html`
                          <div
                            class="m-item"
                            @click=${() => {
                              this.fileState.unpinTab(index)
                              this.closeContextMenu()
                            }}
                          >
                            ${menuIcon('unpin')}
                            <span>Unpin tab</span>
                          </div>
                        `
                      : html`
                          <div
                            class="m-item"
                            @click=${() => {
                              this.fileState.pinTab(index)
                              this.closeContextMenu()
                            }}
                          >
                            ${menuIcon('pin')}
                            <span>Pin tab</span>
                          </div>
                        `
                  }
                  <div class="m-divider"></div>
                  ${this.tabGroups.map(
                    (g) => html`
                      <div
                        class="m-item"
                        @click=${() => {
                          this.fileState.setTabGroup(index, g.id)
                          this.closeContextMenu()
                        }}
                      >
                        ${
                          g.color && g.color !== 'transparent'
                            ? html`<span
                                class="group-color-dot"
                                style="background-color: ${g.color}; margin-right: 4px;"
                              ></span>`
                            : ''
                        }
                        <span>Move to ${g.label}</span>
                      </div>
                    `
                  )}
                  <div class="m-item" @click=${() => this.handleCreateGroupWithTab(index)}>
                    ${menuIcon('folder')}
                    <span>New group with tab</span>
                  </div>
                  ${
                    this.tabs[index]?.groupId
                      ? html`
                          <div
                            class="m-item"
                            @click=${() => {
                              this.fileState.setTabGroup(index, null)
                              this.closeContextMenu()
                            }}
                          >
                            ${menuIcon('external')}
                            <span>Remove from group</span>
                          </div>
                        `
                      : ''
                  }
                  <div class="m-divider"></div>
                  <div
                    class="m-item danger"
                    @click=${() => {
                      this.dispatchEvent(
                        new CustomEvent('close-tab', {
                          detail: { index },
                          bubbles: true,
                          composed: true
                        })
                      )
                      this.closeContextMenu()
                    }}
                  >
                    ${menuIcon('trash')}
                    <span>Close tab</span>
                  </div>
                `
              : ''
          }
          ${
            type === 'group' && groupId
              ? html`
                  <div
                    class="m-item"
                    @click=${() => {
                      const gId = groupId
                      this.renamingGroupId = gId
                      this.closeContextMenu()
                      this.focusRenameInput(gId)
                    }}
                  >
                    ${menuIcon('pencil')}
                    <span>Rename group</span>
                  </div>
                  <div class="m-divider"></div>
                  <div class="color-palette">
                    ${PRESET_COLORS.map(
                      (c) => html`
                        <div
                          class="color-dot-btn ${c === 'transparent' ? 'none-color' : ''}"
                          style="background-color: ${c}"
                          title=${c === 'transparent' ? 'No color' : c}
                          @click=${() => {
                            this.fileState.updateTabGroup(groupId, { color: c })
                            this.closeContextMenu()
                          }}
                        ></div>
                      `
                    )}
                  </div>
                  <div class="m-divider"></div>
                  <div
                    class="m-item"
                    @click=${() => {
                      this.fileState.deleteTabGroup(groupId, false)
                      this.closeContextMenu()
                    }}
                  >
                    ${menuIcon('external')}
                    <span>Ungroup tabs</span>
                  </div>
                  <div
                    class="m-item danger"
                    @click=${() => {
                      this.fileState.deleteTabGroup(groupId, true)
                      this.closeContextMenu()
                    }}
                  >
                    ${menuIcon('trash')}
                    <span>Close all tabs in group</span>
                  </div>
                `
              : ''
          }
        </div>
      </writemd-context-menu>
    `
  }

  render(): unknown {
    const pinnedTabs = this.tabs.map((tab, idx) => ({ tab, idx })).filter(({ tab }) => tab.isPinned)

    const ungroupedTabs = this.tabs
      .map((tab, idx) => ({ tab, idx }))
      .filter(({ tab }) => !tab.isPinned && !tab.groupId)

    const currentGroups = this.tabGroups ?? []
    // Space holds everything pinned to the top: groups always live here,
    // with pinned tabs after them. Neither shows a pin badge; the file icon
    // is the same for every row.
    const hasSpace = pinnedTabs.length > 0 || currentGroups.length > 0

    return html`
      <div class="sr-only" aria-live="polite">${this.liveAnnouncement}</div>
      <div
        class="scroll-container"
        role="tablist"
        aria-label="Open documents"
        @scroll=${this.handleScrollContainerScroll}
      >
        ${
          hasSpace
            ? html`
                <div class="section-label"><span>Space</span></div>
                ${repeat(
                  currentGroups,
                  (group) => group.id,
                  (group) => this.renderGroup(group)
                )}
                ${
                  pinnedTabs.length > 0
                    ? html`
                        <div class="pinned-section">
                          ${repeat(
                            pinnedTabs,
                            ({ tab }) => tab.id,
                            ({ tab, idx }) => this.renderTabItem(tab, idx)
                          )}
                        </div>
                      `
                    : ''
                }
                ${ungroupedTabs.length > 0 ? html`<div class="pinned-divider" role="separator" aria-label="Pinned and unpinned documents"></div>` : ''}
              `
            : ''
        }
        ${repeat(
          ungroupedTabs,
          ({ tab }) => tab.id,
          ({ tab, idx }) => this.renderTabItem(tab, idx)
        )}
        ${
          this.secondaryPath
            ? html`
                <div class="tab-row" style="margin-top: 8px;">
                  <writemd-tab
                    vertical
                    label=${tabLabel(this.secondaryPath)}
                    ?active=${false}
                    .dirty=${this.secondaryDirty}
                    @close=${(): void => {
                      this.dispatchEvent(
                        new CustomEvent('close-secondary', {
                          bubbles: true,
                          composed: true
                        })
                      )
                    }}
                  ></writemd-tab>
                </div>
              `
            : ''
        }
      </div>

      ${this.renderContextMenu()}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-vertical-tab-bar': VerticalTabBar
  }
}
