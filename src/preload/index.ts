import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ChatMessage, UpdateInfo, UpdateProgress } from '../shared/electron-api'

function onChannel(channel: string, callback: (...args: unknown[]) => void): () => void {
  const handler = (_: IpcRendererEvent, ...args: unknown[]): void => callback(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

// Custom APIs for renderer
const writemdAPI = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    getPath: (name: 'home' | 'documents' | 'downloads' | 'temp') =>
      ipcRenderer.invoke('app:get-path', name),
    quit: () => ipcRenderer.invoke('app:quit')
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    zoomIn: () => ipcRenderer.invoke('window:zoom-in'),
    zoomOut: () => ipcRenderer.invoke('window:zoom-out'),
    zoomReset: () => ipcRenderer.invoke('window:zoom-reset')
  },
  file: {
    read: (path: string) => ipcRenderer.invoke('file:read', path),
    write: (path: string, content: string) => ipcRenderer.invoke('file:write', path, content),
    openDialog: (options: {
      properties?: string[]
      filters?: { name: string; extensions: string[] }[]
    }) => ipcRenderer.invoke('file:open-dialog', options),
    saveDialog: (options: {
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
    }) => ipcRenderer.invoke('file:save-dialog', options),
    exists: (path: string) => ipcRenderer.invoke('file:exists', path),
    saveImage: (docPath: string, base64Data: string, ext: string) =>
      ipcRenderer.invoke('file:save-image', docPath, base64Data, ext),
    resolveAsset: (docPath: string, relativePath: string) =>
      ipcRenderer.invoke('file:resolve-asset', docPath, relativePath),
    watch: (path: string) => ipcRenderer.invoke('file:watch', path),
    unwatch: (path: string) => ipcRenderer.invoke('file:unwatch', path),
    rename: (oldPath: string, newPath: string) =>
      ipcRenderer.invoke('file:rename', oldPath, newPath),
    delete: (path: string) => ipcRenderer.invoke('file:delete', path),
    onChanged: (callback: (path: string) => void) =>
      onChannel('file:changed', callback as (...args: unknown[]) => void)
  },
  vault: {
    getPath: () => ipcRenderer.invoke('vault:get-path'),
    setPath: (path: string) => ipcRenderer.invoke('vault:set-path', path),
    ensureExists: () => ipcRenderer.invoke('vault:ensure-exists'),
    listFiles: () => ipcRenderer.invoke('vault:list-files'),
    getTree: () => ipcRenderer.invoke('vault:get-tree')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: Record<string, unknown>) => ipcRenderer.invoke('settings:set', settings)
  },
  net: {
    fetchModels: (provider: string, apiKey: string) =>
      ipcRenderer.invoke('net:fetch-models', provider, apiKey),
    chat: (
      provider: string,
      model: string,
      apiKey: string,
      messages: ChatMessage[],
      systemPrompt?: string
    ) => ipcRenderer.invoke('net:chat', provider, model, apiKey, messages, systemPrompt)
  },
  dialog: {
    showOpenDialog: (options: Electron.OpenDialogOptions) =>
      ipcRenderer.invoke('dialog:show-open-dialog', options)
  },
  shell: {
    openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path),
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
    showInFolder: (path: string) => ipcRenderer.invoke('shell:show-in-folder', path)
  },
  export: {
    pdf: (markdown: string, docPath: string | null) =>
      ipcRenderer.invoke('export:pdf', markdown, docPath),
    html: (markdown: string, docPath: string | null) =>
      ipcRenderer.invoke('export:html', markdown, docPath),
    docx: (markdown: string, docPath: string | null) =>
      ipcRenderer.invoke('export:docx', markdown, docPath)
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onUpdateAvailable: (callback: (info: UpdateInfo) => void) =>
      onChannel('updater:update-available', callback as (...args: unknown[]) => void),
    onUpdateNotAvailable: (callback: (info: UpdateInfo) => void) =>
      onChannel('updater:update-not-available', callback as (...args: unknown[]) => void),
    onUpdateDownloaded: (callback: (info: UpdateInfo) => void) =>
      onChannel('updater:update-downloaded', callback as (...args: unknown[]) => void),
    onDownloadProgress: (callback: (info: UpdateProgress) => void) =>
      onChannel('updater:download-progress', callback as (...args: unknown[]) => void),
    onError: (callback: (err: string) => void) =>
      onChannel('updater:error', callback as (...args: unknown[]) => void)
  },
  onFileOpenExternal: (callback: (path: string) => void) =>
    onChannel('file:open-external', callback as (...args: unknown[]) => void)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('electronAPI', writemdAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // Test / non-isolated environment: DOM globals instead of the bridge.
  ;(window as unknown as { electron: unknown }).electron = electronAPI
  ;(window as unknown as { electronAPI: unknown }).electronAPI = writemdAPI
}
