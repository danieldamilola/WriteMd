import { SettingsStore } from './settings'
import { applyConflictReview, applyConflictReload, applyConflictDismiss } from './conflict'
import { api } from '../api'
import { showConfirm } from '../services/confirm'
import { sameFilePath, filePathKey, isInsideDir } from '../utils/paths'
import { placeTab, type TabDestination } from './tab-order'
import { isGroupIcon } from './group-icons'
import type {
  FileChangeSnapshot,
  FileWriteResult,
  VaultTreeNode
} from '../../../shared/electron-api'

/**
 * Drop anything a group no longer understands.
 *
 * Groups persisted before icon presets carry a `color`, and a profile could
 * carry any string at all if a preset was removed later. Both are discarded
 * here rather than at render, so the row only ever sees an icon it can draw.
 */
export function normalizeTabGroups(groups: unknown): TabGroup[] {
  if (!Array.isArray(groups)) return []
  const ids = new Set<string>()
  const normalized = groups
    .filter(
      (group): group is TabGroup & { color?: string } =>
        !!group && typeof group === 'object' && typeof (group as TabGroup).id === 'string'
    )
    .filter((group) => {
      if (ids.has(group.id)) return false
      ids.add(group.id)
      return true
    })
    .map((group) => {
      // Built field by field rather than spread, so a `color` left over from
      // an older profile cannot ride along as an untyped extra key.
      const next: TabGroup = {
        id: group.id,
        label: group.label,
        collapsed: !!group.collapsed
      }
      if (isGroupIcon(group.icon)) next.icon = group.icon
      if (typeof group.parentId === 'string' && group.parentId) next.parentId = group.parentId
      return next
    })
  for (const group of normalized) {
    if (
      group.parentId &&
      (!ids.has(group.parentId) || isGroupWithin(normalized, group.parentId, group.id))
    )
      delete group.parentId
  }
  return normalized
}

/** Includes the group itself; also terminates safely for corrupt saved cycles. */
export function isGroupWithin(
  groups: readonly TabGroup[],
  id: string,
  ancestorId: string
): boolean {
  const seen = new Set<string>()
  let current: string | undefined = id
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true
    seen.add(current)
    current = groups.find((group) => group.id === current)?.parentId
  }
  return false
}

/**
 * Modes the primary pane can render.
 *
 * `'wysiwyg'` is a legacy alias the editor normalizes to `'live'`. There is
 * deliberately no `'split'` here: the split pane is `splitActive` plus
 * `splitSurface`, and a `'split'` view mode was stored and then normalized away,
 * so it could never render as anything distinct.
 */
export type ViewMode = 'live' | 'reading' | 'source' | 'wysiwyg'

/**
 * What the second pane shows.
 *
 * There is no `'launcher'` here. Surfaces used to be reached through a picker
 * in the pane, so changing one meant going back through the picker first. They
 * are tabs now, each one click away from every other, and `'files'` is what the
 * pane opens on.
 */
export type SplitSurface = 'files' | 'backlinks' | 'file' | 'preview'

/**
 * Whether the secondary pane's CodeMirror view should exist.
 *
 * This has to match the template condition exactly. The editor renders
 * `#secondary-cm-wrapper` only when the surface is 'file', so if this predicate
 * disagreed, Lit would rip the wrapper out from under a live view: the view
 * keeps its window listeners alive against a detached DOM node, and coming back
 * to the 'file' surface finds the old view still set, so the pane mounts empty
 * until the secondary document is closed.
 */
export function shouldMountSecondaryView(state: {
  splitActive: boolean
  secondaryDoc: unknown
  splitSurface: SplitSurface
}): boolean {
  return state.splitActive && state.secondaryDoc !== null && state.splitSurface === 'file'
}

export interface SecondaryDocState {
  path: string | null
  content: string
  originalContent: string
  mtime: number
  dirty: boolean
  pendingWrite?: string | null
  viewMode: ViewMode
  isDiff?: boolean
  /**
   * Which document an open merge resolves back into. A conflict raised against
   * a tab merges the tab; one raised against this pane merges the pane. Without
   * it, resolving a pane conflict wrote the pane's file over whatever tab
   * happened to be active.
   */
  mergeTarget?: 'tab' | 'secondary'
}

export interface ConflictInfo {
  path: string
  diskContent: string
  diskMtime: number
}

export interface TabGroup {
  id: string
  label: string
  /** Name of a group icon preset. Absent means the folder pair. */
  icon?: string
  collapsed: boolean
  /** Absent for a top-level Space group. This never moves files on disk. */
  parentId?: string
}

export interface TabDoc {
  id?: string
  path: string | null
  content: string
  originalContent: string
  mtime: number
  dirty: boolean
  isVaultFile: boolean
  /** Content of our last successful write. Guards the watcher against our own saves. */
  lastWritten: string | null
  /** Content currently being written to disk, to prevent watcher race conditions. */
  pendingWrite: string | null
  isPinned?: boolean
  groupId?: string | null
}

/**
 * True when the disk content came from our own save, not another app.
 *
 * Structural rather than `TabDoc` so the split pane, which is watched and
 * written like a tab, can use it too.
 */
export function isOwnEcho(
  doc: { originalContent: string; lastWritten?: string | null; pendingWrite?: string | null },
  diskContent: string
): boolean {
  const normDisk = diskContent.replace(/\r\n/g, '\n')
  const normOriginal = doc.originalContent.replace(/\r\n/g, '\n')
  const normLastWritten = doc.lastWritten?.replace(/\r\n/g, '\n') ?? null
  const normPending = doc.pendingWrite?.replace(/\r\n/g, '\n') ?? null

  return (
    normDisk === normOriginal ||
    (normLastWritten !== null && normDisk === normLastWritten) ||
    (normPending !== null && normDisk === normPending)
  )
}

export interface FileStateData {
  path: string | null
  content: string
  originalContent: string
  mtime: number
  dirty: boolean
  viewMode: ViewMode
  isVaultFile: boolean
  quickTogglePair: [ViewMode, ViewMode]
  splitActive: boolean
  splitSurface: SplitSurface
  /** Right-hand assistant dock. Openable only while `ai.enabled` is set. */
  aiDockOpen: boolean
  secondaryDoc: SecondaryDocState | null
  conflict: ConflictInfo | null
  tabs: TabDoc[]
  activeTab: number
  tabGroups?: TabGroup[]
}

export class FileState {
  private static instance: FileState
  private state: FileStateData = {
    path: null,
    content: '',
    originalContent: '',
    mtime: 0,
    dirty: false,
    viewMode: 'wysiwyg',
    isVaultFile: false,
    quickTogglePair: ['live', 'reading'],
    splitActive: false,
    splitSurface: 'files',
    aiDockOpen: false,
    secondaryDoc: null,
    conflict: null,
    tabs: [],
    activeTab: 0,
    tabGroups: []
  }
  private listeners = new Set<(state: FileStateData) => void>()
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null
  private secondaryAutoSaveTimer: ReturnType<typeof setTimeout> | null = null
  private deletingPaths = new Set<string>()
  private pendingWrites = new Map<Promise<FileWriteResult>, { path: string; content: string }>()
  private refreshes = new Map<string, symbol>()
  private settingsStore = SettingsStore.getInstance()

  private constructor() {
    this.setupWatcherListener()
  }

  static getInstance(): FileState {
    if (!FileState.instance) {
      FileState.instance = new FileState()
    }
    return FileState.instance
  }

  getState(): Readonly<FileStateData> {
    return { ...this.state }
  }

  subscribe(listener: (state: FileStateData) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  subscribeSelector<T>(
    select: (state: Readonly<FileStateData>) => T,
    listener: (value: T, state: FileStateData) => void,
    equals: (a: T, b: T) => boolean = Object.is
  ): () => void {
    let previous = select(this.state)
    return this.subscribe((snapshot) => {
      const next = select(snapshot)
      if (equals(previous, next)) return
      previous = next
      listener(next, snapshot)
    })
  }

  dropTab(id: string, destination: TabDestination): void {
    if (
      destination.section === 'group' &&
      !this.state.tabGroups?.some((group) => group.id === destination.groupId)
    )
      return
    this.flushActiveTab()
    const active = this.activeTabDoc()
    const tabs = placeTab(this.state.tabs, id, destination)
    const unchanged = tabs.every((tab, i) => {
      const old = this.state.tabs[i]
      return (
        tab.id === old?.id &&
        !!tab.isPinned === !!old?.isPinned &&
        (tab.groupId ?? null) === (old?.groupId ?? null)
      )
    })
    if (unchanged) return
    const activeTab = Math.max(
      0,
      tabs.findIndex((tab) => tab.id === active?.id)
    )
    this.state = { ...this.state, tabs, activeTab }
    this.syncMirror()
    this.persistTabs()
    this.notify()
  }

  private notify(): void {
    const snapshot = this.getState()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch (error) {
        console.error('File state listener failed:', error)
      }
    }
  }

  private activeTabDoc(): TabDoc | null {
    return this.state.tabs[this.state.activeTab] ?? null
  }

  /** Top-level path/content fields mirror the active tab for existing consumers. */
  private syncMirror(): void {
    const tab = this.activeTabDoc()
    if (!tab) {
      this.state = {
        ...this.state,
        path: null,
        content: '',
        originalContent: '',
        mtime: 0,
        dirty: false,
        isVaultFile: false
      }
      return
    }
    this.state = {
      ...this.state,
      path: tab.path,
      content: tab.content,
      originalContent: tab.originalContent,
      mtime: tab.mtime,
      dirty: tab.dirty,
      isVaultFile: tab.isVaultFile
    }
  }

  private persistTabs(): void {
    const groupData = {
      groups: this.state.tabGroups,
      assignments: this.state.tabs
        .filter((t) => t.path && t.groupId)
        .map((t) => ({ path: t.path as string, groupId: t.groupId as string }))
    }
    this.settingsStore.setMany({
      'files.openTabs': this.state.tabs
        .map((tab) => tab.path)
        .filter((path): path is string => path !== null),
      'files.activeTabPath': this.activeTabDoc()?.path ?? null,
      'files.pinnedTabs': this.state.tabs
        .filter((tab) => tab.isPinned && tab.path)
        .map((tab) => tab.path as string),
      'files.tabGroups': JSON.stringify(groupData)
    })
  }

  private openTab(tab: Omit<TabDoc, 'lastWritten' | 'pendingWrite'>): void {
    const id =
      tab.id ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    this.state = {
      ...this.state,
      tabs: [...this.state.tabs, { ...tab, id, lastWritten: null, pendingWrite: null }],
      activeTab: this.state.tabs.length
    }
    this.syncMirror()
    this.persistTabs()
    this.notify()
  }

  /** Reopen tabs persisted from the last session. Returns true if any tab opened. */
  async restoreTabs(): Promise<boolean> {
    if (!api()) return false
    const paths = this.settingsStore.get<string[]>('files.openTabs', [])
    const activePath = this.settingsStore.get<string | null>('files.activeTabPath', null)
    // Persisted tab paths can hold slash aliases of the same file. Key every
    // lookup by file identity so one physical file restores as one tab, with
    // the group and pin it had under either alias.
    const pinnedPaths = new Set(
      this.settingsStore
        .get<string[]>('files.pinnedTabs', [])
        .map((p) => filePathKey(p))
        .filter((key): key is string => key !== null)
    )
    let restoredGroups: TabGroup[] = []
    const groupAssignments = new Map<string, string>()
    try {
      const raw = this.settingsStore.get<string>('files.tabGroups', '[]')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          restoredGroups = parsed
        } else if (parsed && parsed.groups) {
          restoredGroups = parsed.groups
          if (Array.isArray(parsed.assignments)) {
            for (const item of parsed.assignments) {
              const key = filePathKey(item.path)
              // Later aliases do not overwrite an earlier assignment.
              if (key !== null && !groupAssignments.has(key)) {
                groupAssignments.set(key, item.groupId)
              }
            }
          }
        }
      }
    } catch {
      // Fallback on corrupt group metadata
    }
    restoredGroups = normalizeTabGroups(restoredGroups)
    const vaultPath = await api()
      ?.vault?.getPath?.()
      .catch(() => undefined)
    const restored: TabDoc[] = []
    const seen = new Set(
      this.state.tabs.map((t) => filePathKey(t.path)).filter((k): k is string => k !== null)
    )
    for (const p of paths) {
      if (typeof p !== 'string') continue
      const key = filePathKey(p)
      if (key === null || seen.has(key)) continue
      try {
        const exists = await api()?.file?.exists?.(p)
        if (!exists) continue
        const result = await api()?.file?.read?.(p)
        if (!result) continue
        seen.add(key)
        restored.push({
          id:
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          path: p,
          content: result.content,
          originalContent: result.content,
          mtime: result.mtime,
          dirty: false,
          isVaultFile: isInsideDir(p, vaultPath),
          isPinned: pinnedPaths.has(key),
          groupId: groupAssignments.get(key) ?? null,
          lastWritten: null,
          pendingWrite: null
        })
        // Watching is fire-and-forget: awaiting it serially tripled the time to
        // restore a large session, and a watcher that lands late still guards
        // everything after the file opens.
        void api()
          ?.file?.watch?.(p)
          .catch(() => undefined)
      } catch {
        continue
      }
    }
    if (restored.length === 0) return false
    const tabs = [...this.state.tabs, ...restored]
    const idx = tabs.findIndex((t) => sameFilePath(t.path, activePath))
    this.state = {
      ...this.state,
      tabs,
      activeTab: idx >= 0 ? idx : this.state.tabs.length + restored.length - 1,
      tabGroups: restoredGroups.length > 0 ? restoredGroups : this.state.tabGroups
    }
    this.syncMirror()
    this.notify()
    return true
  }

  /**
   * Reorder tabs within the tab list.
   * Flushes active tab edits before modifying indices to protect autosave bindings.
   */
  moveTab(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.state.tabs.length) return
    if (toIndex < 0 || toIndex >= this.state.tabs.length) return
    if (fromIndex === toIndex) return

    this.flushActiveTab()
    const tabs = [...this.state.tabs]
    const [moved] = tabs.splice(fromIndex, 1)
    tabs.splice(toIndex, 0, moved)

    let newActive = this.state.activeTab
    if (this.state.activeTab === fromIndex) {
      newActive = toIndex
    } else if (fromIndex < this.state.activeTab && toIndex >= this.state.activeTab) {
      newActive--
    } else if (fromIndex > this.state.activeTab && toIndex <= this.state.activeTab) {
      newActive++
    }

    this.state = {
      ...this.state,
      tabs,
      activeTab: newActive
    }
    this.syncMirror()
    this.persistTabs()
    this.notify()
  }

  /**
   * Pin a tab to the top pinned section.
   */
  pinTab(index: number): void {
    if (index < 0 || index >= this.state.tabs.length) return
    const tab = this.state.tabs[index]
    if (tab.isPinned) return

    this.flushActiveTab()
    let lastPinnedIndex = -1
    for (let i = 0; i < this.state.tabs.length; i++) {
      if (this.state.tabs[i].isPinned) lastPinnedIndex = i
    }
    const targetIndex = lastPinnedIndex + 1

    const tabs = [...this.state.tabs]
    const updatedTab: TabDoc = { ...tab, isPinned: true, groupId: null }
    tabs.splice(index, 1)
    tabs.splice(targetIndex, 0, updatedTab)

    let newActive = this.state.activeTab
    if (this.state.activeTab === index) {
      newActive = targetIndex
    } else if (index < this.state.activeTab && targetIndex >= this.state.activeTab) {
      newActive--
    } else if (index > this.state.activeTab && targetIndex <= this.state.activeTab) {
      newActive++
    }

    this.state = { ...this.state, tabs, activeTab: newActive }
    this.syncMirror()
    this.persistTabs()
    this.notify()
  }

  /**
   * Unpin a tab, placing it at the start of the unpinned list.
   */
  unpinTab(index: number): void {
    if (index < 0 || index >= this.state.tabs.length) return
    const tab = this.state.tabs[index]
    if (!tab.isPinned) return

    this.flushActiveTab()
    let lastPinnedIndex = -1
    for (let i = 0; i < this.state.tabs.length; i++) {
      if (this.state.tabs[i].isPinned) lastPinnedIndex = i
    }

    const tabs = [...this.state.tabs]
    const updatedTab: TabDoc = { ...tab, isPinned: false }
    tabs.splice(index, 1)
    const targetIndex = Math.max(0, lastPinnedIndex)
    tabs.splice(targetIndex, 0, updatedTab)

    let newActive = this.state.activeTab
    if (this.state.activeTab === index) {
      newActive = targetIndex
    } else if (index < this.state.activeTab && targetIndex >= this.state.activeTab) {
      newActive--
    } else if (index > this.state.activeTab && targetIndex <= this.state.activeTab) {
      newActive++
    }

    this.state = { ...this.state, tabs, activeTab: newActive }
    this.syncMirror()
    this.persistTabs()
    this.notify()
  }

  /**
   * Create a new tab group and optionally assign tabs to it.
   *
   * New groups start on the folder icon rather than cycling presets. A preset
   * the user never chose is noise, and every group sharing one glyph made the
   * icons pointless; the picker in the group menu is how anyone changes it.
   */
  createTabGroup(label: string, icon?: string, tabIndices: number[] = []): string {
    const currentGroups = this.state.tabGroups ?? []
    const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const newGroup: TabGroup = {
      id,
      label: label.trim() || 'New Group',
      collapsed: false
    }
    if (icon) newGroup.icon = icon

    const indicesSet = new Set(tabIndices)
    const tabs = this.state.tabs.map((tab, idx) => {
      if (indicesSet.has(idx)) {
        return { ...tab, groupId: id, isPinned: false }
      }
      return tab
    })

    this.state = {
      ...this.state,
      tabGroups: [...currentGroups, newGroup],
      tabs
    }
    this.persistTabs()
    this.notify()
    return id
  }

  /**
   * Update properties on an existing tab group.
   */
  updateTabGroup(groupId: string, patch: Partial<TabGroup>): void {
    const currentGroups = this.state.tabGroups ?? []
    const tabGroups = normalizeTabGroups(
      currentGroups.map((g) => (g.id === groupId ? { ...g, ...patch, id: g.id } : g))
    )
    this.state = { ...this.state, tabGroups }
    this.persistTabs()
    this.notify()
  }

  /**
   * Delete a tab group. If closeTabs is true, member tabs are closed; otherwise ungrouped.
   */
  async deleteTabGroup(groupId: string, closeTabs = false): Promise<void> {
    const groups = this.state.tabGroups ?? []
    const group = groups.find((entry) => entry.id === groupId)
    if (!group) return
    const subtree = new Set(
      groups.filter((entry) => isGroupWithin(groups, entry.id, groupId)).map((entry) => entry.id)
    )
    const belongs = (tab: TabDoc): boolean => !!tab.groupId && subtree.has(tab.groupId)
    if (closeTabs) {
      const active = this.activeTabDoc()
      if (this.state.tabs.some((tab) => belongs(tab) && tab.dirty)) {
        if (active && belongs(active)) this.clearAutoSaveTimer()
        const confirmed = await showConfirm(
          'This group has unsaved changes. Close all tabs in the group anyway?'
        )
        if (!confirmed) {
          if (active && belongs(active) && this.activeTabDoc()?.id === active.id)
            this.scheduleAutoSave()
          return
        }
      }
      const currentActive = this.activeTabDoc()
      if (currentActive && belongs(currentActive)) this.clearAutoSaveTimer()
      const closedTabs = this.state.tabs.filter(belongs)
      const remainingTabs = this.state.tabs.filter((tab) => !belongs(tab))
      const remainingActive = remainingTabs.findIndex((tab) => tab.id === currentActive?.id)
      const activeTab = Math.max(
        0,
        remainingActive >= 0
          ? remainingActive
          : Math.min(this.state.activeTab, remainingTabs.length - 1)
      )
      this.state = {
        ...this.state,
        tabs: remainingTabs,
        activeTab,
        tabGroups: this.state.tabGroups?.filter((g) => !subtree.has(g.id))
      }
      this.syncMirror()
      if (remainingActive >= 0) this.scheduleAutoSave()
      for (const tab of closedTabs) {
        if (
          tab.path &&
          !sameFilePath(tab.path, this.state.secondaryDoc?.path) &&
          !remainingTabs.some((remaining) => sameFilePath(remaining.path, tab.path))
        )
          void api()
            ?.file?.unwatch?.(tab.path)
            .catch(() => undefined)
      }
    } else {
      const tabs = this.state.tabs.map((t) =>
        t.groupId === groupId ? { ...t, groupId: group.parentId ?? null } : t
      )
      this.state = {
        ...this.state,
        tabs,
        tabGroups: this.state.tabGroups
          ?.filter((g) => g.id !== groupId)
          .map((entry) => {
            if (entry.parentId !== groupId) return entry
            const promoted = { ...entry }
            if (group.parentId) promoted.parentId = group.parentId
            else delete promoted.parentId
            return promoted
          })
      }
    }
    this.persistTabs()
    this.notify()
  }

  /**
   * Toggle collapsed/expanded state of a tab group.
   */
  toggleTabGroupCollapse(groupId: string): void {
    const currentGroups = this.state.tabGroups ?? []
    const tabGroups = currentGroups.map((g) =>
      g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
    )
    this.state = { ...this.state, tabGroups }
    this.persistTabs()
    this.notify()
  }

  /**
   * Assign or unassign a tab to a tab group.
   */
  setTabGroup(tabIndex: number, groupId: string | null): void {
    if (tabIndex < 0 || tabIndex >= this.state.tabs.length) return
    const tabs = this.state.tabs.map((t, i) =>
      i === tabIndex ? { ...t, groupId, isPinned: groupId ? false : t.isPinned } : t
    )
    this.state = { ...this.state, tabs }
    this.persistTabs()
    this.notify()
  }

  /**
   * Reorder tab groups.
   */
  reorderTabGroups(fromIndex: number, toIndex: number): void {
    const currentGroups = this.state.tabGroups ?? []
    if (fromIndex < 0 || fromIndex >= currentGroups.length) return
    if (toIndex < 0 || toIndex >= currentGroups.length) return
    if (fromIndex === toIndex) return

    const tabGroups = [...currentGroups]
    const [moved] = tabGroups.splice(fromIndex, 1)
    tabGroups.splice(toIndex, 0, moved)

    this.state = { ...this.state, tabGroups }
    this.persistTabs()
    this.notify()
  }

  /** Move a group with its descendants, preserving tabs, selections, and edits. */
  moveTabGroup(groupId: string, parentId: string | null, beforeId?: string): void {
    const groups = this.state.tabGroups ?? []
    const source = groups.find((group) => group.id === groupId)
    if (!source || beforeId === groupId) return
    if (
      parentId &&
      (!groups.some((group) => group.id === parentId) || isGroupWithin(groups, parentId, groupId))
    )
      return
    const moved = { ...source }
    if (parentId) moved.parentId = parentId
    else delete moved.parentId
    const remaining = groups.filter((group) => group.id !== groupId)
    let index = beforeId
      ? remaining.findIndex(
          (group) => group.id === beforeId && (group.parentId ?? null) === parentId
        )
      : -1
    if (beforeId && index < 0) return
    if (index < 0) {
      index = remaining.reduce(
        (last, group, i) => ((group.parentId ?? null) === parentId ? i + 1 : last),
        remaining.length
      )
    }
    remaining.splice(index, 0, moved)
    const tabGroups = remaining.map((group) =>
      parentId && isGroupWithin(remaining, parentId, group.id)
        ? { ...group, collapsed: false }
        : group
    )
    this.state = { ...this.state, tabGroups }
    this.persistTabs()
    this.notify()
  }

  /**
   * Move tab relative to its current index (e.g. for keyboard Alt+Up/Down shortcuts).
   */
  moveTabRelative(tabIndex: number, delta: -1 | 1): void {
    const targetIndex = tabIndex + delta
    if (targetIndex >= 0 && targetIndex < this.state.tabs.length) {
      this.moveTab(tabIndex, targetIndex)
    }
  }

  switchTab(index: number): void {
    if (index < 0 || index >= this.state.tabs.length || index === this.state.activeTab) return
    // A tab-targeted conflict merge is bound to one tab: Accept and Reject both
    // resolve through setContent, which writes the active tab, so letting the
    // active tab move while it is open would land one file's merge on another.
    if (this.state.secondaryDoc?.isDiff && this.state.secondaryDoc.mergeTarget !== 'secondary') {
      return
    }
    // The autosave debounce is armed for a specific tab. Tab A's timer firing
    // after a switch would call save(), which re-reads the now-active tab and
    // writes B's content to B's path while A's edits are dropped. Flushing
    // first is what keeps A's last edits from the missing write.
    this.flushActiveTab()
    this.state = { ...this.state, activeTab: index }
    this.syncMirror()
    this.persistTabs()
    this.notify()
  }

  async closeTab(index: number): Promise<void> {
    const tab = this.state.tabs[index]
    if (!tab) return
    // Deliberately not flushed: a dirty tab is about to be asked about, and
    // "close anyway" means the user chose to drop those edits. Writing them
    // first would make that choice a lie.
    if (index === this.state.activeTab) this.clearAutoSaveTimer()
    if (tab.dirty) {
      const ok = await showConfirm('You have unsaved changes. Close this tab anyway?')
      if (!ok) return
    }
    if (tab.path) {
      await api()
        ?.file?.unwatch?.(tab.path)
        .catch(() => undefined)
    }
    const tabs = this.state.tabs.filter((_, i) => i !== index)
    let activeTab = this.state.activeTab
    if (index < activeTab) activeTab--
    else if (index === activeTab) activeTab = Math.min(activeTab, tabs.length - 1)
    this.state = { ...this.state, tabs, activeTab: Math.max(0, activeTab) }
    this.syncMirror()
    this.persistTabs()
    this.notify()
  }

  /** Delete a document without letting pane teardown save it back to disk. */
  async deleteFile(path: string): Promise<boolean> {
    if (this.isDeleting(path)) return false
    this.deletingPaths.add(path)
    if (sameFilePath(this.state.path, path)) this.clearAutoSaveTimer()
    if (sameFilePath(this.state.secondaryDoc?.path, path)) this.clearSecondaryAutoSaveTimer()
    let deleted = false
    try {
      await Promise.allSettled(
        [...this.pendingWrites]
          .filter(([, target]) => sameFilePath(target.path, path))
          .map(([write]) => write)
      )
      deleted = Boolean(await api()?.file?.delete?.(path))
    } catch (error) {
      console.error('Failed to delete file:', error)
    }
    if (!deleted) {
      this.deletingPaths.delete(path)
      if (sameFilePath(this.state.path, path)) this.scheduleAutoSave()
      if (sameFilePath(this.state.secondaryDoc?.path, path)) this.scheduleSecondaryAutoSave()
      return false
    }
    const active = this.activeTabDoc()
    const tabs = this.state.tabs.filter((tab) => !sameFilePath(tab.path, path))
    const remainingActive = tabs.findIndex((tab) => tab.id === active?.id)
    if (sameFilePath(this.state.path, path)) this.clearAutoSaveTimer()
    const secondaryMatches = sameFilePath(this.state.secondaryDoc?.path, path)
    if (secondaryMatches) this.clearSecondaryAutoSaveTimer()
    this.state = {
      ...this.state,
      tabs,
      activeTab: Math.max(
        0,
        remainingActive >= 0 ? remainingActive : Math.min(this.state.activeTab, tabs.length - 1)
      ),
      ...(secondaryMatches
        ? { splitActive: false, splitSurface: 'files', secondaryDoc: null }
        : {}),
      conflict: sameFilePath(this.state.conflict?.path, path) ? null : this.state.conflict
    }
    this.syncMirror()
    if (remainingActive >= 0) this.scheduleAutoSave()
    this.persistTabs()
    this.notify()
    void api()
      ?.file?.unwatch?.(path)
      .catch(() => undefined)
    this.deletingPaths.delete(path)
    return true
  }

  private isDeleting(path: string | null): boolean {
    return [...this.deletingPaths].some((deletingPath) => sameFilePath(deletingPath, path))
  }

  private async writeDocument(path: string, content: string): Promise<FileWriteResult | undefined> {
    if (this.isDeleting(path)) return undefined
    const writeFile = api()?.file?.write
    if (!writeFile) return undefined
    const pending = [...this.pendingWrites].filter(([, target]) => sameFilePath(target.path, path))
    const latest = pending.at(-1)
    if (latest?.[1].content === content) return latest[0]
    // A later save must finish after the earlier one, or atomic renames can
    // overwrite newer typing with the older AI snapshot.
    const write = latest
      ? latest[0].catch(() => undefined).then(() => writeFile(path, content))
      : writeFile(path, content)
    this.pendingWrites.set(write, { path, content })
    try {
      return await write
    } finally {
      this.pendingWrites.delete(write)
    }
  }

  private isPendingEcho(path: string, content: string): boolean {
    return [...this.pendingWrites.values()].some(
      (pending) =>
        sameFilePath(pending.path, path) &&
        pending.content.replace(/\r\n/g, '\n') === content.replace(/\r\n/g, '\n')
    )
  }

  async newFile(): Promise<void> {
    const active = this.activeTabDoc()
    if (active?.dirty) {
      const ok = await showConfirm('You have unsaved changes. Create new file anyway?')
      if (!ok) return
    }
    const vaultPath = await api()
      ?.vault?.getPath?.()
      .catch(() => undefined)
    const defaultName = this.settingsStore.get('files.defaultNewFileName', 'Untitled.md')
    const defaultContent = this.settingsStore.get('files.defaultNewFileContent', '')
    const occupied = new Set(this.state.tabs.map((tab) => filePathKey(tab.path)))
    const tree = vaultPath ? await api()?.vault?.getTree?.() : undefined
    const collect = (node: VaultTreeNode): void => {
      occupied.add(filePathKey(node.path))
      for (const child of node.children ?? []) collect(child)
    }
    if (tree) collect(tree)
    const pathFor = (name: string): string => (vaultPath ? `${vaultPath}/${name}` : name)
    const dot = defaultName.lastIndexOf('.')
    const stem = dot > 0 ? defaultName.slice(0, dot) : defaultName
    const extension = dot > 0 ? defaultName.slice(dot) : ''
    let name = defaultName
    for (let number = 2; occupied.has(filePathKey(pathFor(name))); number++)
      name = `${stem} ${number}${extension}`
    this.openTab({
      path: pathFor(name),
      content: defaultContent,
      originalContent: defaultContent,
      mtime: Date.now(),
      dirty: false,
      isVaultFile: true
    })
  }

  private addRecentFile(filePath: string): void {
    const max = this.settingsStore.get('files.recentFilesMax', 10)
    const current = this.settingsStore.get<string[]>('files.recentFiles', [])
    const filtered = current.filter((p) => p !== filePath)
    filtered.unshift(filePath)
    this.settingsStore.set('files.recentFiles', filtered.slice(0, max))
  }

  private setupWatcherListener(): void {
    api()?.file?.onChanged?.((changedPath: string, snapshot?: FileChangeSnapshot) => {
      void this.refreshFile(changedPath, snapshot)
    })
  }

  /** Read committed changes without a debounce or changing the selected tab. */
  async refreshFile(changedPath: string, snapshot?: FileChangeSnapshot): Promise<void> {
    const path =
      this.state.tabs.find((tab) => sameFilePath(tab.path, changedPath))?.path ??
      (sameFilePath(this.state.secondaryDoc?.path, changedPath)
        ? this.state.secondaryDoc?.path
        : null)
    if (!path) return
    const refresh = Symbol()
    this.refreshes.set(path, refresh)
    try {
      const result = snapshot ?? (await api()?.file?.read?.(path))
      if (!result || this.refreshes.get(path) !== refresh) return
      if (!this.state.tabs.some((t) => sameFilePath(t.path, changedPath))) {
        await this.handleSecondaryChanged(changedPath, result)
        return
      }
      // Re-resolve after the read. The tab could have been closed, reordered, or
      // renamed while it was in flight, and a stale index would write this
      // file's disk content onto an unrelated tab. Every alias counts: a second
      // copy of the file must not keep rendering content the disk no longer has.
      const matching: number[] = []
      this.state.tabs.forEach((t, i) => {
        if (sameFilePath(t.path, changedPath)) matching.push(i)
      })
      const tabIndex = matching[0]
      if (tabIndex === undefined) return
      const tab = this.state.tabs[tabIndex]

      if (isOwnEcho(tab, result.content) || this.isPendingEcho(path, result.content)) {
        // Echo of our own save
        const tabs = this.state.tabs.map((t, i) =>
          matching.includes(i) ? { ...t, mtime: result.mtime } : t
        )
        this.state = { ...this.state, tabs }
        this.syncMirror()
        return
      }

      if (tab.dirty && (!snapshot || tab.content !== snapshot.before)) {
        if (matching.includes(this.state.activeTab)) {
          this.raiseConflict({
            path: changedPath,
            diskContent: result.content,
            diskMtime: result.mtime
          })
        } else {
          // Background tab with unsaved work: rebase without touching the buffer
          const tabs = this.state.tabs.map((t, i) =>
            matching.includes(i)
              ? { ...t, originalContent: result.content, mtime: result.mtime, lastWritten: null }
              : t
          )
          this.state = { ...this.state, tabs }
          this.syncMirror()
          this.notify()
        }
        return
      }

      const tabs = this.state.tabs.map((t, i) =>
        matching.includes(i)
          ? {
              ...t,
              content: result.content,
              originalContent: result.content,
              mtime: result.mtime,
              dirty: false,
              lastWritten: null,
              pendingWrite: null
            }
          : t
      )
      this.state = { ...this.state, tabs }
      this.syncMirror()
      const secondary = this.state.secondaryDoc
      if (secondary && !secondary.isDiff && sameFilePath(secondary.path, changedPath)) {
        await this.handleSecondaryChanged(changedPath, result)
      }
      this.notify()
    } catch (error) {
      // A delete or rename can briefly leave no file to read. Keep the buffer.
      console.warn('Could not refresh changed file:', changedPath, error)
    } finally {
      if (this.refreshes.get(path) === refresh) this.refreshes.delete(path)
    }
  }

  /** Accepted edits notify the editor now and start saving in the same turn. */
  async applyAiEdit(path: string, expected: string, content: string): Promise<boolean> {
    // A slash alias can already sit in memory from a session restored before
    // restoreTabs deduplicated. Update every copy, or the editor keeps showing
    // a stale buffer for whichever alias the user actually has selected.
    const indices: number[] = []
    this.state.tabs.forEach((tab, i) => {
      if (sameFilePath(tab.path, path)) indices.push(i)
    })
    const index = indices[0] ?? -1
    const secondary = this.state.secondaryDoc
    const secondaryMatches = !!secondary && !secondary.isDiff && sameFilePath(secondary.path, path)
    if (index >= 0) {
      // Every copy must still hold the content the model edited. One alias that
      // moved on means the write is stale, so refuse rather than overwrite.
      if (
        indices.some((i) => this.state.tabs[i].content !== expected) ||
        (secondaryMatches && secondary.content !== expected)
      )
        return false
      if (indices.includes(this.state.activeTab)) this.clearAutoSaveTimer()
      if (secondaryMatches) this.clearSecondaryAutoSaveTimer()
      this.state = {
        ...this.state,
        tabs: this.state.tabs.map((tab, i) =>
          indices.includes(i)
            ? {
                ...tab,
                content,
                dirty: content !== tab.originalContent
              }
            : tab
        ),
        secondaryDoc: secondaryMatches
          ? {
              ...secondary,
              content,
              dirty: content !== secondary.originalContent,
              pendingWrite: content
            }
          : secondary
      }
      this.syncMirror()
      this.notify()
      const saved = await this.save(index, false)
      const current = this.state.secondaryDoc
      if (current && sameFilePath(current.path, path) && current.pendingWrite === content) {
        const tab = this.state.tabs.find((tab) => sameFilePath(tab.path, path))
        this.state = {
          ...this.state,
          secondaryDoc: {
            ...current,
            originalContent: saved ? content : current.originalContent,
            dirty: current.content !== (saved ? content : current.originalContent),
            pendingWrite: null,
            mtime: tab?.mtime ?? current.mtime
          }
        }
        this.notify()
      }
      return saved
    }
    if (!secondaryMatches || secondary.content !== expected) return false
    this.clearSecondaryAutoSaveTimer()
    this.state = {
      ...this.state,
      secondaryDoc: { ...secondary, content, dirty: content !== secondary.originalContent }
    }
    this.notify()
    return this.saveSecondary()
  }

  async openFile(path: string): Promise<void> {
    // Identity, not string equality. A slash alias of an open tab is the same
    // file, and opening a second tab for it leaves an AI write landing on the
    // inactive copy while the editor keeps showing the stale buffer.
    const existing = this.state.tabs.findIndex((t) => sameFilePath(t.path, path))
    if (existing >= 0) {
      this.switchTab(existing)
      return
    }
    const active = this.activeTabDoc()
    if (active?.dirty) {
      const ok = await showConfirm('You have unsaved changes. Open another file anyway?')
      if (!ok) return
    }
    try {
      const result = await api()?.file?.read?.(path)
      if (!result) throw new Error('Failed to read file')
      const vaultPath = await api()
        ?.vault?.getPath?.()
        .catch(() => undefined)
      this.openTab({
        path,
        content: result.content,
        originalContent: result.content,
        mtime: result.mtime,
        dirty: false,
        isVaultFile: isInsideDir(path, vaultPath)
      })
      this.addRecentFile(path)
      await api()
        ?.file?.watch?.(path)
        .catch(() => undefined)
    } catch (e) {
      console.error('Failed to open file:', e)
      alert(`Failed to open file: ${e}`)
    }
  }

  /**
   * @param targetIndex Tab to write. Defaults to the active tab. Callers that
   *   already resolved a tab across an await pass it explicitly rather than
   *   mutating activeTab, so the visible selection never flickers.
   */
  async save(targetIndex?: number, includeSecondary = true): Promise<boolean> {
    const index = targetIndex ?? this.state.activeTab
    const tab = this.state.tabs[index] ?? null
    if (!tab) return false
    if (this.isDeleting(tab.path)) return false
    if (!tab.path) return targetIndex === undefined ? this.saveAs() : false
    try {
      // Mark as pending to prevent watcher race conditions
      const contentToSave = tab.content
      this.state = {
        ...this.state,
        tabs: this.state.tabs.map((t, i) =>
          i === index ? { ...t, pendingWrite: contentToSave } : t
        )
      }
      const result = await this.writeDocument(tab.path, contentToSave)
      // Re-resolve by path, not by this.state.activeTab. Switching tabs during
      // the write used to mark the wrong tab clean and clobber its
      // originalContent while leaving pendingWrite set on the tab that was
      // actually written, which permanently disarmed the own-echo guard.
      const writeIdx = this.state.tabs.findIndex((t) => t.path === tab.path)
      if (result && writeIdx >= 0) {
        // Settle every alias of the written file. All of them now hold the same
        // bytes on disk, so leaving one dirty would keep its own-echo guard
        // armed and let the next watcher event overwrite the fresh write.
        const tabs = this.state.tabs.map((t) =>
          sameFilePath(t.path, tab.path)
            ? {
                ...t,
                originalContent: contentToSave,
                mtime: result.mtime,
                dirty: t.content === contentToSave ? false : t.dirty,
                lastWritten: contentToSave,
                pendingWrite: null
              }
            : t
        )
        this.state = { ...this.state, tabs }
        this.syncMirror()
        if (tab.path) {
          this.addRecentFile(tab.path)
        }
        this.notify()
        // Manual save also flushes a dirty split-pane document; with autosave
        // off it would otherwise never reach disk (save is tab-scoped).
        if (includeSecondary) void this.saveSecondary()
        return true
      }
    } catch (e) {
      console.error('Failed to save file:', e)
      alert(`Failed to save file: ${e}`)
      // Clear pending on error
      const idx = this.state.tabs.findIndex((t) => t.path === tab.path)
      if (idx >= 0) {
        this.state = {
          ...this.state,
          tabs: this.state.tabs.map((t) =>
            sameFilePath(t.path, tab.path) ? { ...t, pendingWrite: null } : t
          )
        }
      }
    }
    return false
  }

  async saveAs(): Promise<boolean> {
    const tab = this.activeTabDoc()
    if (!tab) return false
    const result = await api()?.file?.saveDialog?.({
      defaultPath: tab?.path ?? undefined,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }]
    })
    if (result && !result.canceled && result.filePath) {
      // The dialog is modal, but the tab can still be closed or reordered while
      // it is open, so the index captured at entry may no longer be right.
      const idx = this.state.tabs.findIndex((t) => t.path === tab.path)
      if (idx < 0) return false
      const tabs = this.state.tabs.map((t, i) => (i === idx ? { ...t, path: result.filePath } : t))
      this.state = { ...this.state, tabs }
      this.syncMirror()
      this.persistTabs()
      // save() resolves its own target, so it no longer depends on this tab
      // still being active when the write lands.
      return this.save(idx)
    }
    return false
  }

  async renameFile(newName: string, isSecondary = false): Promise<boolean> {
    const doc = isSecondary ? this.state.secondaryDoc : this.activeTabDoc()
    if (!doc?.path) return false
    const newPath = this.buildRenamedPath(doc.path, newName)
    if (newPath === doc.path) return true
    const exists = await api()?.file?.exists?.(doc.path)
    if (exists && !(await api()?.file?.rename?.(doc.path, newPath))) return false
    return this.updateDocumentPath(doc.path, newPath)
  }

  private updateDocumentPath(previousPath: string, nextPath: string): boolean {
    const primaryMatches = sameFilePath(this.state.path, previousPath)
    const secondary = this.state.secondaryDoc
    const secondaryMatches = secondary !== null && sameFilePath(secondary.path, previousPath)
    const tabs = this.state.tabs.map((tab) =>
      sameFilePath(tab.path, previousPath) ? { ...tab, path: nextPath } : tab
    )
    if (!secondaryMatches && tabs.every((tab, index) => tab === this.state.tabs[index]))
      return false
    this.state = {
      ...this.state,
      tabs,
      secondaryDoc: secondaryMatches ? { ...secondary!, path: nextPath } : secondary
    }
    this.syncMirror()
    this.persistTabs()
    this.addRecentFile(nextPath)
    void api()
      ?.file?.unwatch?.(previousPath)
      .catch(() => undefined)
    void api()
      ?.file?.watch?.(nextPath)
      .catch(() => undefined)
    if (primaryMatches) this.scheduleAutoSave()
    if (secondaryMatches) this.scheduleSecondaryAutoSave()
    this.notify()
    return true
  }

  private buildRenamedPath(currentPath: string, newName: string): string {
    const parts = currentPath.replace(/\\/g, '/').split('/')
    parts.pop()
    const finalName = newName.endsWith('.md') ? newName : newName + '.md'
    return parts.length > 0 ? parts.join('/') + '/' + finalName : finalName
  }

  /** Move the selected pane's file into another directory. Returns false when cancelled. */
  async moveActiveFile(isSecondary = false): Promise<boolean> {
    const tab = isSecondary ? this.state.secondaryDoc : this.activeTabDoc()
    if (!tab || !tab.path) return false
    const result = await api()?.dialog?.showOpenDialog?.({
      properties: ['openDirectory', 'createDirectory']
    })
    if (!result || result.canceled || !result.filePaths[0]) return false
    const base = tab.path.replace(/\\/g, '/').split('/').pop() ?? 'Untitled.md'
    const newPath = `${result.filePaths[0].replace(/\\/g, '/')}/${base}`
    if (newPath === tab.path.replace(/\\/g, '/')) return true
    const success = await api()?.file?.rename?.(tab.path, newPath)
    if (!success) {
      alert(`Could not move file to ${newPath}`)
      return false
    }
    return this.updateDocumentPath(tab.path, newPath)
  }

  setContent(content: string): void {
    const isDiff = Boolean(this.state.secondaryDoc?.isDiff)
    if (this.state.tabs.length === 0 && !isDiff) {
      // Edits with no open tab start an implicit untitled tab
      this.openTab({
        path: null,
        content: '',
        originalContent: '',
        mtime: Date.now(),
        dirty: false,
        isVaultFile: false
      })
    }
    const tabs = this.state.tabs.map((t, i) =>
      i === this.state.activeTab ? { ...t, content, dirty: content !== t.originalContent } : t
    )
    this.state = {
      ...this.state,
      tabs,
      ...(isDiff && this.state.secondaryDoc
        ? {
            secondaryDoc: {
              ...this.state.secondaryDoc,
              content
            }
          }
        : {})
    }
    this.syncMirror()
    this.notify()
    this.scheduleAutoSave()
  }

  setViewMode(mode: ViewMode): void {
    this.state = { ...this.state, viewMode: mode }
    this.notify()
  }

  quickToggle(): void {
    const [modeA, modeB] = this.state.quickTogglePair
    const active = this.state.viewMode === 'wysiwyg' ? 'live' : this.state.viewMode
    const next = active === modeA ? modeB : modeA
    this.setViewMode(next)
  }

  setExplicitMode(mode: ViewMode): void {
    const normalized = mode === 'wysiwyg' ? 'live' : mode
    let newPair: [ViewMode, ViewMode] = this.state.quickTogglePair
    if (normalized === 'live') {
      newPair = ['live', 'reading']
    } else if (normalized === 'reading') {
      newPair = ['reading', 'live']
    } else if (normalized === 'source') {
      newPair = ['source', 'reading']
    }
    this.state = {
      ...this.state,
      viewMode: normalized,
      quickTogglePair: newPair
    }
    this.notify()
  }

  toggleSplitView(open?: boolean): void {
    const splitActive = open !== undefined ? open : !this.state.splitActive
    if (!splitActive) {
      // When closing split view, reset everything so it opens fresh next time
      this.flushPendingWrites()
      this.state = {
        ...this.state,
        splitActive: false,
        splitSurface: 'files',
        secondaryDoc: null
      }
    } else {
      this.state = { ...this.state, splitActive }
    }
    this.notify()
  }

  setSplitSurface(surface: SplitSurface): void {
    this.state = { ...this.state, splitActive: true, splitSurface: surface }
    this.notify()
  }

  /**
   * Show or hide the assistant dock.
   *
   * Lives here rather than in the Editor because the command that toggles it is
   * dispatched from the app shell, and the split pane's visibility works the
   * same way - a view concern the command layer has to be able to reach.
   */
  toggleAiDock(open?: boolean): void {
    const next = open ?? !this.state.aiDockOpen
    if (next === this.state.aiDockOpen) return
    this.state = { ...this.state, aiDockOpen: next }
    this.notify()
  }

  /**
   * External change to the split pane's file.
   *
   * The pane has no tab of its own, so the tab branch above never looked at it.
   * That left the pane's autosave free to overwrite an edit made outside the app
   * with nothing on screen to say so, which is the one thing a watcher exists to
   * prevent. Re-resolved after the read: the pane can close or switch files while
   * it is in flight.
   */
  private async handleSecondaryChanged(
    changedPath: string,
    snapshot?: { content: string; mtime: number; before?: string | null }
  ): Promise<void> {
    const before = this.state.secondaryDoc
    if (!before || before.isDiff || !sameFilePath(before.path, changedPath)) return
    const result = snapshot ?? (await api()?.file?.read?.(changedPath))
    const current = this.state.secondaryDoc
    if (!result || !current || !sameFilePath(current.path, changedPath)) return

    if (isOwnEcho(current, result.content) || this.isPendingEcho(changedPath, result.content)) {
      this.state = { ...this.state, secondaryDoc: { ...current, mtime: result.mtime } }
      this.notify()
      return
    }
    if (current.dirty && (!snapshot || current.content !== snapshot.before)) {
      this.clearSecondaryAutoSaveTimer()
      this.raiseConflict({
        path: changedPath,
        diskContent: result.content,
        diskMtime: result.mtime
      })
      return
    }
    this.state = {
      ...this.state,
      secondaryDoc: {
        ...current,
        content: result.content,
        originalContent: result.content,
        mtime: result.mtime,
        dirty: false
      }
    }
    this.notify()
  }

  /**
   * Write both panes' pending edits, then drop their debounces.
   *
   * Both teardown paths used to clear the timers without writing, so the last
   * slice of an edit before closing the pane never reached disk and nothing
   * re-armed a timer to catch it later.
   */
  private flushPendingWrites(): void {
    this.flushActiveTab()
    void this.saveSecondary()
    this.clearAutoSaveTimer()
    this.clearSecondaryAutoSaveTimer()
  }

  /**
   * Write the active tab now, if it has unsaved changes and a path to write
   * them to. `save()` captures the tab synchronously, so calling this before
   * moving `activeTab` writes the tab the user is leaving.
   */
  private flushActiveTab(): void {
    const tab = this.activeTabDoc()
    if (tab?.dirty && tab.path) void this.save()
  }

  async openSecondaryFile(path: string, content: string): Promise<void> {
    const previous = this.state.secondaryDoc
    if (previous?.dirty && previous.path && previous.path !== path) {
      // Replacing the pane used to drop the outgoing document on the floor: the
      // incoming one arrives with `dirty: false`, and the outgoing edits were
      // never written and never confirmed.
      const ok = await showConfirm('The split pane has unsaved changes. Discard them?')
      if (!ok) return
      void this.saveSecondary()
    }
    this.clearSecondaryAutoSaveTimer()
    this.state = {
      ...this.state,
      splitActive: true,
      splitSurface: 'file',
      secondaryDoc: {
        path,
        content,
        originalContent: content,
        mtime: Date.now(),
        dirty: false,
        viewMode: 'live'
      }
    }
    // The pane can now write to this path, so it needs the same external-change
    // detection the tabs have. Without a watcher an edit made outside the app
    // was invisible, and the autosave overwrote it.
    if (path) {
      void api()
        ?.file?.watch?.(path)
        .catch(() => undefined)
    }
    this.notify()
  }

  /** Sole owner of the secondary pane's view mode, so the store stays the
   * single source of truth and the editor's subscription stays authoritative. */
  setSecondaryViewMode(mode: ViewMode): void {
    const secondaryDoc = this.state.secondaryDoc
    if (!secondaryDoc || secondaryDoc.viewMode === mode) return
    this.state = { ...this.state, secondaryDoc: { ...secondaryDoc, viewMode: mode } }
    this.notify()
  }

  closeSecondaryFile(): void {
    this.flushPendingWrites()
    const path = this.state.secondaryDoc?.path
    if (path) {
      void api()
        ?.file?.unwatch?.(path)
        .catch(() => undefined)
    }
    this.state = {
      ...this.state,
      splitActive: false,
      splitSurface: 'files',
      secondaryDoc: null
    }
    this.notify()
  }

  setSecondaryContent(content: string): void {
    const secondary = this.state.secondaryDoc
    if (!secondary) return

    // A conflict merge resolves into the document itself, so the merged text
    // has to land on the active tab and not just the top-level mirror.
    // `applyConflictReview` builds the diff from the active tab against the same
    // path on disk, so writing only the mirror would restore the pre-merge text
    // when the split closes, and the next save would write the losing version.
    if (secondary.isDiff) {
      if (secondary.mergeTarget === 'secondary') {
        // A merge raised against this pane resolves back into this pane. The
        // active tab never held this text, so routing it through setContent
        // would put the pane's file over whatever tab happened to be active.
        void this.writeSecondary(secondary.path, content)
        return
      }
      // Both setContent and the save below act on whatever tab is active now. If
      // it is no longer the file under merge, writing would put one document
      // over a different file, so the merge stays open until the right tab is
      // back.
      const tab = this.activeTabDoc()
      if (!sameFilePath(tab?.path, secondary.path)) return
      this.setContent(content)
      // Accept and Reject are explicit "keep this" clicks, so they must land on
      // disk now. Leaving it to the autosave debounce meant a resolve with
      // auto-save off silently kept the on-disk version.
      void this.save()
      return
    }

    const dirty = content !== secondary.originalContent
    // Same file open in both panes: the tab owns persistence, so mirror the
    // edit into it. Otherwise the panes diverge and neither autosave nor save
    // (both tab-scoped) ever sees the secondary keystrokes.
    const tab = this.activeTabDoc()
    if (tab?.path && secondary.path && sameFilePath(tab.path, secondary.path)) {
      this.state = {
        ...this.state,
        secondaryDoc: { ...secondary, content, dirty: false, originalContent: content }
      }
      this.setContent(content)
      return
    }

    this.state = {
      ...this.state,
      secondaryDoc: {
        ...secondary,
        content,
        dirty
      }
    }
    this.notify()
    this.scheduleSecondaryAutoSave()
  }

  /**
   * Secondary pane has its own debounce: the primary autosave only writes the
   * active tab, so without this, edits to a different file in split view sat
   * in memory until the pane closed.
   */
  private scheduleSecondaryAutoSave(): void {
    if (this.secondaryAutoSaveTimer !== null) {
      clearTimeout(this.secondaryAutoSaveTimer)
      this.secondaryAutoSaveTimer = null
    }
    const secondary = this.state.secondaryDoc
    const autoSave = this.settingsStore.get('editor.autoSave', true)
    const delay = this.settingsStore.get('editor.autoSaveDelay', 500)
    if (!autoSave || !secondary || secondary.isDiff || !secondary.dirty || !secondary.path) return
    const path = secondary.path
    const content = secondary.content
    this.secondaryAutoSaveTimer = setTimeout(() => {
      this.secondaryAutoSaveTimer = null
      const current = this.state.secondaryDoc
      if (!current || current.path !== path || current.content !== content || !current.dirty) {
        return
      }
      void this.saveSecondary()
    }, delay)
  }

  /** Write a dirty secondary document (different file) back to disk. */
  async saveSecondary(): Promise<boolean> {
    const secondary = this.state.secondaryDoc
    if (!secondary || secondary.isDiff || !secondary.dirty || !secondary.path) return false
    if (this.isDeleting(secondary.path)) return false
    this.state = { ...this.state, secondaryDoc: { ...secondary, pendingWrite: secondary.content } }
    try {
      const result = await this.writeDocument(secondary.path, secondary.content)
      if (!result) return false
      const current = this.state.secondaryDoc
      if (current && current.path === secondary.path) {
        this.state = {
          ...this.state,
          secondaryDoc: {
            ...current,
            originalContent: secondary.content,
            mtime: result.mtime,
            dirty: current.content !== secondary.content
          }
        }
        this.notify()
      }
      return true
    } catch (e) {
      console.error('Failed to save secondary file:', e)
      return false
    } finally {
      const current = this.state.secondaryDoc
      if (
        current &&
        current.path === secondary.path &&
        current.pendingWrite === secondary.content
      ) {
        this.state = { ...this.state, secondaryDoc: { ...current, pendingWrite: null } }
      }
    }
  }

  /**
   * Write text straight to the split pane's own path and adopt it as the pane's
   * content. Unlike `saveSecondary` this does not require the pane to be dirty:
   * it carries the result of a merge, which is a write the user asked for by
   * resolving, not a debounced autosave.
   */
  async writeSecondary(path: string | null, content: string): Promise<boolean> {
    if (!path) return false
    if (this.isDeleting(path)) return false
    try {
      const result = await this.writeDocument(path, content)
      if (!result) return false
      const current = this.state.secondaryDoc
      if (current && sameFilePath(current.path, path)) {
        this.state = {
          ...this.state,
          secondaryDoc: {
            ...current,
            content,
            originalContent: content,
            mtime: result.mtime,
            dirty: false
          }
        }
        this.notify()
      }
      return true
    } catch (e) {
      console.error('Failed to write merged split-pane file:', e)
      return false
    }
  }

  /**
   * Flag the active document as conflicting with what is now on disk. Only the
   * file-changed watcher used to be able to do this, which left the whole
   * conflict flow untestable without a real filesystem event.
   */
  raiseConflict(info: ConflictInfo): void {
    this.state = { ...this.state, conflict: info }
    this.notify()
  }

  resolveConflictReview(): void {
    if (!this.state.conflict) return
    this.state = { ...this.state, ...applyConflictReview(this.state) }
    this.notify()
  }

  resolveConflictReload(): void {
    if (!this.state.conflict) return
    this.state = { ...this.state, ...applyConflictReload(this.state) }
    this.syncMirror()
    this.notify()
  }

  resolveConflictDismiss(): void {
    this.state = { ...this.state, ...applyConflictDismiss() }
    this.notify()
  }

  private clearAutoSaveTimer(): void {
    if (this.autoSaveTimer !== null) {
      clearTimeout(this.autoSaveTimer)
      this.autoSaveTimer = null
    }
  }

  private clearSecondaryAutoSaveTimer(): void {
    if (this.secondaryAutoSaveTimer !== null) {
      clearTimeout(this.secondaryAutoSaveTimer)
      this.secondaryAutoSaveTimer = null
    }
  }

  private scheduleAutoSave(): void {
    this.clearAutoSaveTimer()
    const autoSave = this.settingsStore.get('editor.autoSave', true)
    const delay = this.settingsStore.get('editor.autoSaveDelay', 500)
    if (!autoSave || !this.state.dirty || !this.state.path) return
    // The timer is bound to the tab index it was armed for, so a tab switch
    // between arming and firing can never redirect the write to another tab.
    const tabIndex = this.state.activeTab
    const tabPath = this.state.path
    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = null
      const tab = this.state.tabs[tabIndex]
      if (!tab || tab.path !== tabPath || !tab.dirty) return
      if (this.state.activeTab !== tabIndex) return
      void this.save()
    }, delay)
  }
}
