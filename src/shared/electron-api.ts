/// <reference types="electron" />
import type { WriteMdSettings, WriteMdSettingsPatch } from './settings-schema'

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

/** An image attached to a prompt, base64 with no data: prefix. */
export interface ChatImage {
  /** Base64 payload. Prefixed onto a data URL only for OpenAI-shaped APIs. */
  data: string
  /** IANA subtype, e.g. `image/png`. Gemini and Anthropic want this verbatim. */
  mediaType: string
  /** File name, shown in the transcript so the user can see what they sent. */
  name: string
}

/** A single chat message sent to an AI provider. */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  /**
   * Images attached alongside `content`, vision-capable providers only.
   *
   * Every provider spells this differently, so the shape stays uniform here and
   * each adapter translates it. A message with images but empty content is
   * legitimate (a bare screenshot with no prompt), which is why `content`
   * cannot be folded into the images themselves.
   */
  images?: ChatImage[]
}

/**
 * One file the user attached to a prompt.
 *
 * `kind` decides how it reaches the provider: text is inlined into the message
 * content, images ride along as vision parts.
 */
export interface AttachedFile {
  path: string
  name: string
  kind: 'text' | 'image'
  /** Byte length, for the transcript chip. */
  size: number
  /** Populated for `kind: 'text'`; the content inlined into the prompt. */
  text?: string
  /** Populated for `kind: 'image'`; base64 with no data: prefix. */
  data?: string
  mediaType?: string
}

/** A stored conversation. `docPath` is null for a scratch chat with no file. */
export interface ChatSession {
  id: string
  /** Derived from the first user message; empty until there is one. */
  title: string
  docPath: string | null
  createdAt: number
  updatedAt: number
  /**
   * `thinking` entries are a local record of elapsed time, rendered by the
   * panel and filtered out before any provider sees them.
   */
  messages: Array<{
    role: 'user' | 'assistant' | 'thinking'
    content: string
    filePath?: string
    elapsed?: number
    /**
     * Names of files this prompt carried. Metadata only: the image bytes are
     * never stored, so a restored session shows what was sent without keeping
     * megabytes of base64 on disk.
     */
    attachments?: Array<{ name: string; kind: 'text' | 'image'; size: number }>
  }>
}

/** What the history list needs, without shipping every message. */
export interface ChatSessionSummary {
  id: string
  title: string
  docPath: string | null
  createdAt: number
  updatedAt: number
  messageCount: number
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
    /**
     * Read one file the user picked in the attach dialog, as text or as base64
     * depending on its extension. Paths must have come from `showOpenDialog`.
     */
    readAttachment: (path: string) => Promise<AttachedFile>
    /** Electron 32+ removed File.path; this is the supported way back. */
    getPathForFile: (file: File) => string
    /** Register dropped paths so the guards in read-attachment allow them. */
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
  net: {
    fetchModels: (provider: string, apiKey: string) => Promise<string[]>
    chat: (
      provider: string,
      model: string,
      apiKey: string,
      messages: ChatMessage[],
      systemPrompt?: string
    ) => Promise<string>
    /**
     * Streams an answer token by token. `onChunk` fires per delta as it arrives;
     * the returned promise resolves with the same full text once the stream
     * closes, so the caller can post-process it.
     */
    chatStream: (
      provider: string,
      model: string,
      apiKey: string,
      messages: ChatMessage[],
      onChunk: (delta: string) => void,
      systemPrompt?: string
    ) => Promise<string>
    /**
     * Abort the in-flight stream. The promise from `chatStream` then resolves
     * with whatever text had already arrived instead of rejecting, so a stopped
     * reply keeps its partial answer.
     */
    cancelChat: () => Promise<void>
  }
  chat: {
    /** Create an empty session bound to a document, or null for a scratch chat. */
    createSession: (docPath: string | null) => Promise<ChatSession>
    loadSession: (id: string) => Promise<ChatSession | null>
    saveSession: (session: ChatSession) => Promise<void>
    deleteSession: (id: string) => Promise<void>
    /** Summaries for one document, newest first. */
    listSessions: (docPath: string | null) => Promise<ChatSessionSummary[]>
  }
  opencode: {
    getStatus: (customPath?: string) => Promise<{
      cliFound: boolean
      cliPath: string | null
      cliVersion: string | null
      cliMajor: number | null
      loginCommand: string
      auth: { loggedIn: boolean; detail: string }
      managedServerUp: boolean
      managedServerUrl: string | null
      searchHints: string[]
      debug: string[]
    }>
    getModels: () => Promise<string[]>
  }
  web: {
    search: (
      query: string,
      maxResults?: number
    ) => Promise<Array<{ title: string; url: string; snippet: string }>>
    searchContext: (query: string) => Promise<string>
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
    check: () => Promise<{ updateInfo: UpdateInfo } | { error: string } | null>
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
