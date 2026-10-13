import './ContextMenu'
import { repeat } from 'lit/directives/repeat.js'
import { html, css, LitElement, type TemplateResult, type PropertyValues } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import './TopBar'
import './Tab'
import { TabDragController } from '../controllers/tab-drag'
import { groupRowIcon, renderGroupIconPicker, renderGroupMenuIcon } from './group-icons'
import { chromeKey } from '../state/chrome-selector'
import './VerticalTabBar'
import type { VerticalTabBar } from './VerticalTabBar'
import './RailFrame'
import './Shell'
import './Sidebar'
import './Background'
import './DocBar'
import './Editor'
import './ai/QuickAi'
import type { QuickAi } from './ai/QuickAi'
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
import { showSecondaryDocument } from '../utils/secondary-document'
import { sameFilePath } from '../utils/paths'
import type { QuickAiContext } from './ai/quick-context'
import { quickAiReplacement } from './ai/quick-context'
import type { PreviewChangeView } from './ai/types'
import {
  applyMotionPreference,
  watchSystemMotionPreference,
  type MotionPreference
} from '../utils/motion'

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
        background: var(--frame-surface, var(--bg-frame));
        color: var(--text);
      }
      :host(.settings-open) {
        background: transparent;
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
        position: relative;
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
        z-index: 1;
      }
      .tabs-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        width: 100%;
      }
      .welcome-title {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font: 500 13px var(--font-ui);
        color: var(--text-secondary);
        pointer-events: none;
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
      .tab-add svg {
        width: var(--icon-size, 18px);
        height: var(--icon-size, 18px);
        flex-shrink: 0;
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
        gap: 8px;
        height: 26px;
        padding: 0 10px 0 11px;
        box-sizing: border-box;
        border-radius: 5px;
        cursor: pointer;
        color: var(--text-secondary);
        font-family: var(--font-ui);
        font-size: 13px;
        line-height: 18px;
        font-weight: 400;
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
        background: var(--bg-hover);
        color: var(--text);
        outline: 1px dashed var(--accent);
        outline-offset: -1px;
      }
      [data-drop-target] {
        outline: 1px solid var(--border-focus);
        outline-offset: -1px;
      }
      .h-group-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--icon-size, 18px);
        height: var(--icon-size, 18px);
        flex-shrink: 0;
      }
      .h-group-icon svg {
        width: 100%;
        height: 100%;
      }
      .h-group-label {
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: inherit;
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
        font-size: inherit;
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
      .h-pinned-divider {
        width: 1px;
        height: 16px;
        background: var(--border-subtle);
        margin: 0 4px;
        flex-shrink: 0;
      }
      .m-panel {
        position: fixed;
        z-index: 100;
      }
    `
  ]

  @state() private showWelcome = true
  @state() private showSettings = false
  // Which Settings tab to land on, so a deep link can open the exact section
  // it wants rather than leaving the user to find it.
  @state() private settingsTab = 'general'
  @state() private showPalette = false
  @state() private splitActive = false
  @state() private aiEnabled = false
  @state() private aiAutoAcceptEdits = false
  @state() private aiDockOpen = false
  @state() private quickAiOpen = false
  /**
   * The bar is open but held behind a handle.
   *
   * Kept here rather than inside the bar so the AI icon knows which way its
   * toggle goes: closing it and putting it away are different things, and the
   * icon has to mean exactly one of them.
   */
  @state() private quickAiCollapsed = false
  /** A question the bar opens with, so Explain and Summarize need no typing. */
  @state() private quickAiPrompt = ''
  @state() private quickAiContext: QuickAiContext = { path: null, content: '', selection: null }
  @state() private panelOrientation: 'horizontal' | 'vertical' = 'vertical'
  @state() private verticalPanelCollapsed = false
  /**
   * True between the moment the collapse animation starts and the moment the
   * rail unmounts. Without it the element would be gone before the animation
   * could play and the panel would simply vanish.
   */
  @state() private tabs: TabDoc[] = []
  @state() private tabGroups: TabGroup[] = []
  @state() private activeTab = 0
  @state() private secondaryPath: string | null = null
  @state() private secondaryDirty = false
  @state() private conflict: ConflictInfo | null = null
  @state() private hContextMenu: HorizontalContextMenuState | null = null
  @state() private renamingGroupId: string | null = null
  private tabDrag = new TabDragController(this, 'x')
  private settingsStore = SettingsStore.getInstance()
  private fileState = FileState.getInstance()
  private unsubscribeFileState: (() => void) | null = null
  private unsubscribeOrientation: (() => void) | null = null
  private unsubscribeAi: (() => void) | null = null
  private unsubscribeAiAutoAccept: (() => void) | null = null
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
    if (this.tabDrag.active) return
    const strip = this.tabStrip
    if (!strip) return
    this.syncStripEdges()
    const active = strip.querySelector<HTMLElement>('writemd-tab[active]')
    if (!active) return
    const pad = 12
    const tabBox = active.getBoundingClientRect()
    const stripBox = strip.getBoundingClientRect()
    if (tabBox.left < stripBox.left + pad) {
      strip.scrollLeft += tabBox.left - stripBox.left - pad
    } else if (tabBox.right > stripBox.right - pad) {
      strip.scrollLeft += tabBox.right - stripBox.right + pad
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

  /** The vertical tab bar owns its own rename input, so it creates the group. */
  private handleCreateGroupVertical = (): void => {
    const bar = this.renderRoot?.querySelector('writemd-vertical-tab-bar') as VerticalTabBar | null
    bar?.createGroup()
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
    return html`
      <div
        class="h-tab-item"
        data-tab-index=${i}
        data-tab-id=${t.id ?? `tab-${i}`}
        data-pinned=${t.isPinned ? 'true' : 'false'}
        data-group-id=${t.groupId ?? ''}
        @click=${() => {
          if (this.tabDrag.suppressClick) return
          this.fileState.switchTab(i)
        }}
        @contextmenu=${(e: MouseEvent) => this.handleHorizontalTabContextMenu(e, i)}
      >
        <writemd-tab
          ?pinned=${Boolean(t.isPinned)}
          label=${t.path?.split(/[/\\]/).pop() ?? 'Untitled.md'}
          ?active=${i === this.activeTab}
          .dirty=${t.dirty}
          @select=${() => {
            if (!this.tabDrag.suppressClick) this.fileState.switchTab(i)
          }}
          @close=${() => void this.fileState.closeTab(i)}
          @reorder-tab=${(e: CustomEvent<{ delta: -1 | 1 }>) =>
            this.fileState.moveTabRelative(i, e.detail.delta)}
        ></writemd-tab>
      </div>
    `
  }

  private renderHorizontalGroup(g: TabGroup): TemplateResult {
    const memberTabs = this.tabs
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !t.isPinned && t.groupId === g.id)

    return html`
      <div class="h-group-wrap" data-group-id=${g.id}>
        <div
          class="h-group-pill"
          data-group-id=${g.id}
          @click=${() => {
            if (this.tabDrag.suppressClick) return
            if (this.renamingGroupId === g.id) return
            this.fileState.toggleTabGroupCollapse(g.id)
          }}
          @contextmenu=${(e: MouseEvent) => this.handleHorizontalGroupContextMenu(e, g.id)}
        >
          <div
            class="h-group-icon"
            data-no-drag
            @click=${(e: MouseEvent) => {
              e.stopPropagation()
              if (this.tabDrag.suppressClick) return
              this.fileState.toggleTabGroupCollapse(g.id)
            }}
          >
            ${groupRowIcon(g)}
          </div>
          ${
            this.renamingGroupId === g.id
              ? html`
                  <input
                    type="text"
                    class="h-group-rename-input"
                    .value=${g.label}
                    @blur=${(e: Event) =>
                      this.handleRenameGroupSubmit(g.id, (e.target as HTMLInputElement).value)}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === 'Enter') {
                        this.handleRenameGroupSubmit(g.id, (e.target as HTMLInputElement).value)
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
                `
          }
        </div>
        ${
          !g.collapsed
            ? repeat(
                memberTabs,
                ({ t }) => t.id,
                ({ t, i }) => this.renderHorizontalTabItem(t, i)
              )
            : ''
        }
      </div>
    `
  }

  private renderHorizontalContextMenu(): TemplateResult | string {
    if (!this.hContextMenu) return ''
    const { type, index, groupId, x, y } = this.hContextMenu
    const openGroup = this.tabGroups?.find((group) => group.id === groupId)

    return html`
      <writemd-context-menu
        slot="overlay"
        .x=${this.hContextMenu.x}
        .y=${this.hContextMenu.y}
        @menu-dismiss=${() => (this.hContextMenu = null)}
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
                        `
                  }
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
                        ${renderGroupMenuIcon(g)}
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
                  ${
                    this.tabs[index]?.groupId
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
                      : ''
                  }
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
                      this.hContextMenu = null
                      this.focusRenameInputHorizontal(gId)
                    }}
                  >
                    ${menuIcon('pencil')}
                    <span>Rename group</span>
                  </div>
                  <div class="m-divider"></div>
                  ${renderGroupIconPicker(openGroup?.icon, (id) => {
                    this.fileState.updateTabGroup(groupId, { icon: id })
                    this.hContextMenu = null
                  })}
                  <div class="m-divider"></div>
                  <div
                    class="m-item"
                    @click=${() => {
                      void this.fileState.deleteTabGroup(groupId, false)
                      this.hContextMenu = null
                    }}
                  >
                    ${menuIcon('external')}
                    <span>Ungroup tabs</span>
                  </div>
                  <div
                    class="m-item danger"
                    @click=${() => {
                      void this.fileState.deleteTabGroup(groupId, true)
                      this.hContextMenu = null
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
      this.closeQuickAiForDialog()
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
    this.panelOrientation = this.settingsStore.get('appearance.panelOrientation', 'vertical') as
      'horizontal' | 'vertical'
    this.aiEnabled = this.settingsStore.get('ai.enabled', true)
    this.aiAutoAcceptEdits = this.settingsStore.get('ai.autoAcceptEdits', false)
    this.unsubscribeAiAutoAccept = this.settingsStore.subscribe('ai.autoAcceptEdits', (value) => {
      this.aiAutoAcceptEdits = Boolean(value)
    })
    this.unsubscribeAi = this.settingsStore.subscribe('ai.enabled', (value) => {
      this.aiEnabled = Boolean(value)
      if (!this.aiEnabled) {
        this.fileState.toggleAiDock(false)
        this.quickAiOpen = false
      }
    })
    this.unsubscribeOrientation = this.settingsStore.subscribe(
      'appearance.panelOrientation',
      (v) => {
        this.panelOrientation = (v as 'horizontal' | 'vertical') ?? 'vertical'
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
    this.unsubscribeFileState = this.fileState.subscribeSelector(chromeKey, (_, s) => {
      this.splitActive = s.splitActive
      this.aiDockOpen = s.aiDockOpen
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
    this.unsubscribeAi?.()
    this.unsubscribeAiAutoAccept?.()
    this.unsubscribeMotion?.()
    this.stripObserver?.disconnect()
    this.stripObserver = null
    this.observedStrip = null
    super.disconnectedCallback()
  }

  protected updated(changed: PropertyValues): void {
    this.classList.toggle('settings-open', this.showSettings)
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
    if (
      !this.tabDrag.active &&
      (changed.has('activeTab') || changed.has('tabs') || changed.has('panelOrientation'))
    )
      requestAnimationFrame(() => {
        if (this.isConnected) this.revealActiveTab()
      })
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
      const filePath = api()?.file?.getPathForFile?.(file)
      if (filePath) {
        try {
          await api()?.file?.registerDroppedPaths?.([filePath])
          await this.fileState.openFile(filePath)
        } catch (error) {
          alert(
            `Could not open dropped file: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    }
  }

  private handleGlobalShortcuts = (e: KeyboardEvent): void => {
    // Palette and settings modal get first refusal for Escape
    if (e.key === 'Escape') {
      if (this.tabDrag.active) {
        this.tabDrag.cancel()
        e.preventDefault()
        return
      }
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
      case 'split-document':
        void showSecondaryDocument(this.fileState)
        break
      case 'split-preview':
        this.fileState.setSplitSurface('preview')
        break
      case 'toggle-ai':
        // The bar is the AI surface the buttons open, so the shortcut follows
        // them rather than reaching past them to the panel.
        this.toggleQuickAi()
        break
      case 'ai-chat':
        if (this.aiEnabled) {
          this.closeQuickAiForDialog()
          this.fileState.toggleAiDock(true)
        }
        break
      case 'toggle-sidebar':
        if (this.panelOrientation === 'vertical') this.toggleVerticalPanel()
        break
      case 'ai-selection':
        this.renderRoot.querySelector('writemd-editor')?.openSelectionMenu()
        break
      case 'open-settings':
        this.closeQuickAiForDialog()
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
    this.verticalPanelCollapsed = !this.verticalPanelCollapsed
  }

  private toggleQuickAi = (): void => {
    if (!this.aiEnabled) return
    if (this.quickAiOpen) {
      this.quickAiOpen = false
      return
    }
    this.openQuickAi()
  }

  /**
   * Open the bar over the current note.
   *
   * The single entry point for everything that used to go straight to the panel:
   * the AI buttons, the hotkey, and Explain and Summarize from the text menu.
   * A prompt means the caller already knows the question, so it is typed in for
   * them - one click does the whole job, which is what those menu items did.
   */
  private openQuickAi(action?: { prompt: string; context?: QuickAiContext }): void {
    if (!this.aiEnabled) return
    if (this.aiDockOpen) this.fileState.toggleAiDock(false)
    // A caller that captured its own selection brings that context; anything
    // else reads whatever is selected in the pane with focus.
    const editor = this.renderRoot.querySelector('writemd-editor') as
      (HTMLElement & { getQuickAiContext: () => QuickAiContext }) | null
    const captured = action?.context ??
      editor?.getQuickAiContext() ?? { path: null, content: '', selection: null }
    // The bar reaches the whole vault, so it needs the same things the panel
    // sends: open tabs by path, and `@` notes resolved at send time.
    this.quickAiContext = {
      ...captured,
      openPaths: [
        ...new Set(this.tabs.map((tab) => tab.path).filter((path): path is string => !!path))
      ]
    }
    this.quickAiPrompt = action?.prompt ?? ''
    // A collapsed bar is still open: it is the same conversation, held behind a
    // handle. Opening from anywhere puts the prompt back.
    this.quickAiCollapsed = false
    this.quickAiOpen = true
  }

  /**
   * The pane the quick AI bar floats over: the note being written in.
   *
   * Null with no document open, which the bar reads as "use the whole content
   * area" - the welcome screen has no pane to sit inside.
   */
  private quickAiPane = (): HTMLElement | null => {
    const editor = this.renderRoot.querySelector('writemd-editor') as
      (HTMLElement & { quickAiPane?: HTMLElement | null }) | null
    return editor?.quickAiPane ?? null
  }

  private readQuickAiContext = (): QuickAiContext => {
    const context = this.quickAiContext
    const state = this.fileState.getState()
    const doc =
      state.tabs.find((tab) => sameFilePath(tab.path, context.path)) ??
      (sameFilePath(state.secondaryDoc?.path, context.path) ? state.secondaryDoc : null)
    if (!doc) return context
    const selection = context.selection
    return {
      ...context,
      content: doc.content,
      selection:
        selection && doc.content.slice(selection.from, selection.to) === selection.text
          ? selection
          : null
    }
  }

  /**
   * Settings and the command bar both want the middle of the window, and the
   * bar is the higher layer of the two. Closing it means an opening dialog is
   * never drawn under a prompt the user can no longer see.
   */
  private closeQuickAiForDialog(): void {
    if (this.quickAiOpen) this.quickAiOpen = false
  }

  private applyQuickAi = (
    event: CustomEvent<{ change: PreviewChangeView; context: QuickAiContext }>
  ): Promise<void> =>
    this.acceptQuickAi(event).catch((error: unknown) => {
      this.renderRoot
        .querySelector('writemd-ai-quick')
        ?.reportApplyError(
          error instanceof Error ? error.message : 'Could not apply the edit. Try again.',
          event.detail.change
        )
    })

  private async acceptQuickAi(
    event: CustomEvent<{ change: PreviewChangeView; context: QuickAiContext }>
  ): Promise<void> {
    const { change, context } = event.detail
    const current = this.fileState.getState()
    const secondary = current.secondaryDoc
    const isSecondary =
      !!secondary?.path && !!context.path && sameFilePath(secondary.path, context.path)
    const currentPath = isSecondary ? (secondary?.path ?? null) : current.path
    const currentContent = isSecondary ? (secondary?.content ?? '') : current.content
    const bar = this.renderRoot.querySelector('writemd-ai-quick')
    /*
     * Which route this is depends on the file the change is for, not the file
     * the bar happened to open over. The bar reaches external Markdown too, so
     * accepting can target a note that is not the one on screen.
     */
    const isOpenNote =
      !!context.path &&
      !!currentPath &&
      sameFilePath(context.path, currentPath) &&
      sameFilePath(change.path, context.path)
    if (!isOpenNote) {
      /*
       * Not the note on screen, so the editor has no state for it. The bar
       * reaches external Markdown too, so this is a normal case rather than a
       * refusal: write it the way a manual edit would be written.
       */
      void this.writeSuggestedFile(change, bar)
      return
    }
    const replacement = quickAiReplacement(context, change)
    if (replacement === null || currentContent !== context.content) {
      bar?.reportApplyError(
        'This note changed after the suggestion was made. Ask again to get a current suggestion.',
        change
      )
      return
    }
    const saved = await this.fileState.applyAiEdit(context.path!, context.content, replacement)
    if (!saved) {
      bar?.reportApplyError(
        'Could not save the edit. The changed text is still in the editor.',
        change
      )
      return
    }
    this.quickAiContext = {
      ...context,
      content: replacement,
      selection: context.selection
        ? {
            from: context.selection.from,
            to: context.selection.from + change.content.length,
            text: change.content
          }
        : null
    }
    bar?.reportApplySuccess(change, null)
  }

  /**
   * Write a suggested change to a file the editor is not holding.
   *
   * The user accepted it, so it is written the same way a manual edit would be:
   * through the bridge, with the result checked. A refusal is reported in the
   * bar rather than swallowed, because a suggestion that silently does not land
   * is worse than one that says it could not.
   */
  private async writeSuggestedFile(change: PreviewChangeView, bar: QuickAi | null): Promise<void> {
    const accept = api()?.ai?.acceptPreview
    if (!accept || !change.previewId) {
      bar?.reportApplyError('Writing files is unavailable in this build.', change)
      return
    }
    try {
      const applied = await accept(change.previewId)
      await this.fileState.refreshFile(change.path)
      bar?.reportApplySuccess(change, applied)
    } catch (error) {
      const name = change.path.replace(/\\/g, '/').split('/').pop() ?? change.path
      bar?.reportApplyError(
        error instanceof Error ? error.message : `Could not write ${name}.`,
        change
      )
    }
  }

  /**
   * A group icon in the collapsed strip opens the panel on that folder.
   *
   * The panel has to expand first, or the click lands on chrome that is not
   * there yet, and a group saved shut is reopened so the folder you chose is
   * actually the thing you see. The open document is left alone: the click
   * asked for a folder, not for an edit to steal focus.
   */
  private handleOpenGroup = (e: CustomEvent<{ groupId: string }>): void => {
    this.verticalPanelCollapsed = false
    const group = (this.tabGroups ?? []).find((g) => g.id === e.detail.groupId)
    if (group?.collapsed) this.fileState.toggleTabGroupCollapse(group.id)
  }

  private async openFileDialog(): Promise<void> {
    const result = await api()?.file?.openDialog?.({
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }]
    })
    if (result && !result.canceled && result.filePaths[0]) {
      await this.fileState.openFile(result.filePaths[0])
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
    const secondaryName = this.secondaryPath
      ? (this.secondaryPath.split(/[/\\]/).pop() ?? 'Secondary.md')
      : null

    const pinnedTabs = this.tabs.map((t, i) => ({ t, i })).filter(({ t }) => t.isPinned)
    const ungroupedTabs = this.tabs
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !t.isPinned && !t.groupId)

    return html`
      <writemd-shell
        .vertical=${this.panelOrientation === 'vertical'}
        .settingsOpen=${this.showSettings}
      >
        <writemd-top-bar
          slot="header"
          .settingsOpen=${this.showSettings}
          .splitActive=${this.splitActive}
          .showAiButton=${this.aiEnabled && this.panelOrientation === 'horizontal'}
          .aiOpen=${this.aiDockOpen || this.quickAiOpen}
          .showSplitButton=${!this.showWelcome}
          .documentHeader=${this.panelOrientation === 'vertical'}
          @toggle-split=${() => this.fileState.toggleSplitView()}
          @toggle-ai=${this.toggleQuickAi}
          @toggle-panel=${this.toggleVerticalPanel}
        >
          <div
            slot="tabs"
            class="tabs-row"
            style="${this.panelOrientation === 'vertical' ? 'flex: 1;' : ''}"
          >
            ${
              this.showWelcome
                ? html`<div class="welcome-title">WriteMd</div>`
                : this.panelOrientation === 'vertical'
                  ? html`<writemd-doc-bar compact></writemd-doc-bar>`
                  : html`
                      <div class="tab-strip" role="tablist" aria-label="Open documents">
                        ${repeat(
                          pinnedTabs,
                          ({ t }) => t.id,
                          ({ t, i }) => this.renderHorizontalTabItem(t, i)
                        )}
                        ${pinnedTabs.length > 0 ? html`<div class="h-pinned-divider"></div>` : ''}
                        ${repeat(
                          this.tabGroups,
                          (g) => g.id,
                          (g) => this.renderHorizontalGroup(g)
                        )}
                        ${repeat(
                          ungroupedTabs,
                          ({ t }) => t.id,
                          ({ t, i }) => this.renderHorizontalTabItem(t, i)
                        )}
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

        ${
          this.panelOrientation === 'vertical'
            ? html`<writemd-rail-frame
                slot="rail"
                ?inert=${this.showSettings}
                .collapsed=${this.verticalPanelCollapsed}
                @toggle-rail=${this.toggleVerticalPanel}
                ><writemd-sidebar
                  .aiEnabled=${this.aiEnabled}
                  .aiOpen=${this.aiDockOpen || this.quickAiOpen}
                  .collapsed=${this.verticalPanelCollapsed}
                  .welcome=${this.showWelcome}
                  .tabGroups=${this.tabGroups}
                  @new-file=${() => void this.fileState.newFile()}
                  @open-file=${() => void this.openFileDialog()}
                  @new-group=${this.handleCreateGroupVertical}
                  @open-menu=${() => (this.showPalette = true)}
                  @toggle-panel=${this.toggleVerticalPanel}
                  @toggle-ai=${this.toggleQuickAi}
                  @open-group=${this.handleOpenGroup}
                  @open-settings=${() => (this.showSettings = true)}
                  >${
                    this.showWelcome
                      ? ''
                      : html`<writemd-vertical-tab-bar
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
                  }</writemd-sidebar
                ></writemd-rail-frame
              >`
            : ''
        }

        <div class="main-area" slot="content" ?inert=${this.showSettings}>
          <div class="editor-wrapper">
            ${
              this.showWelcome && !this.aiDockOpen
                ? html`<writemd-welcome-screen
                    .vertical=${this.panelOrientation === 'vertical'}
                    @new-file=${() => void this.fileState.newFile()}
                    @open-file=${() => void this.openFileDialog()}
                    @open-settings=${() => (this.showSettings = true)}
                    @open-recent=${(e: CustomEvent<{ path: string }>) =>
                      void this.fileState.openFile(e.detail.path)}
                  ></writemd-welcome-screen>`
                : html`<writemd-editor
                    @ai-open-floating=${(e: CustomEvent<{ path: string | null }>) => {
                      const editor = e.currentTarget as HTMLElement & {
                        getQuickAiContext: (path?: string | null) => QuickAiContext
                      }
                      this.openQuickAi({
                        prompt: '',
                        context: editor.getQuickAiContext(e.detail.path)
                      })
                    }}
                    @open-ai-bar=${(e: CustomEvent<{ prompt: string; context: QuickAiContext }>) =>
                      this.openQuickAi({ prompt: e.detail.prompt, context: e.detail.context })}
                  ></writemd-editor>`
            }
          </div>
          ${
            // Inside the content slot rather than the shell's overlay, so the
            // bar centres on the document. Centred on the window it sits off
            // to the right of the writing by the width of the tab rail.
            this.quickAiOpen
              ? html`<writemd-ai-quick
                  .context=${this.quickAiContext}
                  .readContext=${this.readQuickAiContext}
                  .autoAcceptEdits=${this.aiAutoAcceptEdits}
                  .paneFor=${this.quickAiPane}
                  .collapsed=${this.quickAiCollapsed}
                  .initialPrompt=${this.quickAiPrompt}
                  @quick-ai-close=${() => (this.quickAiOpen = false)}
                  @quick-ai-collapse=${() => (this.quickAiCollapsed = true)}
                  @quick-ai-accept=${this.applyQuickAi}
                  @quick-ai-full-chat=${() => {
                    this.quickAiOpen = false
                    this.fileState.toggleAiDock(true)
                  }}
                ></writemd-ai-quick>`
              : null
          }
        </div>

        ${
          this.showSettings
            ? html`<writemd-settings-modal
                slot="overlay"
                .embedded=${true}
                @settings-section-change=${(event: CustomEvent<{ tab: string }>) => (this.settingsTab = event.detail.tab)}
                .initialTab=${this.settingsTab}
                @close=${() => (this.showSettings = false)}
              ></writemd-settings-modal>`
            : ''
        }
        ${
          this.showPalette
            ? html`<writemd-command-palette
                slot="overlay"
                @close=${() => (this.showPalette = false)}
                @run-command=${(e: CustomEvent<{ id: string }>) => void this.runCommand(e.detail.id)}
              ></writemd-command-palette>`
            : ''
        }
        ${
          this.conflict
            ? html`<writemd-conflict-dialog
                slot="overlay"
                .conflict=${this.conflict}
              ></writemd-conflict-dialog>`
            : ''
        }
        ${this.renderHorizontalContextMenu()}
      </writemd-shell>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'writemd-app': WriteMdApp
  }
}
