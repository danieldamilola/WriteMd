import { SettingsStore } from './settings'
import { applyConflictReview, applyConflictReload, applyConflictDismiss } from './conflict'
import type { ElectronAPI } from '../../../shared/electron-api'
import { showConfirm } from '../components/ConfirmDialog'

function api(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

export type ViewMode = 'live' | 'reading' | 'source' | 'wysiwyg' | 'split'

export type SplitSurface = 'launcher' | 'file' | 'files' | 'backlinks' | 'ai'

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
    this.state = { ...this.state, activeTab: index }
    this.syncMirror()
    this.persistTabs()
    this.notify()
  }

  async closeTab(index: number): Promise<void> {
    const tab = this.state.tabs[index]
    if (!tab) return
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
      const tabIndex = this.state.tabs.findIndex((t) => t.path === changedPath)
      if (tabIndex < 0) return
      const tab = this.state.tabs[tabIndex]
      const result = await api()?.file?.read?.(changedPath)
      if (!result) return

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

  async save(): Promise<boolean> {
    const tab = this.activeTabDoc()
    if (!tab) return false
    if (!tab.path) return this.saveAs()
    try {
      // Mark as pending to prevent watcher race conditions
      const contentToSave = tab.content
      this.state = {
        ...this.state,
        tabs: this.state.tabs.map((t, i) =>
          i === this.state.activeTab ? { ...t, pendingWrite: contentToSave } : t
        )
      }
      const result = await api()?.file?.write?.(tab.path, contentToSave)
      if (result) {
        const tabs = this.state.tabs.map((t, i) =>
          i === this.state.activeTab
            ? {
                ...t,
                originalContent: contentToSave,
                mtime: result.mtime,
                dirty: false,
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
      this.state = {
        ...this.state,
        tabs: this.state.tabs.map((t, i) =>
          i === this.state.activeTab ? { ...t, pendingWrite: null } : t
        )
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
      const tabs = this.state.tabs.map((t, i) =>
        i === this.state.activeTab ? { ...t, path: result.filePath } : t
      )
      this.state = { ...this.state, tabs }
      this.syncMirror()
      this.persistTabs()
      return this.save()
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

    const tabs = this.state.tabs.map((t, i) =>
      i === this.state.activeTab ? { ...t, path: newPath } : t
    )
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
    const tabs = this.state.tabs.map((t, i) =>
      i === this.state.activeTab ? { ...t, path: newPath } : t
    )
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

  closeSecondaryFile(): void {
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

  private scheduleAutoSave(): void {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer)
    const autoSave = this.settingsStore.get('editor.autoSave', true)
    const delay = this.settingsStore.get('editor.autoSaveDelay', 500)
    if (autoSave && this.state.dirty && this.state.path) {
      this.autoSaveTimer = setTimeout(() => {
        void this.save()
      }, delay)
    }
  }
}
