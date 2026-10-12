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

/**
 * A provider the user can pick, as the settings UI sees it.
 *
 * Mirrors `ProviderDescriptor` in the main process. Declared here rather than
 * imported from `main/ai/providers` because the renderer must not pull in
 * main-only code, and because this is the only part of a descriptor that is
 * contractual across the bridge.
 */
export interface ProviderPresetView {
  id: string
  label: string
  kind: 'openai' | 'anthropic' | 'gemini'
  defaultBaseUrl: string
  defaultModel: string
  keyRequired: boolean
  keyHint: string
}

/**
 * Result of storing the API key.
 *
 * `stored: false` with a reason is not an error path the caller should retry -
 * it is the machine having no usable keychain, and the UI has to say so rather
 * than showing a stored key that is not protected.
 */
export interface SetKeyResult {
  stored: boolean
  reason?: string
  state: 'empty' | 'stored' | 'unavailable'
}

/** What the renderer sends to start a turn. Mirrors main's `AiSendInput`. */
export interface AiSendInput {
  sessionId: string
  userText: string
  document: { path: string; content: string } | null
  selection: string | null
  references: { path: string; content: string }[]
  attachments: {
    name: string
    kind: 'image' | 'text'
    data?: string
    mimeType?: string
    text?: string
  }[]
  openPaths: string[]
}

/** One undoable change, as the change list needs it. */
export interface ChangeView {
  id: string
  path: string
  kind: 'created' | 'modified'
  createdAt: number
  revertedAt: number | null
}

export interface SkippedView {
  path: string
  reason: string
  detail: string
}

/**
 * Result of undoing one change.
 *
 * `changed-since` is the one that matters to the user: the file no longer holds
 * what the assistant wrote, so the prior content is no longer a description of
 * anything and restoring it would destroy a later edit. It is a refusal, not a
 * failure, and the UI says so rather than showing an error.
 */
export type UndoStatus = 'restored' | 'gone' | 'already-reverted' | 'changed-since' | 'unknown'

/** A saved conversation, as the history list needs it. */
export interface PersistedSessionView {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  providerId: string
  model: string | null
  contextFile: string | null
  messages: { role: 'user' | 'assistant'; content: string }[]
}

/**
 * Pushed from main as a turn runs.
 *
 * `requestId` is chosen by the renderer so it can drop events belonging to a
 * turn it already stopped - a cancelled stream is often still in flight when
 * the next one starts, and appending it into the new transcript produces text
 * neither turn produced.
 */
export type AiEvent =
  | { type: 'text'; requestId: string; delta: string }
  | { type: 'proposal'; requestId: string; files: string[]; blocks: number; skipped: string[] }
  | { type: 'applied'; requestId: string; changed: ChangeView[]; skipped: SkippedView[] }
  | { type: 'answer'; requestId: string; text: string }
  | { type: 'error'; requestId: string; message: string }
  /**
   * The turn is over. `text` is authoritative and replaces whatever streamed -
   * the streamed deltas are provisional, and when the model edited files they
   * contained the protocol rather than prose.
   */
  | { type: 'done'; requestId: string; text?: string }

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
  /**
   * The AI assistant. Note there is no "get the key" call anywhere in this
   * interface, and that is deliberate: the renderer sends a key in to store it
   * and receives back only whether one exists. The secret never crosses the
   * bridge in the readable direction.
   */
  ai: {
    presets: () => Promise<ProviderPresetView[]>
    /**
     * Model ids this key can reach. Rejects on a bad key rather than resolving
     * an empty list, so the UI can distinguish "your key is wrong" from "this
     * provider has no models".
     */
    fetchModels: (providerId: string, baseUrl: string, apiKey: string) => Promise<string[]>
    setKey: (key: string) => Promise<SetKeyResult>
    clearKey: () => Promise<SetKeyResult>
    keyState: () => Promise<'empty' | 'stored' | 'unavailable'>
    /**
     * Start a turn. Resolves once it is under way; output arrives on
     * `onEvent`. The renderer owns `requestId`.
     */
    send: (requestId: string, input: AiSendInput) => Promise<unknown>
    /**
     * Fire-and-forget. These resolve once the request is accepted, not once the
     * work is done, and the renderer only cares that they did not throw - so
     * they are typed void rather than carrying a result nobody reads.
     */
    cancel: (requestId: string) => Promise<void>
    onEvent: (callback: (event: AiEvent) => void) => () => void
    listChanges: (sessionId?: string) => Promise<ChangeView[]>
    undoChange: (journalId: string) => Promise<{
      status: UndoStatus
      path?: string
      entryId?: string
    }>
    listSessions: () => Promise<PersistedSessionView[]>
    saveSession: (session: PersistedSessionView) => Promise<void>
    deleteSession: (id: string) => Promise<void>
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
