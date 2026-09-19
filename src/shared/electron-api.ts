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
    get: () => Promise<Record<string, unknown>>
    set: (settings: Record<string, unknown>) => Promise<void>
  }
  dialog: {
    showOpenDialog: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>
  }
  shell: {
    openPath: (path: string) => Promise<void>
    openExternal: (url: string) => Promise<void>
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
