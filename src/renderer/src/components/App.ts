import { html, css, LitElement, type TemplateResult } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import './TopBar'
import './Tab'
import './VerticalTabBar'
import './DocBar'
import './Editor'
import './SettingsModal'
import './WelcomeScreen'
import './ConflictDialog'
import './CommandPalette'
import { menuStyles, menuIcon } from './menu-styles'
import { api } from '../api'
import { emit, on } from '../events/bus'
import { showConfirm } from '../services/confirm'
import { SettingsStore } from '../state/settings'
import { FileState, type ConflictInfo, type TabDoc, type TabGroup } from '../state/file-state'
import { COMMANDS, bindingFromEvent, bindingsEqual, effectiveBindings } from '../state/shortcuts'
import { initAutoHideScrollbars } from '../utils/auto-hide-scrollbars'
import {
  applyMotionPreference,
  slideIn,
  slideOut,
  watchSystemMotionPreference,
  type MotionPreference
} from '../utils/motion'

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

interface HorizontalDragState {
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
  dropTarget: {
    section: 'pinned' | 'group' | 'ungrouped'
    targetIndex: number
    groupId?: string | null
    position: 'before' | 'after' | 'inside'
  } | null
}

interface HorizontalContextMenuState {
  type: 'tab' | 'group'
  index?: number
  groupId?: string
  x: number
  y: number
}

@customElement('writemd-app')
export class WriteMdApp extends LitElement {
  static styles = [
    menuStyles,
    css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      width: 100vw;
      background: var(--bg-frame);
      color: var(--text);
    }
    /* Transparent so the frame shows through at the window edges and in the
       editor's gutter. Dark theme sets --bg-frame one step darker than --bg,
       which is what makes the shell read as a surface behind the panes. */
    .app-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
    }
    .main-area {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }
    .editor-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .tabs-row {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      width: 100%;
    }
    .tab-strip {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 0 1 auto;
      min-width: 0;
      /* offsetLeft on a tab is measured against this, so the scroll math in
         revealActiveTab() is only correct while the strip is the offset parent. */
      position: relative;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
      -webkit-app-region: drag;
    }
    .tab-strip::-webkit-scrollbar {
      display: none;
    }
    /* Only opt out of the window-drag region when tabs are actually hidden.
       A drag region swallows wheel events, so scrolling needs no-drag, but
       dropping it unconditionally would make the strip undraggable. */
    .tab-strip[data-more] {
      -webkit-app-region: no-drag;
    }
    /* Fade only the edge that still has hidden tabs, so a clipped tab reads as
       "scroll for more" rather than a rendering bug. */
    .tab-strip[data-more='right'] {
      -webkit-mask-image: linear-gradient(to right, black calc(100% - 24px), transparent 100%);
      mask-image: linear-gradient(to right, black calc(100% - 24px), transparent 100%);
    }
    .tab-strip[data-more='left'] {
      -webkit-mask-image: linear-gradient(to right, transparent 0, black 24px);
      mask-image: linear-gradient(to right, transparent 0, black 24px);
    }
    .tab-strip[data-more='both'] {
      -webkit-mask-image: linear-gradient(
        to right,
        transparent 0,
        black 24px,
        black calc(100% - 24px),
        transparent 100%
      );
      mask-image: linear-gradient(
        to right,
        transparent 0,
        black 24px,
        black calc(100% - 24px),
        transparent 100%
      );
    }
    .tab-add {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 20px;
      border-radius: 4px;
      color: var(--text-muted);
      cursor: pointer;
      flex-shrink: 0;
      -webkit-app-region: no-drag;
    }
    .tab-add:hover {
      color: var(--text);
      background: var(--bg-hover);
    }

    .h-group-wrap {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      -webkit-app-region: no-drag;
      position: relative;
    }
    .h-group-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 26px;
      padding: 0 8px 0 6px;
      border-radius: 5px;
      cursor: pointer;
      color: var(--text-secondary);
      font-family: 'Geist Mono', monospace;
      font-size: 12px;
      font-weight: 500;
      -webkit-app-region: no-drag;
      user-select: none;
      transition:
        background 100ms ease,
        color 100ms ease;
    }
    .h-group-pill:hover {
      color: var(--text);
      background: var(--bg-hover);
    }
    .h-group-pill.drag-over {
      outline: 1px dashed var(--accent-primary, #f24e1e);
    }
    .h-group-chevron {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 12px;
      height: 12px;
      color: var(--text-muted);
      transition: transform 140ms ease;
    }
    .h-group-chevron.collapsed {
      transform: rotate(-90deg);
    }
    .h-group-color {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .h-group-label {
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
    }
    .h-group-rename-input {
      width: 90px;
      min-width: 0;
      box-sizing: border-box;
      background: var(--bg-active);
      border: 1px solid var(--border-focus);
      border-radius: 3px;
      color: var(--text);
      font-family: inherit;
      font-size: 12px;
      padding: 1px 4px;
      outline: none;
    }
    .h-tab-item {
      display: inline-flex;
      align-items: center;
      touch-action: none;
      -webkit-app-region: no-drag;
      position: relative;
    }
    .h-tab-item.dragging {
      opacity: 0.35;
    }
    .h-drop-indicator {
      width: 2px;
      height: 22px;
      background: var(--accent-primary, #f24e1e);
      border-radius: 1px;
      margin: 0 2px;
      flex-shrink: 0;
      box-shadow: 0 0 4px var(--accent-primary, #f24e1e);
      -webkit-app-region: no-drag;
      pointer-events: none;
    }
    .h-pinned-divider {
      width: 1px;
      height: 16px;
      background: var(--border-subtle);
      margin: 0 4px;
      flex-shrink: 0;
    }
    .h-drag-ghost {
      position: fixed;
      pointer-events: none;
      z-index: 1000;
      padding: 4px 10px;
      border-radius: 5px;
      background: var(--menu-bg, var(--bg-hover));
      color: var(--text);
      border: 1px solid var(--border-focus);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
      font-size: 11px;
      display: flex;
      align-items: center;
      gap: 6px;
      opacity: 0.95;
      transform: translate3d(-9999px, -9999px, 0);
      will-change: transform;
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

  @state() private showWelcome = true
  @state() private showSettings = false
  // Which Settings tab to land on. Set by the AI panel's "not configured"
  // action so it opens on the section that fixes it.
  @state() private settingsTab = 'general'
  @state() private showPalette = false
  @state() private splitActive = false
  @state() private panelOrientation: 'horizontal' | 'vertical' = 'horizontal'
  @state() private verticalPanelCollapsed = false
  /**
   * True between the moment the collapse animation starts and the moment the
   * rail unmounts. Without it the element would be gone before the animation
   * could play and the panel would simply vanish.
   */
  @state() private verticalPanelLeaving = false
  @state() private tabs: TabDoc[] = []
  @state() private tabGroups: TabGroup[] = []
  @state() private activeTab = 0
  @state() private secondaryPath: string | null = null
  @state() private secondaryDirty = false
  @state() private conflict: ConflictInfo | null = null
  @state() private hDragState: HorizontalDragState | null = null
  @state() private hContextMenu: HorizontalContextMenuState | null = null
  @state() private renamingGroupId: string | null = null
  private hWasDragging = false
  private settingsStore = SettingsStore.getInstance()
  private fileState = FileState.getInstance()
  private unsubscribeFileState: (() => void) | null = null
  private unsubscribeOrientation: (() => void) | null = null
  private unsubscribeMotion: (() => void) | null = null
  private unsubscribeFileOpen: (() => void) | null = null
  private unsubscribeSettingsOpen: (() => void) | null = null
  private teardownAutoHideScrollbars: (() => void) | null = null
  private stripObserver: ResizeObserver | null = null
  private observedStrip: HTMLElement | null = null

  private get tabStrip(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.tab-strip')
  }

  /** Fade whichever edge still hides tabs. Cheap enough to run on every scroll. */
  private syncStripEdges(): void {
    const strip = this.tabStrip
    if (!strip) return
    const max = strip.scrollWidth - strip.clientWidth
    if (max <= 1) {
      strip.removeAttribute('data-more')
      return
    }
    const atStart = strip.scrollLeft <= 1
    const atEnd = strip.scrollLeft >= max - 1
    strip.dataset.more = atStart ? 'right' : atEnd ? 'left' : 'both'
  }

  private revealActiveTab(): void {
    const strip = this.tabStrip
    if (!strip) return
    this.syncStripEdges()
    const active = strip.querySelector<HTMLElement>('writemd-tab[active]')
    if (!active) return
    const pad = 12
    const left = active.offsetLeft
    const right = left + active.offsetWidth
    if (left < strip.scrollLeft + pad) {
      strip.scrollLeft = Math.max(0, left - pad)
    } else if (right > strip.scrollLeft + strip.clientWidth - pad) {
      strip.scrollLeft = right - strip.clientWidth + pad
    }
  }

  private handleStripScroll = (): void => {
    this.syncStripEdges()
  }

  /** Enter/Space on the add-tab button, which is a div. */
  private handleTabAddKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    void this.openFileDialog()
  }

  // --- Horizontal Tab Drag & Drop ---

  private handleHorizontalPointerDownTab(e: PointerEvent, tabIndex: number, tabId: string): void {
    if (e.button !== 0) return

    const label = this.tabs[tabIndex]?.path?.split(/[/\\]/).pop() ?? 'Untitled.md'
    this.hDragState = {
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

  private handleHorizontalPointerDownGroup(e: PointerEvent, groupId: string): void {
    if (e.button !== 0) return

    const group = this.tabGroups.find((g) => g.id === groupId)
    this.hDragState = {
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

  private handleHorizontalPointerMove = (e: PointerEvent): void => {
    if (!this.hDragState || this.hDragState.pointerId !== e.pointerId) return
    const dx = e.clientX - this.hDragState.startX
    const dy = e.clientY - this.hDragState.startY
    if (!this.hDragState.active && Math.hypot(dx, dy) > 4) {
      this.hDragState = { ...this.hDragState, active: true }
      const target = e.currentTarget as HTMLElement | null
      try {
        target?.setPointerCapture?.(e.pointerId)
      } catch {
        // ignore
      }
    }
    if (!this.hDragState.active) return

    this.hDragState = {
      ...this.hDragState,
      currentX: e.clientX,
      currentY: e.clientY
    }

    const strip = this.tabStrip
    if (strip) {
      const rect = strip.getBoundingClientRect()
      const threshold = 36
      const maxSpeed = 8
      if (e.clientX < rect.left + threshold) {
        const ratio = 1 - Math.max(0, e.clientX - rect.left) / threshold
        strip.scrollLeft -= maxSpeed * ratio
      } else if (e.clientX > rect.right - threshold) {
        const ratio = 1 - Math.max(0, rect.right - e.clientX) / threshold
        strip.scrollLeft += maxSpeed * ratio
      }
    }

    this.computeHorizontalDropTarget(e.clientX)
  }

  private computeHorizontalDropTarget(clientX: number): void {
    if (!this.hDragState || !this.hDragState.active) return
    const strip = this.tabStrip
    if (!strip) return

    if (this.hDragState.type === 'tab') {
      const groupPills = Array.from(strip.querySelectorAll('.h-group-pill')) as HTMLElement[]
      for (const gp of groupPills) {
        const box = gp.getBoundingClientRect()
        if (clientX >= box.left && clientX <= box.right) {
          this.hDragState = {
            ...this.hDragState,
            dropTarget: {
              section: 'group',
              targetIndex: -1,
              groupId: gp.dataset['groupId'] ?? null,
              position: 'inside'
            }
          }
          return
        }
      }

      const tabItems = Array.from(
        strip.querySelectorAll('.h-tab-item[data-tab-index]')
      ) as HTMLElement[]
      let closestTarget: {
        section: 'pinned' | 'group' | 'ungrouped'
        targetIndex: number
        groupId?: string | null
        position: 'before' | 'after' | 'inside'
      } | null = null

      for (let i = 0; i < tabItems.length; i++) {
        const box = tabItems[i].getBoundingClientRect()
        const tabIdx = Number(tabItems[i].dataset['tabIndex'])
        const gid = tabItems[i].dataset['groupId'] || null
        const isPinned = tabItems[i].dataset['pinned'] === 'true'

        if (clientX < box.left + box.width / 2) {
          closestTarget = {
            section: isPinned ? 'pinned' : gid ? 'group' : 'ungrouped',
            targetIndex: tabIdx,
            groupId: gid,
            position: 'before'
          }
          break
        }
        if (i === tabItems.length - 1) {
          closestTarget = {
            section: isPinned ? 'pinned' : gid ? 'group' : 'ungrouped',
            targetIndex: tabIdx + 1,
            groupId: gid,
            position: 'after'
          }
        }
      }
      this.hDragState = { ...this.hDragState, dropTarget: closestTarget }
    } else {
      const groupWraps = Array.from(strip.querySelectorAll('.h-group-wrap')) as HTMLElement[]
      let targetIdx = this.tabGroups.length
      for (let i = 0; i < groupWraps.length; i++) {
        const box = groupWraps[i].getBoundingClientRect()
        if (clientX < box.left + box.width / 2) {
          targetIdx = i
          break
        }
      }
      this.hDragState = {
        ...this.hDragState,
        dropTarget: { section: 'group', targetIndex: targetIdx, position: 'before' }
      }
    }
  }

  private handleHorizontalPointerUp = (e: PointerEvent): void => {
    if (!this.hDragState || this.hDragState.pointerId !== e.pointerId) return
    const target = e.currentTarget as HTMLElement | null
    try {
      if (target?.hasPointerCapture?.(e.pointerId)) {
        target.releasePointerCapture(e.pointerId)
      }
    } catch {
      // ignore
    }

    if (this.hDragState.active) {
      this.hWasDragging = true
      setTimeout(() => {
        this.hWasDragging = false
      }, 50)
      if (this.hDragState.dropTarget) {
        const { dropTarget, tabIndex, type, groupId } = this.hDragState
        if (type === 'tab') {
          const sourceTab = this.tabs[tabIndex]
          if (sourceTab) {
            if (dropTarget.section === 'pinned') {
              if (!sourceTab.isPinned) {
                this.fileState.pinTab(tabIndex)
              } else {
                const clamped = Math.max(0, Math.min(dropTarget.targetIndex, this.tabs.length - 1))
                this.fileState.moveTab(tabIndex, clamped)
              }
            } else if (dropTarget.section === 'group') {
              if (dropTarget.position === 'inside' && dropTarget.groupId) {
                this.fileState.setTabGroup(tabIndex, dropTarget.groupId)
              } else {
                if (sourceTab.isPinned) this.fileState.unpinTab(tabIndex)
                const clamped = Math.max(0, Math.min(dropTarget.targetIndex, this.tabs.length - 1))
                this.fileState.moveTab(tabIndex, clamped)
                if (dropTarget.groupId) {
                  this.fileState.setTabGroup(clamped, dropTarget.groupId)
                }
              }
            } else {
              if (sourceTab.isPinned) this.fileState.unpinTab(tabIndex)
              if (sourceTab.groupId) this.fileState.setTabGroup(tabIndex, null)
              const clamped = Math.max(0, Math.min(dropTarget.targetIndex, this.tabs.length - 1))
              this.fileState.moveTab(tabIndex, clamped)
            }
          }
        } else if (type === 'group' && groupId) {
          const sourceGroupIdx = this.tabGroups.findIndex((g) => g.id === groupId)
          if (sourceGroupIdx >= 0 && dropTarget.targetIndex !== sourceGroupIdx) {
            this.fileState.reorderTabGroups(sourceGroupIdx, dropTarget.targetIndex)
          }
        }
      }
    }
    this.hDragState = null
  }

  private focusRenameInputHorizontal(groupId: string): void {
    this.requestUpdate()
    setTimeout(() => {
      const input = this.renderRoot?.querySelector(
        `[data-group-id="${groupId}"] .h-group-rename-input`
      ) as HTMLInputElement | null
      input?.focus({ preventScroll: true })
      input?.select()
    }, 50)
  }

  private handleCreateGroupHorizontal = (): void => {
    const defaultLabel = `Group ${(this.tabGroups?.length ?? 0) + 1}`
    const id = this.fileState.createTabGroup(defaultLabel)
    this.renamingGroupId = id
    this.focusRenameInputHorizontal(id)
  }

  private handleCreateGroupWithTabHorizontal(index: number): void {
    this.hContextMenu = null
    const defaultLabel = `Group ${(this.tabGroups?.length ?? 0) + 1}`
    const id = this.fileState.createTabGroup(defaultLabel, undefined, [index])
    this.renamingGroupId = id
    this.focusRenameInputHorizontal(id)
  }

  private handleRenameGroupSubmit(groupId: string, newName: string): void {
    if (newName.trim()) {
      this.fileState.updateTabGroup(groupId, { label: newName.trim() })
    }
    this.renamingGroupId = null
  }

  private handleHorizontalTabContextMenu(e: MouseEvent, index: number): void {
    e.preventDefault()
    e.stopPropagation()
    this.hContextMenu = {
      type: 'tab',
      index,
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 200)
    }
  }

  private handleHorizontalGroupContextMenu(e: MouseEvent, groupId: string): void {
    e.preventDefault()
    e.stopPropagation()
    this.hContextMenu = {
      type: 'group',
      groupId,
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 240)
    }
  }

  private renderHorizontalTabItem(t: TabDoc, i: number): TemplateResult {
    const isDraggingThis = this.hDragState?.active && this.hDragState.tabIndex === i
    const isDropIndicatorTarget =
      this.hDragState?.active &&
      this.hDragState.dropTarget &&
      this.hDragState.dropTarget.targetIndex === i

    return html`
      ${isDropIndicatorTarget && this.hDragState?.dropTarget?.position === 'before'
        ? html`<div class="h-drop-indicator"></div>`
        : ''}
      <div
        class="h-tab-item ${isDraggingThis ? 'dragging' : ''}"
        data-tab-index=${i}
        data-tab-id=${t.id ?? `tab-${i}`}
        data-pinned=${t.isPinned ? 'true' : 'false'}
        data-group-id=${t.groupId ?? ''}
        @click=${() => {
          if (this.hDragState?.active || this.hWasDragging) return
          this.fileState.switchTab(i)
        }}
        @pointerdown=${(e: PointerEvent) =>
          this.handleHorizontalPointerDownTab(e, i, t.id ?? `tab-${i}`)}
        @pointermove=${this.handleHorizontalPointerMove}
        @pointerup=${this.handleHorizontalPointerUp}
        @pointercancel=${this.handleHorizontalPointerUp}
        @contextmenu=${(e: MouseEvent) => this.handleHorizontalTabContextMenu(e, i)}
      >
        <writemd-tab
          ?pinned=${Boolean(t.isPinned)}
          label=${t.path?.split(/[/\\]/).pop() ?? 'Untitled.md'}
          ?active=${i === this.activeTab}
          .dirty=${t.dirty}
          @select=${() => this.fileState.switchTab(i)}
          @close=${() => void this.fileState.closeTab(i)}
          @reorder-tab=${(e: CustomEvent<{ delta: -1 | 1 }>) =>
            this.fileState.moveTabRelative(i, e.detail.delta)}
        ></writemd-tab>
      </div>
      ${isDropIndicatorTarget && this.hDragState?.dropTarget?.position === 'after'
        ? html`<div class="h-drop-indicator"></div>`
        : ''}
    `
  }

  private renderHorizontalGroup(g: TabGroup): TemplateResult {
    const memberTabs = this.tabs
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !t.isPinned && t.groupId === g.id)

    const isHoveredGroup =
      this.hDragState?.active &&
      this.hDragState.dropTarget?.section === 'group' &&
      this.hDragState.dropTarget.groupId === g.id

    return html`
      <div
        class="h-group-wrap"
        data-group-id=${g.id}
      >
        <div
          class="h-group-pill ${isHoveredGroup ? 'drag-over' : ''}"
          data-group-id=${g.id}
          @click=${() => {
            if (this.hDragState?.active || this.hWasDragging) return
            if (this.renamingGroupId === g.id) return
            this.fileState.toggleTabGroupCollapse(g.id)
          }}
          @pointerdown=${(e: PointerEvent) => this.handleHorizontalPointerDownGroup(e, g.id)}
          @pointermove=${this.handleHorizontalPointerMove}
          @pointerup=${this.handleHorizontalPointerUp}
          @pointercancel=${this.handleHorizontalPointerUp}
          @contextmenu=${(e: MouseEvent) => this.handleHorizontalGroupContextMenu(e, g.id)}
        >
          <div
            class="h-group-chevron ${g.collapsed ? 'collapsed' : ''}"
            @click=${(e: MouseEvent) => {
              e.stopPropagation()
              if (this.hDragState?.active || this.hWasDragging) return
              this.fileState.toggleTabGroupCollapse(g.id)
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
          ${g.color && g.color !== 'transparent'
            ? html`<span
                class="h-group-color"
                style="background-color: ${g.color};"
              ></span>`
            : ''}
          ${this.renamingGroupId === g.id
            ? html`
                <input
                  type="text"
                  class="h-group-rename-input"
                  .value=${g.label}
                  @blur=${(e: Event) =>
                    this.handleRenameGroupSubmit(
                      g.id,
                      (e.target as HTMLInputElement).value
                    )}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                      this.handleRenameGroupSubmit(
                        g.id,
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
                  class="h-group-label"
                  @dblclick=${(e: MouseEvent) => {
                    e.stopPropagation()
                    this.renamingGroupId = g.id
                    this.focusRenameInputHorizontal(g.id)
                  }}
                  >${g.label}</span
                >
              `}
        </div>
        ${!g.collapsed ? memberTabs.map(({ t, i }) => this.renderHorizontalTabItem(t, i)) : ''}
      </div>
    `
  }

  private renderHorizontalContextMenu(): TemplateResult | string {
    if (!this.hContextMenu) return ''
    const { type, index, groupId, x, y } = this.hContextMenu

    return html`
      <div class="context-menu-backdrop" @click=${() => (this.hContextMenu = null)}></div>
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
                        this.hContextMenu = null
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
                        this.hContextMenu = null
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
                      this.hContextMenu = null
                    }}
                  >
                    ${g.color && g.color !== 'transparent'
                      ? html`<span
                          class="h-group-color"
                          style="background-color: ${g.color}; margin-right: 4px;"
                        ></span>`
                      : ''}
                    <span>Move to ${g.label}</span>
                  </div>
                `
              )}
              <div
                class="m-item"
                @click=${() => this.handleCreateGroupWithTabHorizontal(index)}
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
                        this.hContextMenu = null
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
                  void this.fileState.closeTab(index)
                  this.hContextMenu = null
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
                  this.hContextMenu = null
                  this.focusRenameInputHorizontal(gId)
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
                        this.hContextMenu = null
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
                  this.hContextMenu = null
                }}
              >
                ${menuIcon('external')}
                <span>Ungroup tabs</span>
              </div>
              <div
                class="m-item danger"
                @click=${() => {
                  this.fileState.deleteTabGroup(groupId, true)
                  this.hContextMenu = null
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

  connectedCallback(): void {
    super.connectedCallback()
    // Listener registration happens before the first await. An async
    // connectedCallback that adds listeners after an await can be torn down
    // while suspended, so disconnectedCallback runs first and removes nothing,
    // then the continuation attaches to a dead element with no teardown left.
    window.addEventListener('keydown', this.handleGlobalShortcuts)
    window.addEventListener('dragover', this.handleWindowDragOver)
    window.addEventListener('drop', this.handleWindowDrop)
    this.teardownAutoHideScrollbars = initAutoHideScrollbars()
    this.unsubscribeSettingsOpen = on('settings:open', ({ tab }) => {
      this.settingsTab = tab ?? 'general'
      this.showSettings = true
    })
    this.unsubscribeFileOpen =
      api()?.onFileOpenExternal?.((path: string) => {
        // openFile can abort on the unsaved-changes confirm. Setting
        // showWelcome eagerly would leave the app with no welcome screen and
        // no tabs once the cancel path skipped its notify(). The subscription
        // above already sets it from tabs.length, so leave it to that.
        void this.fileState.openFile(path)
      }) ?? null

    void this.initAsync()
  }

  private async initAsync(): Promise<void> {
    await this.settingsStore.init()
    if (!this.isConnected) return
    this.panelOrientation = this.settingsStore.get('appearance.panelOrientation', 'horizontal') as
      'horizontal' | 'vertical'
    this.unsubscribeOrientation = this.settingsStore.subscribe(
      'appearance.panelOrientation',
      (v) => {
        this.panelOrientation = (v as 'horizontal' | 'vertical') ?? 'horizontal'
      }
    )
    document.documentElement.setAttribute(
      'data-theme',
      this.settingsStore.get('appearance.theme', 'graphite')
    )
    // Motion is decided once, here, and every animated surface in the app tests
    // the resulting `data-motion` attribute rather than the media query itself.
    applyMotionPreference(this.settingsStore.get('appearance.motion', 'system') as MotionPreference)
    watchSystemMotionPreference()
    this.unsubscribeMotion = this.settingsStore.subscribe('appearance.motion', (v) => {
      applyMotionPreference((v as MotionPreference) ?? 'system')
    })
    this.unsubscribeFileState = this.fileState.subscribe((s) => {
      this.splitActive = s.splitActive
      this.tabs = s.tabs
      this.tabGroups = s.tabGroups ?? []
      this.activeTab = s.activeTab
      this.showWelcome = s.tabs.length === 0
      this.secondaryPath = s.secondaryDoc?.path ?? null
      this.secondaryDirty = s.secondaryDoc?.dirty ?? false
      this.conflict = s.conflict
      this.requestUpdate()
    })
    this.showWelcome = true
    await this.fileState.restoreTabs().catch(() => false)

    const { maybeShowWhatsNew } = await import('../services/whats-new')
    void maybeShowWhatsNew()
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this.handleGlobalShortcuts)
    window.removeEventListener('dragover', this.handleWindowDragOver)
    window.removeEventListener('drop', this.handleWindowDrop)
    this.teardownAutoHideScrollbars?.()
    this.teardownAutoHideScrollbars = null
    this.unsubscribeFileOpen?.()
    this.unsubscribeSettingsOpen?.()
    this.unsubscribeFileState?.()
    this.unsubscribeOrientation?.()
    this.unsubscribeMotion?.()
    this.stripObserver?.disconnect()
    this.stripObserver = null
    this.observedStrip = null
    super.disconnectedCallback()
  }

  protected updated(): void {
    const strip = this.tabStrip
    if (strip) {
      strip.addEventListener('scroll', this.handleStripScroll, { passive: true })
      if (typeof ResizeObserver !== 'undefined') {
        if (!this.stripObserver) {
          // updated() runs before the strip has been laid out, so the scroll
          // math sees a zero-width element and does nothing. The observer re-runs
          // it once real geometry exists, and again on window resize.
          this.stripObserver = new ResizeObserver(() => this.revealActiveTab())
        }
        // Flipping to vertical orientation and back renders a brand new
        // .tab-strip node. Observing only the first one left the replacement
        // without scroll-into-view and kept the detached strip referenced.
        if (this.observedStrip !== strip) {
          this.stripObserver.disconnect()
          this.observedStrip = strip
          this.stripObserver.observe(strip)
        }
      }
    } else {
      // The welcome screen has no strip. Stop observing rather than dropping the
      // reference alone, which would leave the detached node observed.
      this.stripObserver?.disconnect()
      this.observedStrip = null
    }
    this.revealActiveTab()
  }

  private handleWindowDragOver = (e: DragEvent): void => {
    e.preventDefault()
  }

  private handleWindowDrop = async (e: DragEvent): Promise<void> => {
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return
    const file = files[0]
    // If it's a markdown file dropped on the window (not image handled by editor)
    if (/\.(md|markdown|mdown|mkd)$/i.test(file.name)) {
      e.preventDefault()
      e.stopPropagation()
      // In Electron, File objects dropped from the OS have a 'path' property
      const filePath = (file as unknown as { path?: string }).path
      if (filePath) {
        await this.fileState.openFile(filePath)
        this.showWelcome = false
      }
    }
  }

  private handleGlobalShortcuts = (e: KeyboardEvent): void => {
    // Palette and settings modal get first refusal for Escape
    if (e.key === 'Escape') {
      if (this.showPalette) {
        this.showPalette = false
        return
      }
      return
    }
    // CodeMirror handles its own bindings (e.g. Mod-F) first.
    if (e.defaultPrevented) return
    // Never hijack keys while rebinding shortcuts in settings
    if (this.showSettings) return
    const pressed = bindingFromEvent(e)
    const overrides = this.settingsStore.get<Record<string, string>>('shortcuts.bindings', {})
    for (const cmd of COMMANDS) {
      const bindings = effectiveBindings(cmd.id, overrides)
      const matched = bindings.find((b) => bindingsEqual(pressed, b))
      if (!matched) continue
      if (!matched.mod && !matched.alt && !matched.shift) {
        // Bare keys must not hijack typing
        const target = e.target as HTMLElement | null
        if (
          target &&
          (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        ) {
          continue
        }
      }
      e.preventDefault()
      void this.runCommand(cmd.id)
      return
    }
  }

  private async runCommand(id: string): Promise<void> {
    this.showPalette = false
    switch (id) {
      case 'new-file':
        await this.fileState.newFile()
        this.showWelcome = false
        break
      case 'open-file':
        await this.openFileDialog()
        break
      case 'save':
        await this.fileState.save()
        break
      case 'save-as':
        await this.fileState.saveAs()
        break
      case 'export-pdf':
        await this.handleExport('pdf')
        break
      case 'export-html':
        await this.handleExport('html')
        break
      case 'export-docx':
        await this.handleExport('docx')
        break
      case 'quick-toggle':
        this.fileState.quickToggle()
        break
      case 'toggle-split':
        this.fileState.toggleSplitView()
        break
      case 'split-files':
        this.fileState.setSplitSurface('files')
        break
      case 'split-backlinks':
        this.fileState.setSplitSurface('backlinks')
        break
      case 'split-ai':
        this.fileState.setSplitSurface('ai')
        break
      case 'open-settings':
        this.showSettings = true
        break
      case 'find':
        emit('find:open', { mode: 'find' })
        break
      case 'replace':
        emit('find:open', { mode: 'replace' })
        break
      case 'command-palette':
        this.showPalette = true
        break
      case 'zoom-in':
      case 'zoom-out':
      case 'zoom-reset':
        await this.handleZoom(id)
        break
    }
  }

  private async handleZoom(id: 'zoom-in' | 'zoom-out' | 'zoom-reset'): Promise<void> {
    const bridge = api()?.window
    if (!bridge?.zoomIn) {
      alert('Zoom is unavailable. Restart the app to load the latest version.')
      return
    }
    try {
      if (id === 'zoom-in') await bridge.zoomIn()
      else if (id === 'zoom-out') await bridge.zoomOut()
      else await bridge.zoomReset()
    } catch (err) {
      console.error(`Zoom failed:`, err)
      alert(`Zoom failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async handleExport(kind: 'pdf' | 'html' | 'docx'): Promise<void> {
    const s = this.fileState.getState()
    try {
      const result = await api()?.export?.[kind]?.(s.content, s.path)
      if (result && !result.ok && result.reason !== 'canceled') {
        alert(`Export failed: ${result.reason ?? 'unknown error'}`)
      }
    } catch (err) {
      console.error(`Export ${kind} failed:`, err)
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Collapse or expand the tab rail.
   *
   * The rail is unmounted when collapsed, so a collapse has to play before the
   * state flips and an expand has to play after the element exists. Both go
   * through the shared engine, which collapses to a single frame when motion is
   * off, so there is no reduced-motion branch here.
   */
  private toggleVerticalPanel = (): void => {
    const rail = (): HTMLElement | null =>
      (this.shadowRoot?.querySelector('writemd-vertical-tab-bar') as HTMLElement | null) ?? null

    if (this.verticalPanelCollapsed) {
      this.verticalPanelCollapsed = false
      void this.updateComplete.then(() => {
        void slideIn(rail(), 'x')
      })
      return
    }

    const el = rail()
    if (!el) {
      this.verticalPanelCollapsed = true
      return
    }
    this.verticalPanelLeaving = true
    void slideOut(el, 'x').then(() => {
      this.verticalPanelCollapsed = true
      this.verticalPanelLeaving = false
    })
  }

  private async openFileDialog(): Promise<void> {
    const result = await api()?.file?.openDialog?.({
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }]
    })
    if (result && !result.canceled && result.filePaths[0]) {
      await this.fileState.openFile(result.filePaths[0])
      this.showWelcome = false
    }
  }

  private handleOpenVault = async (): Promise<void> => {
    const vaultPath = await api()
      ?.vault?.getPath?.()
      .catch(() => undefined)
    if (vaultPath) {
      await api()
        ?.shell?.openPath?.(vaultPath)
        .catch(() => undefined)
    }
  }

  private handleCloseSecondary = async (): Promise<void> => {
    if (
      this.secondaryDirty &&
      !(await showConfirm('You have unsaved changes in the split document. Close anyway?'))
    ) {
      return
    }
    this.fileState.closeSecondaryFile()
  }

  render(): unknown {
    if (this.showWelcome) {
      return html`
        <div class="app-container">
          <writemd-welcome-screen
            @new-file=${() => {
              void this.fileState.newFile()
              this.showWelcome = false
            }}
            @open-file=${() => void this.openFileDialog()}
            @open-vault=${() => void this.handleOpenVault()}
            @open-settings=${() => (this.showSettings = true)}
            @open-menu=${() => (this.showPalette = true)}
            @toggle-split=${() => this.fileState.toggleSplitView()}
            @open-recent=${(e: CustomEvent<{ path: string }>) => {
              void this.fileState.openFile(e.detail.path)
              this.showWelcome = false
            }}
          ></writemd-welcome-screen>
          ${
            this.showSettings
              ? html`<writemd-settings-modal
                  .initialTab=${this.settingsTab}
                  @close=${() => (this.showSettings = false)}
                ></writemd-settings-modal>`
              : ''
          }
          ${
            this.showPalette
              ? html`<writemd-command-palette
                  @close=${() => (this.showPalette = false)}
                  @run-command=${(e: CustomEvent<{ id: string }>) => void this.runCommand(e.detail.id)}
                ></writemd-command-palette>`
              : ''
          }
          ${this.conflict ? html`<writemd-conflict-dialog .conflict=${this.conflict}></writemd-conflict-dialog>` : ''}
        </div>
      `
    }

    const secondaryName = this.secondaryPath
      ? (this.secondaryPath.split(/[/\\]/).pop() ?? 'Secondary.md')
      : null

    const pinnedTabs = this.tabs
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.isPinned)
    const ungroupedTabs = this.tabs
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !t.isPinned && !t.groupId)

    return html`
      <div class="app-container">
        <writemd-top-bar
          .splitActive=${this.splitActive}
          .showPanelToggle=${this.panelOrientation === 'vertical'}
          .panelCollapsed=${this.verticalPanelCollapsed}
          @open-menu=${() => (this.showPalette = true)}
          @open-settings=${() => (this.showSettings = true)}
          @toggle-split=${() => this.fileState.toggleSplitView()}
          @toggle-panel=${this.toggleVerticalPanel}
        >
          <div
            slot="tabs"
            class="tabs-row"
            style="${this.panelOrientation === 'vertical' ? 'flex: 1;' : ''}"
          >
            ${
              this.panelOrientation === 'vertical'
                ? html`<writemd-doc-bar compact></writemd-doc-bar>`
                : html`
                    <div class="tab-strip" role="tablist" aria-label="Open documents">
                      ${pinnedTabs.map(({ t, i }) => this.renderHorizontalTabItem(t, i))}
                      ${pinnedTabs.length > 0 ? html`<div class="h-pinned-divider"></div>` : ''}

                      ${this.tabGroups.map((g) => this.renderHorizontalGroup(g))}

                      ${ungroupedTabs.map(({ t, i }) => this.renderHorizontalTabItem(t, i))}

                      ${
                        secondaryName
                          ? html`
                              <writemd-tab
                                label=${secondaryName}
                                ?active=${false}
                                .dirty=${this.secondaryDirty}
                                @close=${this.handleCloseSecondary}
                              ></writemd-tab>
                            `
                          : ''
                      }
                    </div>
                    <div
                      class="rail-actions"
                      style="display:flex;align-items:center;gap:3px;-webkit-app-region:no-drag;"
                    >
                      <div
                        class="tab-add"
                        role="button"
                        tabindex="0"
                        aria-label="Create Tab Group"
                        title="Create Tab Group"
                        @click=${this.handleCreateGroupHorizontal}
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
                      </div>
                      <div
                        class="tab-add"
                        role="button"
                        tabindex="0"
                        aria-label="Open file in new tab"
                        title="Open file in new tab"
                        @click=${() => void this.openFileDialog()}
                        @keydown=${this.handleTabAddKey}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.5"
                        >
                          <line x1="7" y1="2" x2="7" y2="12" />
                          <line x1="2" y1="7" x2="12" y2="7" />
                        </svg>
                      </div>
                    </div>
                  `
            }
          </div>
        </writemd-top-bar>

        <div class="main-area">
          ${
            this.panelOrientation === 'vertical' &&
            (!this.verticalPanelCollapsed || this.verticalPanelLeaving)
              ? html`<writemd-vertical-tab-bar
                  class=${this.verticalPanelLeaving ? 'leaving' : ''}
                  .tabs=${this.tabs}
                  .activeTab=${this.activeTab}
                  .tabGroups=${this.tabGroups}
                  .secondaryPath=${this.secondaryPath}
                  .secondaryDirty=${this.secondaryDirty}
                  @select-tab=${(e: CustomEvent<{ index: number }>) =>
                    this.fileState.switchTab(e.detail.index)}
                  @close-tab=${(e: CustomEvent<{ index: number }>) =>
                    void this.fileState.closeTab(e.detail.index)}
                  @add-tab=${() => void this.openFileDialog()}
                  @close-secondary=${this.handleCloseSecondary}
                ></writemd-vertical-tab-bar>`
              : ''
          }
          <div class="editor-wrapper">
            <writemd-editor></writemd-editor>
          </div>
        </div>

        ${
          this.showSettings
            ? html`<writemd-settings-modal
                .initialTab=${this.settingsTab}
                @close=${() => (this.showSettings = false)}
              ></writemd-settings-modal>`
            : ''
        }
        ${
          this.showPalette
            ? html`<writemd-command-palette
                @close=${() => (this.showPalette = false)}
                @run-command=${(e: CustomEvent<{ id: string }>) => void this.runCommand(e.detail.id)}
              ></writemd-command-palette>`
            : ''
        }
        ${
          this.conflict
            ? html`<writemd-conflict-dialog .conflict=${this.conflict}></writemd-conflict-dialog>`
            : ''
        }
        ${this.renderHorizontalContextMenu()}
        ${this.hDragState?.active
          ? html`
              <div
                class="h-drag-ghost"
                style="transform: translate3d(${this.hDragState.currentX + 10}px, ${this
                  .hDragState.currentY + 10}px, 0);"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  ${this.hDragState.type === 'group'
                    ? html`<path
                        d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                      ></path>`
                    : html`<path
                        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                      ></path>`}
                </svg>
                <span>${this.hDragState.label}</span>
              </div>
            `
          : ''}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-app': WriteMdApp
  }
}
