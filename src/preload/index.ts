import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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
    isMaximized: () => ipcRenderer.invoke('window:is-maximized')
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
    rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('file:rename', oldPath, newPath),
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
  dialog: {
    showOpenDialog: (options: Electron.OpenDialogOptions) =>
      ipcRenderer.invoke('dialog:show-open-dialog', options)
  },
  shell: {
    openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path),
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url)
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
    contextBridge.exposeInMainWorld('api', writemdAPI)
    contextBridge.exposeInMainWorld('electronAPI', writemdAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = writemdAPI
  // @ts-ignore (define in dts)
  window.electronAPI = writemdAPI
}
