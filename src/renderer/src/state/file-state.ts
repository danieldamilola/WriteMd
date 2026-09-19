import { SettingsStore } from './settings'
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
    conflict: null
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

  async newFile(): Promise<void> {
    if (this.state.dirty) {
      const ok = await showConfirm('You have unsaved changes. Create new file anyway?')
      if (!ok) return
    }
    const vaultPath = await api()
      ?.vault?.getPath?.()
      .catch(() => undefined)
    const defaultName = this.settingsStore.get('files.defaultNewFileName', 'Untitled.md')
    const defaultContent = this.settingsStore.get('files.defaultNewFileContent', '')
    this.state = {
      ...this.state,
      path: vaultPath ? `${vaultPath}/${defaultName}` : defaultName,
      content: defaultContent,
      originalContent: defaultContent,
      mtime: Date.now(),
      dirty: false,
      isVaultFile: true
    }
    this.notify()
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
      if (this.state.path === changedPath) {
        const result = await api()?.file?.read?.(changedPath)
        if (!result) return

        if (result.content === this.state.originalContent) {
          // Echo of our own save
          this.state = { ...this.state, mtime: result.mtime }
          return
        }

        if (this.state.dirty) {
          this.state = {
            ...this.state,
            conflict: {
              path: changedPath,
              diskContent: result.content,
              diskMtime: result.mtime
            }
          }
          this.notify()
          return
        }
        
        this.state = {
          ...this.state,
          content: result.content,
          originalContent: result.content,
          mtime: result.mtime,
          dirty: false
        }
        this.notify()
      }
    })
  }

  async openFile(path: string): Promise<void> {
    if (this.state.dirty && this.state.path !== path) {
      const ok = await showConfirm('You have unsaved changes. Open another file anyway?')
      if (!ok) return
    }
    try {
      const result = await api()?.file?.read?.(path)
      if (!result) throw new Error('Failed to read file')
      const vaultPath = await api()
        ?.vault?.getPath?.()
        .catch(() => undefined)
      this.state = {
        ...this.state,
        path,
        content: result.content,
        originalContent: result.content,
        mtime: result.mtime,
        dirty: false,
        isVaultFile: Boolean(vaultPath && path.startsWith(vaultPath))
      }
      this.addRecentFile(path)
      await api()
        ?.file?.watch?.(path)
        .catch(() => undefined)
      this.notify()
    } catch (e) {
      console.error('Failed to open file:', e)
      alert(`Failed to open file: ${e}`)
    }
  }

  async save(): Promise<boolean> {
    if (!this.state.path) return this.saveAs()
    try {
      const result = await api()?.file?.write?.(this.state.path, this.state.content)
      if (result) {
        this.state = {
          ...this.state,
          originalContent: this.state.content,
          mtime: result.mtime,
          dirty: false
        }
        if (this.state.path) {
          this.addRecentFile(this.state.path)
        }
        this.notify()
        return true
      }
    } catch (e) {
      console.error('Failed to save file:', e)
      alert(`Failed to save file: ${e}`)
    }
    return false
  }

  async saveAs(): Promise<boolean> {
    const result = await api()?.file?.saveDialog?.({
      defaultPath: this.state.path ?? undefined,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }]
    })
    if (result && !result.canceled && result.filePath) {
      this.state = { ...this.state, path: result.filePath }
      return this.save()
    }
    return false
  }

  async renameFile(newName: string, isSecondary = false): Promise<boolean> {
    const doc = isSecondary ? this.state.secondaryDoc : this.state
    if (!doc || !doc.path) return false
    
    // Construct new path by replacing the basename
    const parts = doc.path.replace(/\\/g, '/').split('/')
    parts.pop()
    const finalName = newName.endsWith('.md') ? newName : newName + '.md'
    const newPath = parts.length > 0 ? parts.join('/') + '/' + finalName : finalName
    
    if (newPath === doc.path) return true

    const exists = await api()?.file?.exists?.(doc.path)
    if (exists) {
      const success = await api()?.file?.rename?.(doc.path, newPath)
      if (!success) return false
    }
    
    if (isSecondary && this.state.secondaryDoc) {
      this.state = {
        ...this.state,
        secondaryDoc: { ...this.state.secondaryDoc, path: newPath }
      }
    } else {
      this.state = { ...this.state, path: newPath }
      this.addRecentFile(newPath)
    }
    this.notify()
    return true
  }

  setContent(content: string): void {
    const isDiff = Boolean(this.state.secondaryDoc?.isDiff)
    this.state = {
      ...this.state,
      content,
      dirty: content !== this.state.originalContent,
      ...(isDiff && this.state.secondaryDoc
        ? {
            secondaryDoc: {
              ...this.state.secondaryDoc,
              content
            }
          }
        : {})
    }
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
    const { path, diskContent, diskMtime } = this.state.conflict
    this.state = {
      ...this.state,
      conflict: null,
      splitActive: true,
      splitSurface: 'file',
      secondaryDoc: {
        path,
        content: this.state.content,
        originalContent: diskContent,
        mtime: diskMtime,
        dirty: false,
        viewMode: 'source',
        isDiff: true
      }
    }
    this.notify()
  }

  resolveConflictReload(): void {
    if (!this.state.conflict) return
    const { diskContent, diskMtime } = this.state.conflict
    this.state = {
      ...this.state,
      conflict: null,
      content: diskContent,
      originalContent: diskContent,
      mtime: diskMtime,
      dirty: false,
      ...(this.state.secondaryDoc?.isDiff ? { splitActive: false, secondaryDoc: null } : {})
    }
    this.notify()
  }

  resolveConflictDismiss(): void {
    this.state = {
      ...this.state,
      conflict: null
    }
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
