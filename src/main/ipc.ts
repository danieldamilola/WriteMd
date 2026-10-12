import { ipcMain, dialog, shell, app, type BrowserWindow } from 'electron'
import { readFile, writeFile, stat, rename, unlink, open } from 'fs/promises'
import { watch, existsSync, mkdirSync, type FSWatcher } from 'fs'
import { dirname, join, resolve } from 'path'
import { randomUUID } from 'crypto'
import {
  importBackground,
  getBackground,
  removeBackground,
  materialSupport,
  applyWindowMaterial
} from './appearance'
import log from 'electron-log'
import {
  getVaultPath,
  setVaultPath,
  ensureVaultExists,
  listMarkdownFiles,
  getVaultTree,
  invalidateVaultPathCache
} from './vault'
import { getSettings, setSettings, type WriteMdSettingsPatch } from './settings'
import { exportDocx, exportHtml, exportPdf } from './export'
import {
  setVaultRootProvider,
  registerExternalPath,
  registerExternalPaths,
  registerAttachmentPaths,
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
import { PRESETS, adapterFor } from './ai/providers'
import { checkEndpoint } from './ai/endpoint'
import { getApiKey, keyState, setApiKey } from './ai/key-store'
import {
  cancelTurn,
  deleteSavedSession,
  getJournal,
  listChanges,
  readSessions,
  setEventEmitter,
  startTurn,
  writeSession,
  type AiSendInput
} from './ai/service'
import type { PersistedSession } from '../shared/ai/sessions'
import type { SetKeyResult } from '../shared/electron-api'

/** A model listing is a single small GET; anything slower is a wrong endpoint. */
const MODEL_LIST_TIMEOUT_MS = 20_000

const watchedPaths = new Map<string, FSWatcher>()

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
  setEventEmitter((event) => getWindow()?.webContents.send('ai:event', event))
  ipcMain.handle('appearance:import-background', () => importBackground(getWindow()))
  ipcMain.handle('appearance:get-background', (_, id: string) => getBackground(id))
  ipcMain.handle('appearance:remove-background', (_, id: string) => removeBackground(id))
  ipcMain.handle('appearance:material-support', () => materialSupport())

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

  ipcMain.handle('file:register-paths', (_, paths: string[]) => {
    if (Array.isArray(paths)) registerAttachmentPaths(paths.filter((p) => typeof p === 'string'))
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

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', async (_, settings: WriteMdSettingsPatch) => {
    const previousMaterial = getSettings().appearance.windowMaterial
    // Every path guard measures against `getVaultPath()`. A vault change that
    // arrives through settings rather than `vault:set-path` still has to move
    // that boundary, so the cache cannot survive it.
    if (settings && typeof settings === 'object' && 'vaultPath' in (settings.files ?? {})) {
      invalidateVaultPathCache()
    }
    await setSettings(settings)
    if (getSettings().appearance.windowMaterial !== previousMaterial)
      applyWindowMaterial(getWindow())
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

  // ---------------------------------------------------------------- AI

  ipcMain.handle('ai:presets', () => PRESETS)

  ipcMain.handle('ai:key-state', () => keyState())

  ipcMain.handle('ai:set-key', (_, key: string) => {
    const result = setApiKey(key)
    return { ...result, state: keyState() } satisfies SetKeyResult
  })

  ipcMain.handle('ai:clear-key', () => {
    const result = setApiKey('')
    return { ...result, state: keyState() } satisfies SetKeyResult
  })

  /**
   * Ask the provider which models this key can reach.
   *
   * `apiKey` is only ever a first-run fallback. Once a key is stored, the typed
   * field is blank by design and main uses the stored one - so the renderer has
   * no key to send and the Fetch button still works on a reopening of Settings.
   *
   * Every guard that matters runs in main. `checkEndpoint` is the real
   * enforcement point; the renderer runs it too, but only so the user finds out
   * before a round trip.
   */
  ipcMain.handle(
    'ai:fetch-models',
    async (_, providerId: string, baseUrl: string, typedKey: string) => {
      const adapter = adapterFor(providerId)
      if (!adapter) throw new Error(`Unknown provider: ${providerId}`)
      const apiKey = typedKey.trim() || getApiKey() || undefined
      // `checkEndpoint` rejects on a missing model too, which does not apply to a
      // model listing, so only the endpoint and key checks are relevant here.
      const check = checkEndpoint(baseUrl, 'unused', apiKey)
      if (!check.ok) throw new Error(check.message)
      return adapter.listModels({ baseUrl, apiKey }, AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS))
    }
  )

  // Chat. `invoke` returns as soon as the turn is under way and everything after
  // arrives on the `ai:event` push channel, because a turn can outlast the call
  // by minutes and a single invoke result would have to buffer all of it.
  ipcMain.handle('ai:send', (_, requestId: string, input: AiSendInput) =>
    startTurn(requestId, input)
  )

  ipcMain.handle('ai:cancel', (_, requestId: string) => {
    cancelTurn(requestId)
    return true
  })

  ipcMain.handle('ai:list-changes', (_, sessionId?: string) => listChanges(sessionId))

  ipcMain.handle('ai:undo-change', (_, journalId: string) => getJournal().undo(journalId))

  ipcMain.handle('ai:list-sessions', () => readSessions())

  ipcMain.handle('ai:save-session', (_, session: PersistedSession) => {
    writeSession(session)
    return true
  })

  ipcMain.handle('ai:delete-session', (_, id: string) => {
    deleteSavedSession(id)
    return true
  })
}
