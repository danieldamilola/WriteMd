import type { WriteMDSettings, WriteMDSettingsPatch } from './settings-schema'

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

/** A single chat message sent to an AI provider. */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
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

export interface ElectronAPI {
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
    openDialog: (options: {
      properties?: string[]
      filters?: { name: string; extensions: string[] }[]
    }) => Promise<Electron.OpenDialogReturnValue>
    saveDialog: (options: {
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
    }) => Promise<Electron.SaveDialogReturnValue>
    exists: (path: string) => Promise<boolean>
    listDir: (path: string) => Promise<VaultFile[]>
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
    get: () => Promise<WriteMDSettings>
    set: (settings: WriteMDSettingsPatch) => Promise<void>
  }
  net: {
    fetchModels: (provider: string, apiKey: string) => Promise<string[]>
    chat: (
      provider: string,
      model: string,
      apiKey: string,
      messages: ChatMessage[],
      systemPrompt?: string
    ) => Promise<string>
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
  }
  updater: {
    check: () => Promise<{ updateInfo: UpdateInfo } | null>
    download: () => Promise<string[]>
    install: () => void
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
