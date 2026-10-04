import { SettingsStore } from './settings'
import { applyConflictReview, applyConflictReload, applyConflictDismiss } from './conflict'
import { api } from '../api'
import { showConfirm } from '../services/confirm'
import { sameFilePath } from '../utils/paths'

/**
 * Modes the primary pane can render.
 *
 * `'wysiwyg'` is a legacy alias the editor normalizes to `'live'`. There is
 * deliberately no `'split'` here: the split pane is `splitActive` plus
 * `splitSurface`, and a `'split'` view mode was stored and then normalized away,
 * so it could never render as anything distinct.
 */
export type ViewMode = 'live' | 'reading' | 'source' | 'wysiwyg'

export type SplitSurface = 'launcher' | 'file' | 'files' | 'backlinks' | 'ai'

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

export interface TabDoc {
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
}

/**
 * True when the disk content came from our own save, not another app.
 *
 * Structural rather than `TabDoc` so the split pane, which is watched and
 * written like a tab but carries no write-tracking fields, can use it too.
 */
export function isOwnEcho(
  doc: { originalContent: string; lastWritten?: string | null; pendingWrite?: string | null },
  diskContent: string
): boolean {
  const normDisk = diskContent.replace(/\r\n/g, '\n')
  const normOriginal = doc.originalContent.replace(/\r\n/g, '\n')
  const normLastWritten = doc.lastWritten ? doc.lastWritten.replace(/\r\n/g, '\n') : null
  const normPending = doc.pendingWrite ? doc.pendingWrite.replace(/\r\n/g, '\n') : null

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
  secondaryDoc: SecondaryDocState | null
  conflict: ConflictInfo | null
  tabs: TabDoc[]
  activeTab: number
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
    splitSurface: 'launcher',
    secondaryDoc: null,
    conflict: null,
    tabs: [],
    activeTab: 0
  }
  private listeners = new Set<(state: FileStateData) => void>()
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null
  private secondaryAutoSaveTimer: ReturnType<typeof setTimeout> | null = null
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

  private notify(): void {
    const snapshot = this.getState()
    this.listeners.forEach((cb) => cb(snapshot))
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
    this.settingsStore.set(
      'files.openTabs',
      this.state.tabs.map((t) => t.path)
    )
    this.settingsStore.set('files.activeTabPath', this.activeTabDoc()?.path ?? null)
  }

  private openTab(tab: Omit<TabDoc, 'lastWritten' | 'pendingWrite'>): void {
    this.state = {
      ...this.state,
      tabs: [...this.state.tabs, { ...tab, lastWritten: null, pendingWrite: null }],
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
    const vaultPath = await api()
      ?.vault?.getPath?.()
      .catch(() => undefined)
    const restored: TabDoc[] = []
    const seen = new Set(this.state.tabs.map((t) => t.path))
    for (const p of paths) {
      if (typeof p !== 'string') continue
      if (seen.has(p)) continue
      try {
        const exists = await api()?.file?.exists?.(p)
        if (!exists) continue
        const result = await api()?.file?.read?.(p)
        if (!result) continue
        seen.add(p)
        restored.push({
          path: p,
          content: result.content,
          originalContent: result.content,
          mtime: result.mtime,
          dirty: false,
          isVaultFile: Boolean(vaultPath && p.startsWith(vaultPath)),
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
    const idx = tabs.findIndex((t) => t.path === activePath)
    this.state = {
      ...this.state,
      tabs,
      activeTab: idx >= 0 ? idx : this.state.tabs.length + restored.length - 1
    }
    this.syncMirror()
    this.notify()
    return true
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
    this.openTab({
      path: vaultPath ? `${vaultPath}/${defaultName}` : defaultName,
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
    api()?.file?.onChanged?.(async (changedPath: string) => {
      if (!this.state.tabs.some((t) => t.path === changedPath)) {
        await this.handleSecondaryChanged(changedPath)
        return
      }
      const result = await api()?.file?.read?.(changedPath)
      if (!result) return
      // Re-resolve after the read. The tab could have been closed, reordered, or
      // renamed while it was in flight, and a stale index would write this
      // file's disk content onto an unrelated tab.
      const tabIndex = this.state.tabs.findIndex((t) => t.path === changedPath)
      if (tabIndex < 0) return
      const tab = this.state.tabs[tabIndex]

      if (isOwnEcho(tab, result.content)) {
        // Echo of our own save
        const tabs = this.state.tabs.map((t, i) =>
          i === tabIndex ? { ...t, mtime: result.mtime } : t
        )
        this.state = { ...this.state, tabs }
        this.syncMirror()
        return
      }

      if (tab.dirty) {
        if (tabIndex === this.state.activeTab) {
          this.raiseConflict({
            path: changedPath,
            diskContent: result.content,
            diskMtime: result.mtime
          })
        } else {
          // Background tab with unsaved work: rebase without touching the buffer
          const tabs = this.state.tabs.map((t, i) =>
            i === tabIndex ? { ...t, originalContent: result.content, mtime: result.mtime } : t
          )
          this.state = { ...this.state, tabs }
          this.syncMirror()
          this.notify()
        }
        return
      }

      const tabs = this.state.tabs.map((t, i) =>
        i === tabIndex
          ? {
              ...t,
              content: result.content,
              originalContent: result.content,
              mtime: result.mtime,
              dirty: false
            }
          : t
      )
      this.state = { ...this.state, tabs }
      this.syncMirror()
      this.notify()
    })
  }

  async openFile(path: string): Promise<void> {
    const existing = this.state.tabs.findIndex((t) => t.path === path)
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
        isVaultFile: Boolean(vaultPath && path.startsWith(vaultPath))
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
  async save(targetIndex?: number): Promise<boolean> {
    const index = targetIndex ?? this.state.activeTab
    const tab = this.state.tabs[index] ?? null
    if (!tab) return false
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
      const result = await api()?.file?.write?.(tab.path, contentToSave)
      // Re-resolve by path, not by this.state.activeTab. Switching tabs during
      // the write used to mark the wrong tab clean and clobber its
      // originalContent while leaving pendingWrite set on the tab that was
      // actually written, which permanently disarmed the own-echo guard.
      const writeIdx = this.state.tabs.findIndex((t) => t.path === tab.path)
      if (result && writeIdx >= 0) {
        const tabs = this.state.tabs.map((t, i) =>
          i === writeIdx
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
        void this.saveSecondary()
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
          tabs: this.state.tabs.map((t, i) => (i === idx ? { ...t, pendingWrite: null } : t))
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
    if (isSecondary) {
      const doc = this.state.secondaryDoc
      if (!doc || !doc.path) return false
      const newPath = this.buildRenamedPath(doc.path, newName)
      if (newPath === doc.path) return true
      const exists = await api()?.file?.exists?.(doc.path)
      if (exists) {
        const success = await api()?.file?.rename?.(doc.path, newPath)
        if (!success) return false
      }
      this.state = {
        ...this.state,
        secondaryDoc: { ...doc, path: newPath }
      }
      this.notify()
      return true
    }

    const tab = this.activeTabDoc()
    if (!tab || !tab.path) return false
    const newPath = this.buildRenamedPath(tab.path, newName)
    if (newPath === tab.path) return true

    const exists = await api()?.file?.exists?.(tab.path)
    if (exists) {
      const success = await api()?.file?.rename?.(tab.path, newPath)
      if (!success) return false
    }

    // Resolve by the original path: two awaits have passed, so
    // this.state.activeTab may no longer point at the tab being renamed.
    const idx = this.state.tabs.findIndex((t) => t.path === tab.path)
    if (idx < 0) return false
    const tabs = this.state.tabs.map((t, i) => (i === idx ? { ...t, path: newPath } : t))
    this.state = { ...this.state, tabs }
    this.syncMirror()
    this.persistTabs()
    this.addRecentFile(newPath)
    this.notify()
    return true
  }

  private buildRenamedPath(currentPath: string, newName: string): string {
    const parts = currentPath.replace(/\\/g, '/').split('/')
    parts.pop()
    const finalName = newName.endsWith('.md') ? newName : newName + '.md'
    return parts.length > 0 ? parts.join('/') + '/' + finalName : finalName
  }

  /** Move the active tab's file into another directory. Returns false when cancelled. */
  async moveActiveFile(): Promise<boolean> {
    const tab = this.activeTabDoc()
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
    await api()
      ?.file?.unwatch?.(tab.path)
      .catch(() => undefined)
    await api()
      ?.file?.watch?.(newPath)
      .catch(() => undefined)
    const idx = this.state.tabs.findIndex((t) => t.path === tab.path)
    if (idx < 0) return false
    const tabs = this.state.tabs.map((t, i) => (i === idx ? { ...t, path: newPath } : t))
    this.state = { ...this.state, tabs }
    this.syncMirror()
    this.persistTabs()
    this.addRecentFile(newPath)
    this.notify()
    return true
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
        splitSurface: 'launcher',
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
   * External change to the split pane's file.
   *
   * The pane has no tab of its own, so the tab branch above never looked at it.
   * That left the pane's autosave free to overwrite an edit made outside the app
   * with nothing on screen to say so, which is the one thing a watcher exists to
   * prevent. Re-resolved after the read: the pane can close or switch files while
   * it is in flight.
   */
  private async handleSecondaryChanged(changedPath: string): Promise<void> {
    const before = this.state.secondaryDoc
    if (!before || before.isDiff || !sameFilePath(before.path, changedPath)) return
    const result = await api()?.file?.read?.(changedPath)
    const current = this.state.secondaryDoc
    if (!result || !current || !sameFilePath(current.path, changedPath)) return

    if (isOwnEcho(current, result.content)) {
      this.state = { ...this.state, secondaryDoc: { ...current, mtime: result.mtime } }
      this.notify()
      return
    }
    if (current.dirty) {
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
      splitSurface: 'launcher',
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
    try {
      const result = await api()?.file?.write?.(secondary.path, secondary.content)
      if (!result) return false
      const current = this.state.secondaryDoc
      if (current && current.path === secondary.path && current.content === secondary.content) {
        this.state = {
          ...this.state,
          secondaryDoc: {
            ...current,
            originalContent: secondary.content,
            mtime: result.mtime,
            dirty: false
          }
        }
        this.notify()
      }
      return true
    } catch (e) {
      console.error('Failed to save secondary file:', e)
      return false
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
    try {
      const result = await api()?.file?.write?.(path, content)
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
