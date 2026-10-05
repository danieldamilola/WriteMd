import { ipcMain, dialog, shell, net, app, type BrowserWindow } from 'electron'
import { readFile, writeFile, stat, rename, unlink, open } from 'fs/promises'
import { watch, existsSync, mkdirSync, type FSWatcher } from 'fs'
import { basename, dirname, extname, join, resolve } from 'path'
import { randomUUID } from 'crypto'
import log from 'electron-log'
import {
  getVaultPath,
  setVaultPath,
  ensureVaultExists,
  listMarkdownFiles,
  getVaultTree,
  invalidateVaultPathCache
} from './vault'
import {
  getSettings,
  getSettingsForRenderer,
  getStoredApiKey,
  setSettings,
  type WriteMdSettingsPatch
} from './settings'
import { exportDocx, exportHtml, exportPdf } from './export'
import {
  createSession,
  deleteSession,
  ensureTitle,
  listSessions,
  loadSession,
  saveSession
} from './chat-sessions'
import { getAiProvider } from '../shared/ai-providers'
import { SseParser } from './sse'
import {
  getOpencodeAuthStatus,
  listOpencodeModels,
  opencodeLoginCommand,
  opencodeSearchHints,
  resolveOpencodeBinary
} from './opencode'
import { isManagedServerUp, opencodeChat, opencodeChatStream } from './opencode-server'
import { formatSearchContext, webSearch } from './web-search'
import type { AttachedFile, ChatMessage, ChatSession } from '../shared/electron-api'
import {
  setVaultRootProvider,
  registerExternalPath,
  registerExternalPaths,
  canAccessPath,
  canProbePath,
  canRenamePath,
  canOpenWithShell,
  canWriteImageExtension,
  canWriteDocument,
  isSaneVaultRoot,
  isAllowedExternalProtocol,
  normalizePath,
  assertCanAccess,
  isSubpath
} from './path-guard'

const watchedPaths = new Map<string, FSWatcher>()

/** Guard against a runaway conversation filling the disk with transcripts. */
const MAX_SESSION_MESSAGES = 2000

/** Image types a vision-capable provider will accept as an attachment. */
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

/** Per-file ceilings for the attach dialog, chosen to stay inside a request. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_TEXT_BYTES = 256 * 1024

/** Restore access to documents referenced by our own persisted config. */
export function registerPersistedPaths(): void {
  const settings = getSettings()
  registerExternalPaths([
    ...settings.files.openTabs,
    settings.files.activeTabPath,
    ...settings.files.recentFiles
  ])
}

/** Close all fs watchers; called on app quit so nothing leaks. */
export function closeAllWatchers(): void {
  for (const watcher of watchedPaths.values()) {
    try {
      watcher.close()
    } catch {
      // already closed
    }
  }
  watchedPaths.clear()
}

export function setupIpc(getWindow: () => BrowserWindow | null): void {
  setVaultRootProvider(getVaultPath)
  registerPersistedPaths()

  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:get-path', (_, name: 'home' | 'documents' | 'downloads' | 'temp') =>
    app.getPath(name)
  )
  ipcMain.handle('app:quit', () => app.quit())

  ipcMain.handle('window:minimize', () => getWindow()?.minimize())
  ipcMain.handle('window:maximize', () => {
    const w = getWindow()
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.handle('window:close', () => getWindow()?.close())
  ipcMain.handle('window:is-maximized', () => getWindow()?.isMaximized() ?? false)

  ipcMain.handle('window:zoom-in', () => {
    const contents = getWindow()?.webContents
    if (contents) contents.setZoomFactor(Math.min(3, contents.getZoomFactor() * 1.1))
  })

  ipcMain.handle('window:zoom-out', () => {
    const contents = getWindow()?.webContents
    if (contents) contents.setZoomFactor(Math.max(0.5, contents.getZoomFactor() / 1.1))
  })

  ipcMain.handle('window:zoom-reset', () => {
    getWindow()?.webContents.setZoomFactor(1)
  })

  ipcMain.handle('file:read', async (_, filePath: string) => {
    assertCanAccess(filePath)
    const content = await readFile(filePath, 'utf-8')
    const stats = await stat(filePath)
    return { content, mtime: stats.mtimeMs }
  })

  ipcMain.handle('file:write', async (_, filePath: string, content: string) => {
    assertCanAccess(filePath)
    if (!canWriteDocument(filePath)) {
      throw new Error(`Refusing to write unsupported file type: ${filePath}`)
    }
    mkdirSync(dirname(filePath), { recursive: true })
    // Unique temp name: concurrent writes to the same file must not clobber
    // each other's temp file (and stale temps are cleaned up on failure).
    const tempPath = `${filePath}.${randomUUID()}.tmp`
    try {
      // A fresh temp file gets 0644 by default, so the rename would silently
      // widen a note the user had restricted to 0600. Carry the original mode
      // across, or fall back to owner-only for a brand new file.
      let mode: number | undefined
      try {
        mode = (await stat(filePath)).mode & 0o777
      } catch {
        mode = 0o600
      }
      const handle = await open(tempPath, 'w', mode)
      try {
        await handle.writeFile(content, 'utf-8')
        // Flush before the rename, otherwise a crash can leave the renamed file
        // present but empty, which defeats the point of writing via temp.
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(tempPath, filePath)
    } catch (e) {
      await unlink(tempPath).catch(() => {})
      throw e
    }
    const stats = await stat(filePath)
    return { mtime: stats.mtimeMs }
  })

  ipcMain.handle('file:save-dialog', async (_, options: Electron.SaveDialogOptions) => {
    const w = getWindow()
    if (!w) return { canceled: true, filePath: '' }
    const result = await dialog.showSaveDialog(w, options)
    registerExternalPath(result.filePath)
    return result
  })

  /*
   * Read one file chosen in the attach dialog.
   *
   * The dialog registers every path it returns, so `assertCanAccess` is what
   * stops the renderer from naming any other file on disk. Text is returned
   * decoded because the prompt inlines it; images are returned as base64 with
   * no data: prefix, since that is the form every provider's payload wants.
   *
   * The size ceiling is what keeps a pasted 40MB video from becoming a 53MB
   * JSON body the provider will reject with an opaque 400. Text gets a tighter
   * bound than images because it is inlined into the message itself.
   */
  ipcMain.handle('file:read-attachment', async (_, filePath: string): Promise<AttachedFile> => {
    assertCanAccess(filePath)
    const stats = await stat(filePath)
    if (!stats.isFile()) throw new Error(`Not a file: ${filePath}`)

    const ext = extname(filePath).toLowerCase()
    const name = basename(filePath)

    if (IMAGE_MEDIA_TYPES[ext]) {
      if (stats.size > MAX_IMAGE_BYTES) {
        throw new Error(`${name} is larger than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB.`)
      }
      const buffer = await readFile(filePath)
      return {
        path: filePath,
        name,
        kind: 'image',
        size: stats.size,
        data: buffer.toString('base64'),
        mediaType: IMAGE_MEDIA_TYPES[ext]
      }
    }

    if (stats.size > MAX_TEXT_BYTES) {
      throw new Error(`${name} is larger than ${Math.round(MAX_TEXT_BYTES / 1024)}KB.`)
    }
    return {
      path: filePath,
      name,
      kind: 'text',
      size: stats.size,
      text: await readFile(filePath, 'utf-8')
    }
  })

  ipcMain.handle('file:register-paths', (_, paths: string[]) => {
    if (Array.isArray(paths)) registerExternalPaths(paths.filter((p) => typeof p === 'string'))
  })

  ipcMain.handle('file:exists', async (_, filePath: string) => {
    if (!canProbePath(filePath)) return false
    return existsSync(filePath)
  })

  ipcMain.handle('file:rename', async (_, oldPath: string, newPath: string) => {
    if (!canRenamePath(oldPath, newPath)) {
      console.error(`file:rename denied: ${oldPath} -> ${newPath}`)
      return false
    }
    try {
      await rename(oldPath, newPath)
      registerExternalPath(newPath)
      return true
    } catch (e) {
      // Surface the real reason in the main log instead of swallowing it.
      console.error(`file:rename failed (${oldPath} -> ${newPath}):`, e)
      return false
    }
  })

  ipcMain.handle('file:watch', (_, filePath: string) => {
    // Both failure modes throw instead of returning quietly. A silent return
    // left the renderer believing a file was watched when it was not, so an
    // external edit never raised a conflict.
    if (!canAccessPath(filePath)) {
      throw new Error(`Access denied for path: ${filePath}`)
    }
    // Keyed by normalized path so `C:\A.md` and `c:\a.md` share one watcher
    // instead of racing two 'change' events for the same file.
    const key = normalizePath(filePath)
    if (watchedPaths.has(key)) return
    const watcher = watch(filePath, { persistent: false })
    // 'rename' matters as much as 'change' here. macOS fs.watch is
    // FSEvents-backed and reports an atomic replace as 'rename', and this app
    // (plus Obsidian, git, and every sync client) writes via rename-over. On
    // a 'change'-only subscription the conflict dialog never sees those.
    const emit = (): void => getWindow()?.webContents.send('file:changed', filePath)
    watcher.on('change', emit)
    watcher.on('rename', emit)
    // Close before dropping the entry: a watcher removed from the map without
    // close() keeps its file descriptor open until app quit.
    watcher.on('error', (err) => {
      log.warn('Watcher error, releasing', filePath, err)
      watchedPaths.delete(key)
      watcher.close()
    })
    watchedPaths.set(key, watcher)
  })

  ipcMain.handle('file:unwatch', (_, filePath: string) => {
    // Symmetric with `file:watch`: unwatch does not need read access to the
    // content, but it should not be usable to tear down a watcher for a path
    // the renderer cannot otherwise touch.
    if (!canAccessPath(filePath)) return
    const key = normalizePath(filePath)
    const watcher = watchedPaths.get(key)
    if (watcher) {
      watcher.close()
      watchedPaths.delete(key)
    }
  })

  ipcMain.handle('file:save-image', async (_, docPath: string, base64Data: string, ext: string) => {
    assertCanAccess(docPath)
    // `ext` crosses the IPC boundary, so it is validated here rather than
    // trusted. Without this check a value like `png/../../x` would place the
    // upload outside the asset folder entirely.
    if (!canWriteImageExtension(ext)) {
      throw new Error(`Refusing to save image with extension: ${ext}`)
    }
    const docDir = dirname(docPath)
    const assetsDir = join(docDir, '_assets')
    mkdirSync(assetsDir, { recursive: true })
    const filename = `${randomUUID()}.${ext.replace(/^\./, '')}`
    const fullPath = join(assetsDir, filename)
    const buffer = Buffer.from(base64Data, 'base64')
    // Same temp-file + rename discipline as `file:write`. A direct writeFile
    // truncates the target, so a crash mid-write leaves a half image that the
    // markdown already references.
    const tempPath = `${fullPath}.${randomUUID()}.tmp`
    try {
      await writeFile(tempPath, buffer, { mode: 0o600 })
      await rename(tempPath, fullPath)
    } catch (e) {
      await unlink(tempPath).catch(() => {})
      throw e
    }
    return {
      relativePath: `./_assets/${filename}`,
      fullPath
    }
  })

  ipcMain.handle('file:resolve-asset', async (_, docPath: string, relativePath: string) => {
    try {
      assertCanAccess(docPath)
      const docDir = dirname(docPath)
      const fullPath = resolve(docDir, relativePath)
      // The resolved asset must stay inside the document's directory tree.
      if (!isSubpath(fullPath, docDir)) return null
      if (!existsSync(fullPath)) return null
      const buffer = await readFile(fullPath)
      const ext = fullPath.split('.').pop()?.toLowerCase() || 'png'
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        webp: 'image/webp',
        bmp: 'image/bmp'
      }
      const mime = mimeMap[ext] || 'image/png'
      return `data:${mime};base64,${buffer.toString('base64')}`
    } catch {
      return null
    }
  })

  ipcMain.handle('vault:get-path', () => getVaultPath())
  ipcMain.handle('vault:set-path', async (_, vaultPath: string) => {
    // This handler defines the root that every other path guard in the app is
    // measured against, so an unvalidated value here voids all of them: a vault
    // of "C:\" makes isPathInVault true for the entire drive, and
    // ensureVaultExists would mkdir it. Reject at the door instead.
    if (!isSaneVaultRoot(vaultPath)) {
      throw new Error(`Refusing to use that folder as the vault: ${vaultPath}`)
    }
    await setVaultPath(vaultPath)
    // Deliberately not seeded with the welcome note, though this folder may
    // also be new. Pointing the vault at a specific directory is a deliberate
    // act by someone who already has notes; a file appearing there unasked is
    // the surprise this app is built to avoid.
    ensureVaultExists()
  })
  ipcMain.handle('vault:ensure-exists', () => ensureVaultExists())
  ipcMain.handle('vault:list-files', () => listMarkdownFiles(getVaultPath()))
  ipcMain.handle('vault:get-tree', () => getVaultTree())

  ipcMain.handle('settings:get', () => getSettingsForRenderer())
  ipcMain.handle('settings:set', async (_, settings: WriteMdSettingsPatch) => {
    // Every path guard measures against `getVaultPath()`. A vault change that
    // arrives through settings rather than `vault:set-path` still has to move
    // that boundary, so the cache cannot survive it.
    if (settings && typeof settings === 'object' && 'vaultPath' in (settings.files ?? {})) {
      invalidateVaultPathCache()
    }
    await setSettings(settings)
  })

  // Single owner for the open dialog: every chosen path is registered so the
  // renderer can read/write it afterwards. `file:open-dialog` used to be a
  // byte-identical twin of this handler.
  ipcMain.handle('dialog:show-open-dialog', async (_, options: Electron.OpenDialogOptions) => {
    const w = getWindow()
    if (!w) return { canceled: true, filePaths: [] }
    const result = await dialog.showOpenDialog(w, options)
    registerExternalPaths(result.filePaths)
    return result
  })

  ipcMain.handle('shell:open-path', async (_, targetPath: string) => {
    assertCanAccess(targetPath)
    if (!canOpenWithShell(targetPath)) {
      throw new Error(`shell:open-path denied for file type: ${targetPath}`)
    }
    await shell.openPath(targetPath)
  })

  // Routed here rather than handled in the renderer so every outbound link,
  // from any surface, passes the same protocol allowlist.
  ipcMain.handle('shell:open-external', async (_, url: string) => {
    // Only well-known safe schemes may leave the app; file:/// or custom
    // protocol handlers would let a crafted link launch arbitrary content.
    if (!isAllowedExternalProtocol(url)) {
      throw new Error(`Protocol not allowed: ${url}`)
    }
    await shell.openExternal(url)
  })

  ipcMain.handle('shell:show-in-folder', (_, filePath: string) => {
    if (!canProbePath(filePath)) return
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('file:delete', async (_, filePath: string) => {
    if (!canAccessPath(filePath)) {
      console.error(`file:delete denied: ${filePath}`)
      return false
    }
    try {
      await shell.trashItem(filePath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('export:pdf', async (_, markdown: string, docPath: string | null) => {
    assertExportSource(docPath)
    return exportPdf(getWindow, markdown, docPath)
  })

  ipcMain.handle('export:html', async (_, markdown: string, docPath: string | null) => {
    assertExportSource(docPath)
    return exportHtml(getWindow, markdown, docPath)
  })

  ipcMain.handle('export:docx', async (_, markdown: string, docPath: string | null) => {
    assertExportSource(docPath)
    return exportDocx(getWindow, markdown, docPath)
  })

  /**
   * `docPath` decides where relative assets are read from during export. It
   * arrives from the renderer, so it goes through the same guard as every other
   * renderer-supplied path: without this, exporting a buffer could pull in any
   * file the process can read by naming it as the document.
   */
  function assertExportSource(docPath: string | null): void {
    if (docPath) assertCanAccess(docPath)
  }

  async function assertOk(res: Response): Promise<void> {
    if (res.ok) return
    if (res.status === 429) throw new Error('rate limit hit')
    throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  }

  // The renderer sends an empty key and the stored one is substituted here, so
  // the plaintext secret never has to live in renderer memory.
  const resolveApiKey = (provided: string | undefined): string =>
    provided && provided.length > 0 ? provided : getStoredApiKey()

  /** One-line per probe, newest last, for the Settings diagnostics box. */
  function formatAttempts(
    attempts: Array<{ path: string; ok: boolean; detail: string }>
  ): string[] {
    return attempts.map((a) => `${a.ok ? 'OK' : '--'} ${a.path} - ${a.detail}`)
  }

  ipcMain.handle('net:fetch-models', async (_, provider: string, apiKey: string) => {
    if (provider === 'OpenCode') {
      const customPath = getSettings().ai.opencodeCliPath || undefined
      const { found } = await resolveOpencodeBinary(customPath)
      if (!found)
        throw new Error('opencode CLI not found. Set its path in Settings → AI Assistant.')
      const models = await listOpencodeModels(found.path, getVaultPath())
      // Empty when the CLI has no models subcommand output: the model field
      // stays free-text (provider/model) rather than blocking the user.
      return models ?? []
    }
    const adapter = getAiProvider(provider)
    if (!adapter) throw new Error(`Unknown AI provider: ${provider}`)
    if (adapter.staticModels) return [...adapter.staticModels]
    const req = adapter.buildModelsRequest(resolveApiKey(apiKey))
    if (!req) return []
    try {
      const res = await net.fetch(req.url, { headers: req.headers })
      await assertOk(res)
      return adapter.extractModelIds(await res.json())
    } catch (e) {
      console.error('Failed to fetch models in main process:', e)
      throw e
    }
  })

  /** Flatten chat messages for the OpenCode prompt (single text part). */
  function opencodePromptFrom(
    messages: Array<ChatMessage | { role: string; content: string }>,
    systemPrompt?: string
  ): string {
    // Images are not silently dropped. `opencodePromptFrom` reads only role and
    // content, so a screenshot attached to the last message used to vanish here
    // while the panel still showed the attachment chip - and the model answered a
    // question about an image it had never been sent. Saying so beats a
    // confident wrong answer.
    const withImages = messages.filter(
      (m) => 'images' in m && Array.isArray(m.images) && m.images.length > 0
    )
    if (withImages.length > 0) {
      throw new Error(
        'OpenCode cannot read image attachments in this build. Remove the image and ask again, or use a provider that accepts images.'
      )
    }
    const parts: string[] = []
    if (systemPrompt) parts.push(systemPrompt)
    for (const m of messages) {
      if (m.role === 'thinking') continue
      parts.push(`${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
    }
    // Sessions run deny-all permissions, so tools can never execute - but the
    // model does not know that and still emits tool-call markup into its
    // answer. Forbid it in prose too; stripToolArtifacts is the backstop.
    parts.push(
      '[WriteMd: answer directly in markdown. You have no tools available - ' +
        'never emit tool calls, invoke blocks, or XML-like markup, just the answer.]'
    )
    return parts.join('\n\n')
  }

  async function resolveOpencodeOrThrow(): Promise<{ path: string; version: string | null }> {
    const customPath = getSettings().ai.opencodeCliPath || undefined
    const { found } = await resolveOpencodeBinary(customPath)
    if (!found) {
      throw new Error(
        'opencode CLI not found. Set its path in Settings → AI Assistant (e.g. %APPDATA%\\npm\\opencode.cmd).'
      )
    }
    return found
  }

  /**
   * The free-tier gate answers 403 to anything it does not recognize as the
   * official client with a completed login (proxies hit it too). A raw
   * "within OpenCode" dump sends the user nowhere, so translate it into the
   * three things that actually fix it.
   */
  function opencodeFriendlyError(e: unknown): string {
    const msg = e instanceof Error ? e.message : 'Chat failed'
    if (/within OpenCode|free tier/i.test(msg)) {
      return (
        'OpenCode refused the free model. Complete `opencode console login` in a terminal ' +
        'and confirm with `opencode auth list`, then Recheck in Settings → AI Assistant. ' +
        'If login is done, the free IP quota may be spent - wait or pick a connected/paid model.'
      )
    }
    return msg
  }

  async function runOpencodeChat(
    model: string,
    messages: ChatMessage[],
    systemPrompt: string | undefined,
    cwd: string,
    onDelta?: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const found = await resolveOpencodeOrThrow()
    const prompt = opencodePromptFrom(messages, systemPrompt)
    const input = {
      bin: found.path,
      version: found.version,
      directory: cwd,
      model: model?.trim() || undefined,
      prompt,
      signal
    }
    // One-shot and streaming share the managed `serve` backend: blocking
    // message for chat, prompt_async + /event SSE for stream.
    const text = onDelta
      ? await opencodeChatStream({ ...input, onDelta })
      : await opencodeChat(input)
    if (!text) throw new Error('opencode returned no output')
    return text
  }

  ipcMain.handle(
    'net:chat',
    async (
      _,
      provider: string,
      model: string,
      apiKey: string,
      messages: ChatMessage[],
      systemPrompt?: string
    ) => {
      if (provider === 'OpenCode') {
        try {
          return await runOpencodeChat(model, messages, systemPrompt, getVaultPath())
        } catch (e) {
          console.error('OpenCode chat error:', e)
          throw new Error(opencodeFriendlyError(e), { cause: e })
        }
      }
      const adapter = getAiProvider(provider)
      if (!adapter) throw new Error(`Unknown AI provider: ${provider}`)
      try {
        const req = adapter.buildChatRequest({
          model,
          apiKey: resolveApiKey(apiKey),
          messages,
          systemPrompt
        })
        const res = await net.fetch(req.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...req.headers },
          body: JSON.stringify(req.body)
        })
        await assertOk(res)
        return adapter.extractChatText(await res.json())
      } catch (e) {
        console.error('Chat error:', e)
        // { cause } keeps the provider's own error on the rethrow, which
        // otherwise flattened a 401 from the API into a bare message.
        throw new Error(e instanceof Error ? e.message : 'Chat failed', { cause: e })
      }
    }
  )

  /*
   * In-flight stream aborts, keyed by the WebContents that started them.
   *
   * The send button becomes a stop square while a reply is arriving, so the
   * click has to reach the socket rather than only the renderer's flags. Keying
   * on the sender means a cancel cannot abort a stream belonging to another
   * window, and the entry is deleted in a finally so the map cannot grow.
   */
  const activeStreams = new Map<number, AbortController>()

  ipcMain.handle('net:chat-cancel', (event) => {
    activeStreams.get(event.sender.id)?.abort()
  })

  ipcMain.handle(
    'net:chat-stream',
    async (
      event,
      provider: string,
      model: string,
      apiKey: string,
      messages: ChatMessage[],
      systemPrompt?: string
    ): Promise<string> => {
      if (provider === 'OpenCode') {
        const send = (delta: string): void => {
          if (delta && !event.sender.isDestroyed()) event.sender.send('net:chat-chunk', delta)
        }
        const controller = new AbortController()
        activeStreams.set(event.sender.id, controller)
        try {
          return await runOpencodeChat(
            model,
            messages,
            systemPrompt,
            getVaultPath(),
            send,
            controller.signal
          )
        } catch (e) {
          if (controller.signal.aborted) return ''
          console.error('OpenCode stream error:', e)
          throw new Error(opencodeFriendlyError(e), { cause: e })
        } finally {
          if (activeStreams.get(event.sender.id) === controller) {
            activeStreams.delete(event.sender.id)
          }
        }
      }
      const adapter = getAiProvider(provider)
      if (!adapter) throw new Error(`Unknown AI provider: ${provider}`)
      const req = adapter.buildStreamRequest({
        model,
        apiKey: resolveApiKey(apiKey),
        messages,
        systemPrompt
      })
      if (!req) throw new Error(`${provider} cannot stream responses`)
      const send = (delta: string): void => {
        if (delta && !event.sender.isDestroyed()) event.sender.send('net:chat-chunk', delta)
      }
      // One controller per sender: a second send supersedes the first rather
      // than leaking an unreachable abort handle.
      activeStreams.get(event.sender.id)?.abort()
      const controller = new AbortController()
      activeStreams.set(event.sender.id, controller)
      try {
        const res = await net.fetch(req.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...req.headers },
          body: JSON.stringify(req.body),
          signal: controller.signal
        })
        await assertOk(res)
        const parser = new SseParser()
        let full = ''
        const body = res.body
        if (!body) {
          // No readable stream (a provider that ignored `stream: true`, or a
          // fetch build without streaming). Deliver it as one delta so the
          // renderer path is identical either way.
          const text = adapter.extractChatText(await res.json())
          send(text)
          return text
        }
        const reader = body.getReader()
        const decoder = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          // `stream: true` on the decoder matters: a multi-byte character can be
          // split across two reads and would otherwise decode to U+FFFD.
          for (const payload of parser.feed(decoder.decode(value, { stream: true }))) {
            const delta = adapter.extractStreamChunk(payload)
            if (delta) {
              full += delta
              send(delta)
            }
          }
        }
        // A provider that closes without a trailing blank line hides its last
        // frame until flush.
        for (const payload of parser.flush()) {
          const delta = adapter.extractStreamChunk(payload)
          if (delta) {
            full += delta
            send(delta)
          }
        }
        return full
      } catch (e) {
        // A user-initiated stop is not a failure and must not be reported as
        // one: it would put "aborted" in the transcript as an assistant message.
        if (controller.signal.aborted) return ''
        console.error('Chat stream error:', e)
        throw new Error(e instanceof Error ? e.message : 'Chat failed', { cause: e })
      } finally {
        if (activeStreams.get(event.sender.id) === controller) {
          activeStreams.delete(event.sender.id)
        }
      }
    }
  )

  // Chat sessions. The id arrives from the renderer, so chat-sessions.ts
  // validates it against a bare-id pattern before touching the filesystem.
  ipcMain.handle('chat:create', async (_e, docPath: string | null) => createSession(docPath))

  ipcMain.handle('chat:load', async (_e, id: string) => loadSession(id))

  ipcMain.handle('chat:save', async (_e, session: ChatSession) => {
    if (!session || typeof session.id !== 'string') throw new Error('Invalid chat session')
    // A session is a transcript, not a document. Cap it so a runaway loop cannot
    // fill the disk, and reject the shape rather than writing whatever arrived.
    if (!Array.isArray(session.messages)) throw new Error('Invalid chat session messages')
    if (session.messages.length > MAX_SESSION_MESSAGES) {
      throw new Error(`Chat session exceeds ${MAX_SESSION_MESSAGES} messages`)
    }
    for (const m of session.messages) {
      // `thinking` is a local elapsed-time record the panel renders, so it is
      // accepted here and filtered out before the payload reaches a provider.
      const valid =
        typeof m?.content === 'string' &&
        (m.role === 'user' || m.role === 'assistant' || m.role === 'thinking')
      if (!valid) throw new Error('Invalid chat session message')
    }
    await saveSession(await ensureTitle({ ...session, updatedAt: Date.now() }))
  })

  ipcMain.handle('chat:delete', async (_e, id: string) => deleteSession(id))

  ipcMain.handle('chat:list', async (_e, docPath: string | null) => listSessions(docPath))

  /*
   * Local opencode detection. Handles the Windows npm shim (%APPDATA%\npm\
   * opencode.cmd) and prefers runnable extensions when `where` lists the
   * extensionless script first. Accepts an explicit path so Settings can
   * verify a user-picked binary.
   */
  ipcMain.handle('opencode:get-status', async (_, customPath?: string) => {
    const stored = typeof customPath === 'string' && customPath ? customPath : undefined
    const { found, attempts } = await resolveOpencodeBinary(
      stored ?? getSettings().ai.opencodeCliPath ?? ''
    )
    const debug = formatAttempts(attempts)
    if (!found) {
      return {
        cliFound: false,
        cliPath: null as string | null,
        cliVersion: null as string | null,
        cliMajor: null as number | null,
        loginCommand: 'opencode auth login opencode',
        auth: { loggedIn: false, detail: 'CLI not found' },
        managedServerUp: isManagedServerUp(),
        searchHints: opencodeSearchHints(),
        debug
      }
    }
    const loginCommand = opencodeLoginCommand(found.major)
    let auth = { loggedIn: false, detail: 'login status unknown' }
    try {
      auth = await getOpencodeAuthStatus(found.path, getVaultPath())
    } catch {
      // Status is advisory; chat still attempts the run and surfaces real errors.
    }
    return {
      cliFound: true,
      cliPath: found.path,
      cliVersion: found.version,
      cliMajor: found.major,
      loginCommand,
      auth,
      managedServerUp: isManagedServerUp(),
      searchHints: opencodeSearchHints(),
      debug
    }
  })

  ipcMain.handle('opencode:get-models', async () => {
    const { found } = await resolveOpencodeBinary(getSettings().ai.opencodeCliPath || undefined)
    if (!found) throw new Error('opencode CLI not found')
    return (await listOpencodeModels(found.path, getVaultPath())) ?? []
  })

  ipcMain.handle('web:search', async (_, query: string, maxResults?: number) => {
    if (typeof query !== 'string' || !query.trim()) throw new Error('Empty search query')
    return webSearch(query, typeof maxResults === 'number' ? maxResults : 6)
  })

  ipcMain.handle('web:search-context', async (_, query: string) => {
    if (typeof query !== 'string' || !query.trim()) throw new Error('Empty search query')
    const results = await webSearch(query, 6)
    return formatSearchContext(query, results)
  })
}
