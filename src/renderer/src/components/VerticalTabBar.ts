import { html, css, LitElement, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { scrollbarStyles } from './scrollbars'
import { menuStyles, menuIcon } from './menu-styles'
import { FileState, type TabGroup } from '../state/file-state'
import './Tab'

export interface VerticalTabItem {
  id?: string
  path: string | null
  dirty: boolean
  isPinned?: boolean
  groupId?: string | null
}

interface DragState {
  type: 'tab' | 'group'
  tabIndex: number
  tabId: string
  groupId: string | null
  label: string
  startX: number
  startY: number
  currentX: number
  currentY: number
  active: boolean
  pointerId: number
  dropTarget: DropTarget | null
}

interface DropTarget {
  section: 'pinned' | 'group' | 'ungrouped'
  targetIndex: number
  groupId?: string | null
  position: 'before' | 'after' | 'inside'
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
        width: 200px;
        flex-shrink: 0;
        min-height: 0;
        height: 100%;
        padding: 16px 0 12px 14px;
        margin-right: 8px;
        box-sizing: border-box;
        user-select: none;
        position: relative;
        font-family: 'Geist Mono', monospace;
      }

      .tab-rail-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 10px 10px 4px;
        color: var(--text-muted);
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        font-weight: 600;
      }

      .rail-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .action-icon-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 4px;
        color: var(--text-muted);
        cursor: pointer;
        background: none;
        border: none;
        padding: 0;
        transition:
          color 120ms ease,
          background 120ms ease;
      }

      .action-icon-btn:hover {
        color: var(--text);
        background: var(--bg-hover);
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
        padding: 8px 6px 4px 6px;
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
        background: var(--border-subtle);
        margin: 6px 4px 8px 4px;
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

      .tab-row.dragging {
        opacity: 0.35;
      }

      writemd-tab {
        width: 100%;
        max-width: none;
        flex: 1;
        height: 30px;
      }

      .drop-indicator {
        height: 2px;
        background: var(--accent-primary, #f24e1e);
        border-radius: 1px;
        margin: 1px 0;
        pointer-events: none;
        box-shadow: 0 0 4px var(--accent-primary, #f24e1e);
      }

      .drag-ghost {
        position: fixed;
        pointer-events: none;
        z-index: 1000;
        padding: 6px 12px;
        border-radius: 6px;
        background: var(--menu-bg, var(--bg-hover));
        color: var(--text);
        border: 1px solid var(--border-focus);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45);
        font-size: 12px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 6px;
        opacity: 0.95;
        transform: translate3d(-9999px, -9999px, 0);
        will-change: transform;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        border: 0;
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
        border: 1px solid rgba(255, 255, 255, 0.15);
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

      .context-menu-backdrop {
        position: fixed;
        inset: 0;
        z-index: 95;
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

  @state() private dragState: DragState | null = null
  @state() private contextMenu: ContextMenuState | null = null
  @state() private renamingGroupId: string | null = null
  @state() private liveAnnouncement = ''

  private fileState = FileState.getInstance()
  private unsubscribeFileState: (() => void) | null = null
  private wasDragging = false

  connectedCallback(): void {
    super.connectedCallback()
    const current = this.fileState.getState()
    if (this.tabs.length === 0 && current.tabs.length > 0) {
      this.tabs = current.tabs
      this.activeTab = current.activeTab
    }
    if (this.tabGroups.length === 0 && (current.tabGroups?.length ?? 0) > 0) {
      this.tabGroups = current.tabGroups ?? []
    }
    this.unsubscribeFileState = this.fileState.subscribe((s) => {
      this.tabs = s.tabs
      this.tabGroups = s.tabGroups ?? []
      this.activeTab = s.activeTab
      this.requestUpdate()
    })
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.unsubscribeFileState?.()
    this.unsubscribeFileState = null
  }

  private announce(message: string): void {
    this.liveAnnouncement = message
  }

  // --- Pointer Drag & Drop Engine ---

  private handlePointerDownTab(e: PointerEvent, tabIndex: number, tabId: string): void {
    if (e.button !== 0) return

    const label = tabLabel(this.tabs[tabIndex]?.path ?? null)
    this.dragState = {
      type: 'tab',
      tabIndex,
      tabId,
      groupId: this.tabs[tabIndex]?.groupId ?? null,
      label,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      active: false,
      pointerId: e.pointerId,
      dropTarget: null
    }
  }

  private handlePointerDownGroup(e: PointerEvent, groupId: string): void {
    if (e.button !== 0) return

    const group = this.tabGroups.find((g) => g.id === groupId)
    this.dragState = {
      type: 'group',
      tabIndex: -1,
      tabId: groupId,
      groupId,
      label: group?.label ?? 'Group',
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      active: false,
      pointerId: e.pointerId,
      dropTarget: null
    }
  }

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.dragState || this.dragState.pointerId !== e.pointerId) return

    const dx = e.clientX - this.dragState.startX
    const dy = e.clientY - this.dragState.startY
    const distance = Math.sqrt(dx * dx + dy * dy)

    if (!this.dragState.active && distance > 4) {
      this.dragState = { ...this.dragState, active: true }
      const target = e.currentTarget as HTMLElement | null
      try {
        target?.setPointerCapture?.(e.pointerId)
      } catch {
        // ignore
      }
      this.announce(`Started dragging ${this.dragState.label}`)
    }

    if (!this.dragState.active) return

    this.dragState = {
      ...this.dragState,
      currentX: e.clientX,
      currentY: e.clientY
    }

    this.updateAutoScroll(e.clientY)
    this.computeDropTarget(e.clientY)
  }

  private updateAutoScroll(clientY: number): void {
    const scrollEl = this.renderRoot?.querySelector('.scroll-container') as HTMLElement | null
    if (!scrollEl) return

    const rect = scrollEl.getBoundingClientRect()
    const threshold = 36
    const maxSpeed = 10

    if (clientY < rect.top + threshold) {
      const ratio = 1 - Math.max(0, clientY - rect.top) / threshold
      scrollEl.scrollTop -= maxSpeed * ratio
    } else if (clientY > rect.bottom - threshold) {
      const ratio = 1 - Math.max(0, rect.bottom - clientY) / threshold
      scrollEl.scrollTop += maxSpeed * ratio
    }
  }

  private computeDropTarget(clientY: number): void {
    if (!this.dragState || !this.dragState.active) return

    const tabRows = Array.from(
      this.renderRoot.querySelectorAll('.tab-row[data-tab-index]')
    ) as HTMLElement[]

    if (this.dragState.type === 'tab') {
      let closestTarget: DropTarget | null = null

      // Check pinned section
      const pinnedContainer = this.renderRoot.querySelector('.pinned-section')
      if (pinnedContainer) {
        const pinnedRect = pinnedContainer.getBoundingClientRect()
        if (clientY <= pinnedRect.bottom) {
          const pinnedRows = tabRows.filter((r) => r.dataset['pinned'] === 'true')
          let targetIdx = 0
          for (let i = 0; i < pinnedRows.length; i++) {
            const box = pinnedRows[i].getBoundingClientRect()
            if (clientY < box.top + box.height / 2) {
              targetIdx = Number(pinnedRows[i].dataset['tabIndex'])
              break
            }
            if (i === pinnedRows.length - 1) {
              targetIdx = Number(pinnedRows[i].dataset['tabIndex']) + 1
            }
          }
          this.dragState = {
            ...this.dragState,
            dropTarget: { section: 'pinned', targetIndex: targetIdx, position: 'before' }
          }
          return
        }
      }

      // Check group headers
      const groupHeaders = Array.from(
        this.renderRoot.querySelectorAll('.group-header')
      ) as HTMLElement[]
      for (const gh of groupHeaders) {
        const gBox = gh.getBoundingClientRect()
        if (clientY >= gBox.top && clientY <= gBox.bottom) {
          const gid = gh.dataset['groupId']
          this.dragState = {
            ...this.dragState,
            dropTarget: {
              section: 'group',
              targetIndex: -1,
              groupId: gid,
              position: 'inside'
            }
          }
          return
        }
      }

      // General tab-to-tab hit test
      for (let i = 0; i < tabRows.length; i++) {
        const box = tabRows[i].getBoundingClientRect()
        const tabIdx = Number(tabRows[i].dataset['tabIndex'])
        const gid = tabRows[i].dataset['groupId'] ?? null
        const isPinned = tabRows[i].dataset['pinned'] === 'true'

        if (clientY < box.top + box.height / 2) {
          closestTarget = {
            section: isPinned ? 'pinned' : gid ? 'group' : 'ungrouped',
            targetIndex: tabIdx,
            groupId: gid,
            position: 'before'
          }
          break
        }
        if (i === tabRows.length - 1) {
          closestTarget = {
            section: isPinned ? 'pinned' : gid ? 'group' : 'ungrouped',
            targetIndex: tabIdx + 1,
            groupId: gid,
            position: 'after'
          }
        }
      }

      this.dragState = { ...this.dragState, dropTarget: closestTarget }
    } else {
      // Dragging a group: reorder relative to other groups
      const groupElements = Array.from(
        this.renderRoot.querySelectorAll('.tab-group-container')
      ) as HTMLElement[]
      let targetIdx = this.tabGroups.length
      for (let i = 0; i < groupElements.length; i++) {
        const box = groupElements[i].getBoundingClientRect()
        if (clientY < box.top + box.height / 2) {
          targetIdx = i
          break
        }
      }
      this.dragState = {
        ...this.dragState,
        dropTarget: { section: 'group', targetIndex: targetIdx, position: 'before' }
      }
    }
  }

  private handlePointerUp = (e: PointerEvent): void => {
    if (!this.dragState || this.dragState.pointerId !== e.pointerId) return
    const target = e.currentTarget as HTMLElement | null
    try {
      if (target?.hasPointerCapture?.(e.pointerId)) {
        target.releasePointerCapture(e.pointerId)
      }
    } catch {
      // ignore
    }

    if (this.dragState.active) {
      this.wasDragging = true
      setTimeout(() => {
        this.wasDragging = false
      }, 50)
      if (this.dragState.dropTarget) {
        this.commitDrop(this.dragState)
      }
    }

    this.dragState = null
  }

  private commitDrop(drag: DragState): void {
    const { dropTarget, tabIndex, type, groupId } = drag
    if (!dropTarget) return

    if (type === 'tab') {
      const sourceTab = this.tabs[tabIndex]
      if (!sourceTab) return

      if (dropTarget.section === 'pinned') {
        // Pin the tab
        if (!sourceTab.isPinned) {
          this.fileState.pinTab(tabIndex)
          this.announce(`Pinned tab ${drag.label}`)
        } else {
          // Reorder within pinned
          const clamped = Math.max(0, Math.min(dropTarget.targetIndex, this.tabs.length - 1))
          this.fileState.moveTab(tabIndex, clamped)
          this.announce(`Moved pinned tab ${drag.label}`)
        }
      } else if (dropTarget.section === 'group') {
        if (dropTarget.position === 'inside' && dropTarget.groupId) {
          // Move tab into group
          this.fileState.setTabGroup(tabIndex, dropTarget.groupId)
          this.announce(`Added ${drag.label} to group`)
        } else {
          // Reorder inside group or adjacent
          if (sourceTab.isPinned) this.fileState.unpinTab(tabIndex)
          const clamped = Math.max(0, Math.min(dropTarget.targetIndex, this.tabs.length - 1))
          this.fileState.moveTab(tabIndex, clamped)
          if (dropTarget.groupId) {
            this.fileState.setTabGroup(clamped, dropTarget.groupId)
          }
          this.announce(`Moved tab ${drag.label}`)
        }
      } else {
        // Ungrouped drop
        if (sourceTab.isPinned) {
          this.fileState.unpinTab(tabIndex)
        }
        if (sourceTab.groupId) {
          this.fileState.setTabGroup(tabIndex, null)
        }
        const clamped = Math.max(0, Math.min(dropTarget.targetIndex, this.tabs.length - 1))
        this.fileState.moveTab(tabIndex, clamped)
        this.announce(`Moved tab ${drag.label}`)
      }
    } else if (type === 'group' && groupId) {
      const sourceGroupIdx = this.tabGroups.findIndex((g) => g.id === groupId)
      if (sourceGroupIdx >= 0 && dropTarget.targetIndex !== sourceGroupIdx) {
        this.fileState.reorderTabGroups(sourceGroupIdx, dropTarget.targetIndex)
        this.announce(`Reordered group ${drag.label}`)
      }
    }
  }

  // --- Context Menu Handlers ---

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

  private handleCreateGroup(): void {
    const defaultLabel = `Group ${(this.tabGroups?.length ?? 0) + 1}`
    const id = this.fileState.createTabGroup(defaultLabel)
    this.renamingGroupId = id
    this.focusRenameInput(id)
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
    const isDraggingThis = this.dragState?.active && this.dragState.tabIndex === index
    const isDropIndicatorTarget =
      this.dragState?.active &&
      this.dragState.dropTarget &&
      this.dragState.dropTarget.targetIndex === index

    return html`
      ${isDropIndicatorTarget && this.dragState?.dropTarget?.position === 'before'
        ? html`<div class="drop-indicator"></div>`
        : ''}
      <div
        class="tab-row ${isDraggingThis ? 'dragging' : ''}"
        data-tab-index=${index}
        data-tab-id=${tab.id ?? `tab-${index}`}
        data-pinned=${tab.isPinned ? 'true' : 'false'}
        data-group-id=${tab.groupId ?? ''}
        @click=${() => {
          if (this.dragState?.active || this.wasDragging) return
          this.dispatchEvent(
            new CustomEvent('select-tab', {
              detail: { index },
              bubbles: true,
              composed: true
            })
          )
        }}
        @pointerdown=${(e: PointerEvent) =>
          this.handlePointerDownTab(e, index, tab.id ?? `tab-${index}`)}
        @pointermove=${this.handlePointerMove}
        @pointerup=${this.handlePointerUp}
        @pointercancel=${this.handlePointerUp}
        @contextmenu=${(e: MouseEvent) => this.handleTabContextMenu(e, index)}
      >
        <writemd-tab
          vertical
          ?pinned=${Boolean(tab.isPinned)}
          label=${tabLabel(tab.path)}
          ?active=${index === this.activeTab}
          .dirty=${tab.dirty}
          @select=${(): void => {
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
      ${isDropIndicatorTarget && this.dragState?.dropTarget?.position === 'after'
        ? html`<div class="drop-indicator"></div>`
        : ''}
    `
  }

  private renderGroup(group: TabGroup): TemplateResult {
    const groupTabs = this.tabs
      .map((tab, idx) => ({ tab, idx }))
      .filter(({ tab }) => !tab.isPinned && tab.groupId === group.id)

    const isHoveredGroup =
      this.dragState?.active &&
      this.dragState.dropTarget?.section === 'group' &&
      this.dragState.dropTarget.groupId === group.id

    return html`
      <div class="tab-group-container" data-group-id=${group.id}>
        <div
          class="group-header ${isHoveredGroup ? 'drag-over' : ''}"
          data-group-id=${group.id}
          @click=${() => {
            if (this.dragState?.active || this.wasDragging) return
            if (this.renamingGroupId === group.id) return
            this.fileState.toggleTabGroupCollapse(group.id)
          }}
          @pointerdown=${(e: PointerEvent) => this.handlePointerDownGroup(e, group.id)}
          @pointermove=${this.handlePointerMove}
          @pointerup=${this.handlePointerUp}
          @pointercancel=${this.handlePointerUp}
          @contextmenu=${(e: MouseEvent) => this.handleGroupContextMenu(e, group.id)}
        >
          <div
            class="group-chevron ${group.collapsed ? 'collapsed' : ''}"
            @click=${(e: MouseEvent) => {
              e.stopPropagation()
              if (this.dragState?.active || this.wasDragging) return
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
          ${group.color && group.color !== 'transparent'
            ? html`<span
                class="group-color-dot"
                style="background-color: ${group.color}"
              ></span>`
            : ''}
          ${this.renamingGroupId === group.id
            ? html`
                <input
                  type="text"
                  class="group-rename-input"
                  .value=${group.label}
                  @blur=${(e: Event) =>
                    this.handleRenameGroupSubmit(
                      group.id,
                      (e.target as HTMLInputElement).value
                    )}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                      this.handleRenameGroupSubmit(
                        group.id,
                        (e.target as HTMLInputElement).value
                      )
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
              `}
        </div>
        <div class="group-tabs ${group.collapsed ? 'collapsed' : ''}">
          ${groupTabs.map(({ tab, idx }) => this.renderTabItem(tab, idx))}
        </div>
      </div>
    `
  }

  private renderContextMenu(): TemplateResult | string {
    if (!this.contextMenu) return ''
    const { type, index, groupId, x, y } = this.contextMenu

    return html`
      <div class="context-menu-backdrop" @click=${this.closeContextMenu}></div>
      <div
        class="m-panel"
        style="left: ${x}px; top: ${y}px;"
        @click=${(e: MouseEvent) => e.stopPropagation()}
      >
        ${type === 'tab' && index !== undefined
          ? html`
              ${this.tabs[index]?.isPinned
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
                  `}
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
                    ${g.color && g.color !== 'transparent'
                      ? html`<span
                          class="group-color-dot"
                          style="background-color: ${g.color}; margin-right: 4px;"
                        ></span>`
                      : ''}
                    <span>Move to ${g.label}</span>
                  </div>
                `
              )}
              <div
                class="m-item"
                @click=${() => this.handleCreateGroupWithTab(index)}
              >
                ${menuIcon('folder')}
                <span>New group with tab</span>
              </div>
              ${this.tabs[index]?.groupId
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
                : ''}
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
          : ''}
        ${type === 'group' && groupId
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
          : ''}
      </div>
    `
  }

  render(): unknown {
    const pinnedTabs = this.tabs
      .map((tab, idx) => ({ tab, idx }))
      .filter(({ tab }) => tab.isPinned)

    const ungroupedTabs = this.tabs
      .map((tab, idx) => ({ tab, idx }))
      .filter(({ tab }) => !tab.isPinned && !tab.groupId)

    const currentGroups = this.tabGroups ?? []

    return html`
      <div class="sr-only" aria-live="polite">${this.liveAnnouncement}</div>
      <div class="tab-rail-header">
        <span>Tabs</span>
        <div class="rail-actions">
          <button
            class="action-icon-btn"
            title="Create Tab Group"
            aria-label="Create Tab Group"
            @click=${this.handleCreateGroup}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
              ></path>
              <line x1="12" y1="11" x2="12" y2="17"></line>
              <line x1="9" y1="14" x2="15" y2="14"></line>
            </svg>
          </button>
          <button
            class="action-icon-btn"
            title="Open file in new tab"
            aria-label="Open file in new tab"
            @click=${(): void => {
              this.dispatchEvent(
                new CustomEvent('add-tab', { bubbles: true, composed: true })
              )
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <line x1="7" y1="2" x2="7" y2="12" />
              <line x1="2" y1="7" x2="12" y2="7" />
            </svg>
          </button>
        </div>
      </div>

      <div
        class="scroll-container"
        role="tablist"
        aria-label="Open documents"
        @scroll=${this.handleScrollContainerScroll}
      >
        ${pinnedTabs.length > 0
          ? html`
              <div class="section-label">
                <span>Pinned</span>
                <span>${pinnedTabs.length}</span>
              </div>
              <div class="pinned-section">
                ${pinnedTabs.map(({ tab, idx }) => this.renderTabItem(tab, idx))}
              </div>
              <div class="pinned-divider"></div>
            `
          : ''}
        ${currentGroups.map((group) => this.renderGroup(group))}
        ${ungroupedTabs.map(({ tab, idx }) => this.renderTabItem(tab, idx))}
        ${this.secondaryPath
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
          : ''}
      </div>

      ${this.renderContextMenu()}
      ${this.dragState?.active
        ? html`
            <div
              class="drag-ghost"
              style="transform: translate3d(${this.dragState.currentX + 12}px, ${this
                .dragState.currentY - 16}px, 0);"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                ${this.dragState.type === 'group'
                  ? html`<path
                      d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                    ></path>`
                  : html`<path
                      d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                    ></path>`}
              </svg>
              <span>${this.dragState.label}</span>
            </div>
          `
        : ''}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-vertical-tab-bar': VerticalTabBar
  }
}
