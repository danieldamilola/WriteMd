/// <reference types="electron" />
import type { WriteMdSettings, WriteMdSettingsPatch } from './settings-schema'

export interface BackgroundAsset {
  id: string
  name: string
  url: string
}

export interface MaterialSupport {
  supported: boolean
  platform: string
}

export interface FileReadResult {
  content: string
  mtime: number
}

export interface FileWriteResult {
  mtime: number
}

export interface VaultFile {
  name: string
  path: string
}

export interface SavedImageResult {
  relativePath: string
  fullPath: string
}

export interface VaultTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: VaultTreeNode[]
}

export interface ExportResult {
  ok: boolean
  path?: string
  reason?: string
}

/** Update info pushed by electron-updater. Only version is contractual. */
export interface UpdateInfo {
  version?: string
}

/** Download progress pushed by electron-updater. */
export interface UpdateProgress {
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
}

/** Point-in-time snapshot so a late-subscribing renderer can sync up. */
export interface UpdaterState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  version: string
  percent: number
  error: string
}

export interface ElectronAPI {
  appearance: {
    importBackground: () => Promise<BackgroundAsset | null>
    getBackground: (id: string) => Promise<BackgroundAsset | null>
    removeBackground: (id: string) => Promise<void>
    materialSupport: () => Promise<MaterialSupport>
  }
  app: {
    getVersion: () => Promise<string>
    getPath: (name: 'home' | 'documents' | 'downloads' | 'temp') => Promise<string>
    quit: () => Promise<void>
  }
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    zoomIn: () => Promise<void>
    zoomOut: () => Promise<void>
    zoomReset: () => Promise<void>
  }
  file: {
    read: (path: string) => Promise<FileReadResult>
    write: (path: string, content: string) => Promise<FileWriteResult>
    /** Same channel as `dialog.showOpenDialog`; both spellings are in use. */
    openDialog: (options: {
      properties?: string[]
      filters?: { name: string; extensions: string[] }[]
    }) => Promise<Electron.OpenDialogReturnValue>
    saveDialog: (options: {
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
    }) => Promise<Electron.SaveDialogReturnValue>
    exists: (path: string) => Promise<boolean>
    /** Electron 32+ removed File.path; this is the supported way back. */
    getPathForFile: (file: File) => string
    /** Register dropped paths so the guards allow them to be opened. */
    registerDroppedPaths: (paths: string[]) => Promise<void>
    saveImage: (docPath: string, base64Data: string, ext: string) => Promise<SavedImageResult>
    resolveAsset: (docPath: string, relativePath: string) => Promise<string | null>
    watch: (path: string) => Promise<void>
    unwatch: (path: string) => Promise<void>
    rename: (oldPath: string, newPath: string) => Promise<boolean>
    delete: (path: string) => Promise<boolean>
    onChanged: (callback: (path: string) => void) => () => void
  }
  vault: {
    getPath: () => Promise<string>
    setPath: (path: string) => Promise<void>
    ensureExists: () => Promise<void>
    listFiles: () => Promise<VaultFile[]>
    getTree: () => Promise<VaultTreeNode>
  }
  settings: {
    get: () => Promise<WriteMdSettings>
    set: (settings: WriteMdSettingsPatch) => Promise<void>
  }
  dialog: {
    showOpenDialog: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>
  }
  shell: {
    openPath: (path: string) => Promise<void>
    openExternal: (url: string) => Promise<void>
    showInFolder: (path: string) => Promise<void>
  }
  export: {
    pdf: (markdown: string, docPath: string | null) => Promise<ExportResult>
    html: (markdown: string, docPath: string | null) => Promise<ExportResult>
    docx: (markdown: string, docPath: string | null) => Promise<ExportResult>
  }
  updater: {
    /**
     * `skipped` comes back when the newest release matches a version the user
     * declined. The update exists; it is just not being offered.
     */
    check: () => Promise<
      { updateInfo: UpdateInfo } | { error: string } | { skipped: string } | null
    >
    download: () => Promise<string[]>
    install: () => void
    getState: () => Promise<UpdaterState>
    onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void
    onUpdateNotAvailable: (callback: (info: UpdateInfo) => void) => () => void
    onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => () => void
    onDownloadProgress: (callback: (info: UpdateProgress) => void) => () => void
    onError: (callback: (err: string) => void) => () => void
  }
  onFileOpenExternal: (callback: (path: string) => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export function getAPI(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}
