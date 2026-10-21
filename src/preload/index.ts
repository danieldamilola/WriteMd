import type { OpenCodeAuthView } from '../shared/ai/opencode'
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { ChatgptAuthView } from '../shared/ai/chatgpt'
import type {
  AiEvent,
  AiSendInput,
  FileChangeSnapshot,
  PersistedSessionView,
  UpdateInfo,
  UpdateProgress
} from '../shared/electron-api'

function onChannel(channel: string, callback: (...args: unknown[]) => void): () => void {
  const handler = (_: IpcRendererEvent, ...args: unknown[]): void => callback(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

// Custom APIs for renderer
const writemdAPI = {
  appearance: {
    importBackground: () => ipcRenderer.invoke('appearance:import-background'),
    getBackground: (id: string) => ipcRenderer.invoke('appearance:get-background', id),
    removeBackground: (id: string) => ipcRenderer.invoke('appearance:remove-background', id),
    materialSupport: () => ipcRenderer.invoke('appearance:material-support')
  },
  app: {
    getBuildInfo: () => ipcRenderer.invoke('app:get-build-info'),
    getHardwareAccelerationSetting: () =>
      ipcRenderer.invoke('app:get-hardware-acceleration-setting'),
    restart: () => ipcRenderer.invoke('app:restart'),
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
    /** Electron 32+ removed File.path; this is the supported way back. */
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    /** Dropped files are not dialog results, so nothing registered them yet. */
    registerDroppedPaths: (paths: string[]) => ipcRenderer.invoke('file:register-paths', paths),
    resolveAsset: (docPath: string, relativePath: string) =>
      ipcRenderer.invoke('file:resolve-asset', docPath, relativePath),
    watch: (path: string) => ipcRenderer.invoke('file:watch', path),
    unwatch: (path: string) => ipcRenderer.invoke('file:unwatch', path),
    rename: (oldPath: string, newPath: string) =>
      ipcRenderer.invoke('file:rename', oldPath, newPath),
    delete: (path: string) => ipcRenderer.invoke('file:delete', path),
    onChanged: (callback: (path: string, snapshot?: FileChangeSnapshot) => void) =>
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
  dialog: {
    showOpenDialog: (options: Electron.OpenDialogOptions) =>
      ipcRenderer.invoke('dialog:show-open-dialog', options)
  },
  shell: {
    openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path),
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
    showInFolder: (path: string) => ipcRenderer.invoke('shell:show-in-folder', path)
  },
  github: {
    status: () => ipcRenderer.invoke('github:status'),
    star: () => ipcRenderer.invoke('github:star')
  },
  export: {
    pdf: (markdown: string, docPath: string | null) =>
      ipcRenderer.invoke('export:pdf', markdown, docPath),
    html: (markdown: string, docPath: string | null) =>
      ipcRenderer.invoke('export:html', markdown, docPath),
    docx: (markdown: string, docPath: string | null) =>
      ipcRenderer.invoke('export:docx', markdown, docPath)
  },
  /**
   * The AI assistant.
   *
   * There is deliberately no way to read the API key back. The renderer sends
   * one in to store it and gets a boolean back; main keeps the secret. A
   * `getKey` here would hand the key to every script that can reach the
   * renderer, which is exactly the boundary `contextIsolation` exists to hold.
   */
  ai: {
    opencode: {
      state: () => ipcRenderer.invoke('ai:opencode-state'),
      login: () => ipcRenderer.invoke('ai:opencode-login'),
      cancel: () => ipcRenderer.invoke('ai:opencode-cancel'),
      logout: () => ipcRenderer.invoke('ai:opencode-logout'),
      models: () => ipcRenderer.invoke('ai:opencode-models'),
      onChanged: (callback: (state: OpenCodeAuthView) => void) =>
        onChannel('ai:opencode-auth', callback as (...args: unknown[]) => void)
    },
    chatgpt: {
      state: () => ipcRenderer.invoke('ai:chatgpt-state'),
      login: (addAccount = false) => ipcRenderer.invoke('ai:chatgpt-login', addAccount),
      cancel: () => ipcRenderer.invoke('ai:chatgpt-cancel'),
      logout: () => ipcRenderer.invoke('ai:chatgpt-logout'),
      select: (id: string) => ipcRenderer.invoke('ai:chatgpt-select', id),
      acknowledgePlan: () => ipcRenderer.invoke('ai:chatgpt-acknowledge'),
      models: () => ipcRenderer.invoke('ai:chatgpt-models'),
      onChanged: (callback: (state: ChatgptAuthView) => void) =>
        onChannel('ai:chatgpt-auth', callback as (...args: unknown[]) => void)
    },
    listSkills: () => ipcRenderer.invoke('ai:list-skills'),
    openSkillsFolder: () => ipcRenderer.invoke('ai:open-skills-folder'),
    presets: () => ipcRenderer.invoke('ai:presets'),
    fetchModels: (providerId: string, baseUrl: string, apiKey: string) =>
      ipcRenderer.invoke('ai:fetch-models', providerId, baseUrl, apiKey),
    setKey: (key: string) => ipcRenderer.invoke('ai:set-key', key),
    clearKey: () => ipcRenderer.invoke('ai:clear-key'),
    keyState: () => ipcRenderer.invoke('ai:key-state'),
    send: (requestId: string, input: AiSendInput) =>
      ipcRenderer.invoke('ai:send', requestId, input),
    acceptPreview: (previewId: string) => ipcRenderer.invoke('ai:accept-preview', previewId),
    cancel: (requestId: string) => ipcRenderer.invoke('ai:cancel', requestId),
    onEvent: (callback: (event: AiEvent) => void) =>
      onChannel('ai:event', (...args: unknown[]) => callback(args[0] as AiEvent)),
    listChanges: (sessionId?: string) => ipcRenderer.invoke('ai:list-changes', sessionId),
    undoChange: (journalId: string) => ipcRenderer.invoke('ai:undo-change', journalId),
    listSessions: () => ipcRenderer.invoke('ai:list-sessions'),
    saveSession: (session: PersistedSessionView) => ipcRenderer.invoke('ai:save-session', session),
    deleteSession: (id: string) => ipcRenderer.invoke('ai:delete-session', id)
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    getState: () => ipcRenderer.invoke('updater:get-state'),
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
