import { SettingsStore } from './settings'
import { applyConflictReview, applyConflictReload, applyConflictDismiss } from './conflict'
import type { ElectronAPI } from '../../../shared/electron-api'
import { showConfirm } from '../components/ConfirmDialog'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

export type ViewMode = 'live' | 'reading' | 'source' | 'wysiwyg' | 'split'

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

/** True when the disk content came from our own save, not another app. */
export function isOwnEcho(tab: TabDoc, diskContent: string): boolean {
  const normDisk = diskContent.replace(/\r\n/g, '\n')
  const normOriginal = tab.originalContent.replace(/\r\n/g, '\n')
  const normLastWritten = tab.lastWritten ? tab.lastWritten.replace(/\r\n/g, '\n') : null
  const normPending = tab.pendingWrite ? tab.pendingWrite.replace(/\r\n/g, '\n') : null

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
    let opened = 0
    for (const p of paths) {
      if (typeof p !== 'string') continue
      if (this.state.tabs.some((t) => t.path === p)) continue
      try {
        const exists = await api()?.file?.exists?.(p)
        if (!exists) continue
        const result = await api()?.file?.read?.(p)
        if (!result) continue
        this.state = {
          ...this.state,
          tabs: [
            ...this.state.tabs,
            {
              path: p,
              content: result.content,
              originalContent: result.content,
              mtime: result.mtime,
              dirty: false,
              isVaultFile: Boolean(vaultPath && p.startsWith(vaultPath)),
              lastWritten: null,
              pendingWrite: null
            }
          ]
        }
        await api()
          ?.file?.watch?.(p)
          .catch(() => undefined)
        opened++
      } catch {
        continue
      }
    }
    if (opened > 0) {
      const idx = this.state.tabs.findIndex((t) => t.path === activePath)
      this.state = { ...this.state, activeTab: idx >= 0 ? idx : this.state.tabs.length - 1 }
      this.syncMirror()
      this.notify()
      return true
    }
    return false
  }

  switchTab(index: number): void {
    if (index < 0 || index >= this.state.tabs.length || index === this.state.activeTab) return
    // The autosave debounce is armed for a specific tab. Tab A's timer firing
    // after a switch would call save(), which re-reads the now-active tab and
    // writes B's content to B's path while A's edits are dropped.
    this.clearAutoSaveTimer()
    this.state = { ...this.state, activeTab: index }
    this.syncMirror()
    this.persistTabs()
    this.notify()
  }

  async closeTab(index: number): Promise<void> {
    const tab = this.state.tabs[index]
    if (!tab) return
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
      if (!this.state.tabs.some((t) => t.path === changedPath)) return
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
          this.state = {
            ...this.state,
            conflict: {
              path: changedPath,
              diskContent: result.content,
              diskMtime: result.mtime
            }
          }
          this.notify()
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
    if (mode === 'split') {
      this.state = { ...this.state, viewMode: mode, splitActive: true }
    } else {
      this.state = { ...this.state, viewMode: mode }
    }
    this.notify()
  }

  toggleViewMode(): void {
    const modes: ViewMode[] = ['wysiwyg', 'source', 'split']
    const idx = modes.indexOf(this.state.viewMode)
    const next = idx === -1 ? 'source' : modes[(idx + 1) % modes.length]
    this.setViewMode(next)
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
      this.clearAutoSaveTimer()
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

  openSecondaryFile(path: string, content: string): void {
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
    // A pending debounce belongs to whichever tab scheduled it, not to
    // whatever is active when it fires.
    this.clearAutoSaveTimer()
    this.state = {
      ...this.state,
      splitActive: false,
      splitSurface: 'launcher',
      secondaryDoc: null
    }
    this.notify()
  }

  setSecondaryContent(content: string): void {
    if (!this.state.secondaryDoc) return
    const isDiff = Boolean(this.state.secondaryDoc.isDiff)
    this.state = {
      ...this.state,
      ...(isDiff ? { content, dirty: true } : {}),
      secondaryDoc: {
        ...this.state.secondaryDoc,
        content,
        dirty: content !== this.state.secondaryDoc.originalContent
      }
    }
    this.notify()
    if (isDiff) {
      this.scheduleAutoSave()
    }
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
