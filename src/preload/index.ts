import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { ChatMessage, ChatSession, UpdateInfo, UpdateProgress } from '../shared/electron-api'

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
    // One handler, two names. `dialog.showOpenDialog` below is the same
    // channel, kept because existing call sites use both spellings.
    openDialog: (options: {
      properties?: string[]
      filters?: { name: string; extensions: string[] }[]
    }) => ipcRenderer.invoke('dialog:show-open-dialog', options),
    saveDialog: (options: {
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
    }) => ipcRenderer.invoke('file:save-dialog', options),
    exists: (path: string) => ipcRenderer.invoke('file:exists', path),
    saveImage: (docPath: string, base64Data: string, ext: string) =>
      ipcRenderer.invoke('file:save-image', docPath, base64Data, ext),
    /**
     * Read one file the user picked in the attach dialog. Text comes back
     * decoded, images as bare base64, which is what the provider payloads want.
     */
    readAttachment: (path: string) => ipcRenderer.invoke('file:read-attachment', path),
    /** Electron 32+ removed File.path; this is the supported way back. */
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    /** Dropped files are not dialog results, so nothing registered them yet. */
    registerDroppedPaths: (paths: string[]) =>
      ipcRenderer.invoke('file:register-paths', paths),
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
    ) => ipcRenderer.invoke('net:chat', provider, model, apiKey, messages, systemPrompt),
    chatStream: (
      provider: string,
      model: string,
      apiKey: string,
      messages: ChatMessage[],
      onChunk: (delta: string) => void,
      systemPrompt?: string
    ): Promise<string> => {
      // The channel is live only for the duration of this call. Leaving it
      // attached would hand every later stream's deltas to this callback too.
      const listener = (_e: Electron.IpcRendererEvent, delta: string): void => onChunk(delta)
      ipcRenderer.on('net:chat-chunk', listener)
      return ipcRenderer
        .invoke('net:chat-stream', provider, model, apiKey, messages, systemPrompt)
        .finally(() => ipcRenderer.removeListener('net:chat-chunk', listener))
    },
    /**
     * Abort the stream this renderer started. Resolves with the text that had
     * already arrived, so the partial answer is kept rather than lost.
     */
    cancelChat: () => ipcRenderer.invoke('net:chat-cancel')
  },
  chat: {
    createSession: (docPath: string | null) => ipcRenderer.invoke('chat:create', docPath),
    loadSession: (id: string) => ipcRenderer.invoke('chat:load', id),
    saveSession: (session: ChatSession) => ipcRenderer.invoke('chat:save', session),
    deleteSession: (id: string) => ipcRenderer.invoke('chat:delete', id),
    listSessions: (docPath: string | null) => ipcRenderer.invoke('chat:list', docPath)
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
    onDownloadProgress: (callback: (progress: UpdateProgress) => void) =>
      onChannel('updater:download-progress', callback as (...args: unknown[]) => void),
    onError: (callback: (err: string) => void) =>
      onChannel('updater:error', callback as (...args: unknown[]) => void)
  },
  onFileOpenExternal: (callback: (path: string) => void) =>
    onChannel('file:open-external', callback as (...args: unknown[]) => void)
}

/**
 * The renderer runs sandboxed, where a preload may only `require` a short list of
 * Electron and Node built-ins. The toolkit's `electronAPI` was exposed as
 * `window.electron` but never read by anything in this app, and importing it
 * cost the preload its ability to load at all under sandbox. Everything the app
 * needs is in `writemdAPI`, described by `shared/electron-api.ts`.
 */
contextBridge.exposeInMainWorld('electronAPI', writemdAPI)
